import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import {
  decodeControl,
  decodeSnapshot,
  decodeTerritory,
  decodeTerritoryDelta,
  decodeTerritoryMinimap,
  encodeControl,
  encodeInput,
  peekTag,
  TAG,
  GAME_PROTOCOL_VERSION,
  type S2CControl,
  type Snapshot,
  type WorldUiEntity,
  type MinimapUiEntity,
  type TerritoryCell,
  type TotemWireState,
} from "@hexagon/shared";
import { NetServer } from "../src/net/net-server";
import { GameRoom } from "../src/game/game-room";

/**
 * Integration test: dựng GameRoom + NetServer THẬT trên cổng tạm (port 0), dùng gói `ws`
 * làm client. Lái tick TẤT ĐỊNH qua `tickOnce()` để không phụ thuộc timer thật → nhanh và
 * ổn định. Kiểm tra: 2 client JOIN nhận WELCOME với playerId KHÁC nhau; gửi nhiều INPUT
 * cùng heading; sau khi qua giai đoạn chuẩn bị, vị trí thực thể của CHÍNH client THAY ĐỔI;
 * ackSeq tiến tới seq cuối; tick tăng; snapshot liệt kê ĐỦ thực thể (người + bot).
 */

/** Client test bọc ws: gom snapshot nhị phân + control JSON. */
class TestClient {
  readonly ws: WebSocket;
  welcome: Extract<S2CControl, { t: "welcome" }> | null = null;
  readonly snapshots: Snapshot[] = [];
  territoryKeyframes = 0;
  territoryDeltas = 0;
  worldUi: WorldUiEntity[] = [];
  minimapUi: MinimapUiEntity[] = [];
  radarActive = false;
  minimapTerritory: TerritoryCell[] = [];
  totems: TotemWireState[] = [];
  lobby: Extract<S2CControl, { t: "lobby" }> | null = null;
  readonly events: Extract<S2CControl, { t: "event" }>[] = [];
  readonly reviveResults: Extract<S2CControl, { t: "revive_result" }>[] = [];
  private autoReady = true;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        if (peekTag(data) === TAG.SNAPSHOT) {
          const s = decodeSnapshot(data);
          if (s) this.snapshots.push(s);
        } else if (peekTag(data) === TAG.TERRITORY) {
          if (decodeTerritory(data)) this.territoryKeyframes++;
        } else if (peekTag(data) === TAG.TERRITORY_DELTA) {
          if (decodeTerritoryDelta(data)) this.territoryDeltas++;
        } else if (peekTag(data) === TAG.TERRITORY_MINIMAP) {
          const minimap = decodeTerritoryMinimap(data);
          if (minimap) this.minimapTerritory = minimap.cells;
        }
      } else {
        const msg = decodeControl<S2CControl>(data.toString());
        if (msg?.t === "welcome") {
          this.welcome = msg;
          if (this.autoReady) this.ready(true);
        }
        else if (msg?.t === "lobby") this.lobby = msg;
        else if (msg?.t === "world_ui") this.worldUi = msg.entities;
        else if (msg?.t === "minimap_ui") {
          this.radarActive = msg.radarActive;
          this.minimapUi = msg.entities;
        } else if (msg?.t === "totems") this.totems = msg.items;
        else if (msg?.t === "revive_result") this.reviveResults.push(msg);
        else if (msg?.t === "event") this.events.push(msg);
      }
    });
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
  }

  join(
    name: string,
    look?: { colorIndex: number; trailPattern: "solid" | "stripes" | "dots" | "chevrons"; shape: "cube" | "cylinder" | "sphere" | "cone" | "fly" | "bee" | "ladybug" },
    autoReady = true,
    reconnectToken?: string,
  ): void {
    this.autoReady = autoReady;
    this.ws.send(encodeControl({ t: "join", name, reconnectToken, ...look, protocolVersion: GAME_PROTOCOL_VERSION }));
  }

  ready(ready: boolean): void {
    this.ws.send(encodeControl({ t: "lobby_ready", ready }));
  }

  cancelLobby(): void {
    this.ws.send(encodeControl({ t: "lobby_cancel" }));
  }

  input(seq: number, heading: number): void {
    this.ws.send(encodeInput(seq, heading));
  }

  interest(targetId: number | null): void {
    this.ws.send(encodeControl({ t: "interest", targetId }));
  }

  revive(): void {
    this.ws.send(encodeControl({ t: "revive" }));
  }

  /** Chờ tới khi có WELCOME (server đã cấp ghế). */
  async waitWelcome(timeoutMs = 3000): Promise<void> {
    await waitFor(() => this.welcome !== null, timeoutMs, "welcome");
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (
        this.ws.readyState === WebSocket.CLOSED ||
        this.ws.readyState === WebSocket.CLOSING
      ) {
        resolve();
        return;
      }
      this.ws.once("close", () => resolve());
      this.ws.close();
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll một điều kiện cho tới khi đúng hoặc hết giờ. */
async function waitFor(
  cond: () => boolean,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Hết giờ chờ: ${what}`);
    }
    await delay(5);
  }
}

describe("NetServer integration (real ws, deterministic ticks)", () => {
  let server: NetServer | null = null;
  let clients: TestClient[] = [];

  afterEach(async () => {
    for (const c of clients) await c.close();
    clients = [];
    if (server) {
      await server.close();
      server = null;
    }
  });

  it("cấp ghế riêng, di chuyển thực thể, ackSeq/tick tiến, liệt kê đủ thực thể", async () => {
    server = new NetServer({ port: 0, entityAoiRadius: Number.POSITIVE_INFINITY });
    await server.listen();
    const port = server.port;
    expect(port).toBeGreaterThan(0);
    // Chưa ai vào → chưa có phòng nào.
    expect(server.roomCount).toBe(0);

    const url = `ws://127.0.0.1:${port}`;
    const a = new TestClient(url);
    const b = new TestClient(url);
    clients = [a, b];
    await Promise.all([a.open(), b.open()]);

    // JOIN → WELCOME với playerId phân biệt.
    a.join("An", { colorIndex: 4, trailPattern: "dots", shape: "fly" });
    b.join("Binh");
    await Promise.all([a.waitWelcome(), b.waitWelcome()]);
    expect(a.welcome).not.toBeNull();
    expect(b.welcome).not.toBeNull();
    const idA = a.welcome!.playerId;
    const idB = b.welcome!.playerId;
    expect(idA).not.toBe(idB);
    expect(a.welcome!.tickRate).toBe(24);
    expect(a.welcome!.arenaRadius).toBeGreaterThan(0);
    expect(a.welcome!.botCount).toBe(server.activeRoom!.botCapacity);
    await waitFor(() => a.worldUi.length > 0, 3000, "world ui roster");
    const expectedWorldUiIds = [idA, idB];
    expect(a.worldUi.map((e) => e.id).sort((x, y) => x - y)).toEqual(
      expectedWorldUiIds,
    );
    expect(a.worldUi.find((e) => e.id === idA)?.colorIndex).toBe(4);

    // JOIN đã TẠO một phòng đang hoạt động.
    expect(server.roomCount).toBe(1);
    expect(server.activeRoom).not.toBeNull();

    // Gửi nhiều INPUT cùng heading (hướng +x = 0 rad). Chờ tới server rồi lái tick.
    const HEADING = 0;
    const LAST_SEQ = 5;
    for (let seq = 1; seq <= LAST_SEQ; seq++) {
      a.input(seq, HEADING);
      b.input(seq, HEADING);
    }
    await delay(60); // để mọi INPUT tới server trước khi step.

    // Lái đủ tick vượt PREP_TIME (3s @ 24Hz = 72 tick) + dư để có dịch chuyển rõ.
    // Broadcast một snapshot mỗi tick; nhả event-loop để ws flush.
    const TICKS = 96;
    for (let i = 0; i < TICKS; i++) {
      server.tickOnce();
      if (i % 12 === 0) await delay(0);
    }
    // Chờ snapshot cuối tới client.
    await waitFor(
      () => a.snapshots.length > 0 && b.snapshots.length > 0,
      3000,
      "snapshots",
    );
    await delay(60);

    // --- Khẳng định ---
    const lastA = a.snapshots[a.snapshots.length - 1];
    const firstA = a.snapshots[0];

    // tick tăng đơn điệu qua các snapshot.
    expect(lastA.tick).toBeGreaterThan(firstA.tick);

    // ackSeq tiến tới seq CUỐI đã gửi.
    expect(lastA.ackSeq).toBe(LAST_SEQ);
    expect(b.snapshots[b.snapshots.length - 1].ackSeq).toBe(LAST_SEQ);

    // Snapshot chỉ liệt kê người/bot đang thực sự tham gia, không có ghế trống đã park.
    expect(lastA.entities.length).toBe(2 + server.activeRoom!.activeBotCount);

    // Vị trí thực thể của CHÍNH client thay đổi theo thời gian (đã qua prep, đang chạy).
    const ownFirst = firstA.entities.find((e) => e.id === idA)!;
    const ownLast = lastA.entities.find((e) => e.id === idA)!;
    expect(ownFirst).toBeDefined();
    expect(ownLast).toBeDefined();
    const moved = Math.hypot(ownLast.x - ownFirst.x, ownLast.y - ownFirst.y);
    expect(moved).toBeGreaterThan(0.5);
    expect(ownLast.alive).toBe(true);
    expect(ownLast.colorIndex).toBe(4);
    expect(ownLast.trailPatternIndex).toBe(2);
    expect(ownLast.shapeIndex).toBe(4);
    expect(a.territoryKeyframes).toBeGreaterThanOrEqual(1);
    expect(a.territoryDeltas).toBeGreaterThan(0);

    // Entity của A cũng xuất hiện trong snapshot của B (thế giới dùng chung).
    const bSeesA = b.snapshots[b.snapshots.length - 1].entities.find(
      (e) => e.id === idA,
    );
    expect(bSeesA).toBeDefined();

    // selfPrep có mặt trong snapshot (số hợp lệ, đã hết prep sau 96 tick → 0).
    expect(typeof lastA.selfPrep).toBe("number");
    expect(lastA.selfPrep).toBe(0);
  });

  it("entity AoI lọc thực thể xa theo từng client nhưng luôn giữ self", () => {
    const room = new GameRoom(3, 0);
    const idA = room.join("A")!;
    const idB = room.join("B")!;
    const idC = room.join("C")!;

    room.gameState.players[idA].pos = { x: 0, y: 0 };
    room.gameState.players[idB].pos = { x: 6, y: 0 };
    room.gameState.players[idC].pos = { x: 30, y: 0 };

    const snapA = room.buildSnapshotFor(idA, 10);
    expect(snapA.entities.map((entity) => entity.id)).toEqual([idA, idB]);
    expect(snapA.entities.some((entity) => entity.id === idA)).toBe(true);

    const snapC = room.buildSnapshotFor(idC, 10);
    expect(snapC.entities.map((entity) => entity.id)).toEqual([idC]);
    expect(snapC.entities.some((entity) => entity.id === idC)).toBe(true);

    // UI toàn cục không theo AoI nhưng không bao giờ chứa ghế người đang trống.
    expect(room.worldUiEntities().map((entity) => entity.id)).toEqual([idA, idB, idC]);
    room.leave(idB);
    expect(room.worldUiEntities().map((entity) => entity.id)).toEqual([idA, idC]);
  });

  it("rejects a mismatched protocol before allocating a room", async () => {
    server = new NetServer({ port: 0, protocolVersion: GAME_PROTOCOL_VERSION });
    await server.listen();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
    });
    ws.send(JSON.stringify({ t: "join", name: "Old client", protocolVersion: GAME_PROTOCOL_VERSION - 1 }));
    const result = await closed;
    expect(result.code).toBe(4002);
    expect(result.reason).toContain(`server=${GAME_PROTOCOL_VERSION}`);
    expect(server.roomCount).toBe(0);
  });

  it("spectator AoI bám leader/target, luôn giữ self và trở lại self sau respawn", () => {
    const room = new GameRoom(3, 0);
    const idA = room.join("A")!;
    const idB = room.join("B")!;
    const idC = room.join("C")!;
    room.gameState.players[idA].pos = { x: 0, y: 0 };
    room.gameState.players[idB].pos = { x: 60, y: 0 };
    room.gameState.players[idC].pos = { x: -60, y: 0 };
    room.gameState.players[idA].phase = "dead";

    const leaderSnap = room.buildSnapshotFor(idA, 10);
    expect(leaderSnap.entities.map((entity) => entity.id)).toEqual([idA, idB]);

    const targetSnap = room.buildSnapshotFor(idA, 10, idC);
    expect(targetSnap.entities.map((entity) => entity.id)).toEqual([idA, idC]);

    room.gameState.players[idA].phase = "prep";
    const respawnSnap = room.buildSnapshotFor(idA, 10, idC);
    expect(respawnSnap.entities.map((entity) => entity.id)).toEqual([idA]);
  });

  it("entity enter/leave AoI được phản ánh ngay ở snapshot kế tiếp", () => {
    const room = new GameRoom(3, 0);
    const idA = room.join("A")!;
    const idB = room.join("B")!;
    room.gameState.players[idA].pos = { x: 0, y: 0 };
    room.gameState.players[idB].pos = { x: 20, y: 0 };
    expect(room.buildSnapshotFor(idA, 10).entities.map((e) => e.id)).toEqual([idA]);

    room.gameState.players[idB].pos = { x: 8, y: 0 };
    expect(room.buildSnapshotFor(idA, 10).entities.map((e) => e.id)).toEqual([idA, idB]);

    room.gameState.players[idB].pos = { x: 11, y: 0 };
    expect(room.buildSnapshotFor(idA, 10).entities.map((e) => e.id)).toEqual([idA]);
  });

  it("control interest đổi spectator target và revive xóa target cũ", async () => {
    server = new NetServer({ port: 0, entityAoiRadius: 10 });
    await server.listen();
    const url = `ws://127.0.0.1:${server.port}`;
    const a = new TestClient(url);
    const b = new TestClient(url);
    const c = new TestClient(url);
    clients = [a, b, c];
    await Promise.all([a.open(), b.open(), c.open()]);
    a.join("A"); b.join("B"); c.join("C");
    await Promise.all([a.waitWelcome(), b.waitWelcome(), c.waitWelcome()]);

    const idA = a.welcome!.playerId;
    const idB = b.welcome!.playerId;
    const idC = c.welcome!.playerId;
    const room = server.activeRoom!;
    room.gameState.players[idA].pos = { x: 0, y: 0 };
    room.gameState.players[idB].pos = { x: 60, y: 0 };
    room.gameState.players[idC].pos = { x: -60, y: 0 };
    room.gameState.players[idA].phase = "dead";

    server.tickOnce();
    await delay(10);
    expect(a.snapshots.at(-1)!.entities.map((e) => e.id)).toEqual([idA, idB]);

    a.interest(idC);
    await delay(10);
    server.tickOnce();
    await delay(10);
    expect(a.snapshots.at(-1)!.entities.map((e) => e.id)).toEqual([idA, idC]);

    a.revive();
    await delay(10);
    room.gameState.players[idA].pos = { x: 0, y: 0 };
    room.gameState.players[idC].pos = { x: -60, y: 0 };
    server.tickOnce();
    await delay(10);
    expect(a.snapshots.at(-1)!.entities.some((e) => e.id === idA)).toBe(true);
    expect(a.snapshots.at(-1)!.entities.some((e) => e.id === idC)).toBe(false);
  });

  it("trả lý do no_spawn khi server không tìm được vị trí hồi sinh", async () => {
    server = new NetServer({ port: 0, onlineBots: 0 });
    await server.listen();
    const a = new TestClient(`ws://127.0.0.1:${server.port}`);
    clients = [a];
    await a.open();
    a.join("A");
    await a.waitWelcome();
    const room = server.activeRoom!;
    room.gameState.players[a.welcome!.playerId].phase = "dead";
    vi.spyOn(room, "reviveSeat").mockReturnValue(false);

    a.revive();
    await waitFor(() => a.reviveResults.length > 0, 1000, "revive result");
    expect(a.reviveResults.at(-1)).toEqual({ t: "revive_result", ok: false, reason: "no_spawn" });
  });

  it("routes the ninth human to a new room instead of closing a full-room join", async () => {
    server = new NetServer({ port: 0, maxHumans: 8, onlineBots: 0 });
    await server.listen();
    const url = `ws://127.0.0.1:${server.port}`;
    clients = Array.from({ length: 9 }, () => new TestClient(url));
    await Promise.all(clients.map((client) => client.open()));
    clients.forEach((client, index) => client.join(`P${index + 1}`));
    await Promise.all(clients.map((client) => client.waitWelcome()));
    expect(server.roomCount).toBe(2);
    expect(server.roomStats.map((room) => room.humanCount).sort((a, b) => b - a)).toEqual([8, 1]);
    expect(server.roomStats.some((room) => room.capacityFull)).toBe(true);
    expect(clients.slice(0, 8).map((client) => client.welcome!.playerId).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(clients[8].welcome!.playerId).toBe(0);
  });

  it("filters minimap payload without Radar and reveals the room with Radar", async () => {
    server = new NetServer({ port: 0, maxHumans: 8, onlineBots: 0 });
    await server.listen();
    const url = `ws://127.0.0.1:${server.port}`;
    const a = new TestClient(url);
    const b = new TestClient(url);
    clients = [a, b];
    await Promise.all([a.open(), b.open()]);
    a.join("A"); b.join("B");
    await Promise.all([a.waitWelcome(), b.waitWelcome()]);
    const idA = a.welcome!.playerId;
    const idB = b.welcome!.playerId;
    const game = server.activeRoom!.gameState;
    game.applyTerritory([
      { q: 0, r: 0, owner: idA, kind: 0 },
      { q: 0, r: 1, owner: idA, kind: 1 },
      { q: 2, r: 0, owner: idB, kind: 0 },
      { q: 2, r: 1, owner: idB, kind: 1 },
    ]);
    for (let i = 0; i < 5; i++) server.tickOnce();
    await delay(15);

    expect(a.radarActive).toBe(false);
    expect(a.minimapUi.map((entity) => entity.id)).toEqual([idA]);
    expect(new Set(a.minimapTerritory.map((cell) => cell.owner))).toEqual(new Set([idA]));
    expect(a.totems.length).toBeGreaterThan(0);
    expect(a.worldUi.every((entity) => !("x" in entity) && !("y" in entity))).toBe(true);

    vi.spyOn(game, "radarActiveFor").mockReturnValue(true);
    for (let i = 0; i < 5; i++) server.tickOnce();
    await delay(15);
    expect(a.radarActive).toBe(true);
    expect(new Set(a.minimapUi.map((entity) => entity.id))).toEqual(new Set([idA, idB]));
    expect(new Set(a.minimapTerritory.map((cell) => cell.owner))).toEqual(new Set([idA, idB]));
  });

  it("routes joins away from a room with active King countdown", async () => {
    server = new NetServer({ port: 0, maxHumans: 8, onlineBots: 0, kingDurationSeconds: 10 });
    await server.listen();
    const url = `ws://127.0.0.1:${server.port}`;
    const a = new TestClient(url);
    const b = new TestClient(url);
    clients = [a, b];
    await Promise.all([a.open(), b.open()]);
    a.join("King"); await a.waitWelcome();
    const firstRoom = server.activeRoom!;
    vi.spyOn(firstRoom.gameState, "kingId").mockReturnValue(a.welcome!.playerId);
    server.tickOnce();
    expect(firstRoom.kingAdmissionLocked).toBe(true);
    b.join("Late"); await b.waitWelcome();
    expect(server.roomCount).toBe(2);
    expect(server.roomStats.some((room) => room.kingAdmissionLocked)).toBe(true);
    expect(b.welcome!.playerId).toBe(0);
  });

  it("activates the fixed room bot target one per configured interval", async () => {
    server = new NetServer({ port: 0, maxHumans: 8, onlineBots: 16, botJoinIntervalMs: 100 });
    await server.listen();
    const client = new TestClient(`ws://127.0.0.1:${server.port}`);
    clients = [client];
    await client.open(); client.join("A"); await client.waitWelcome();
    server.tickOnce(); server.tickOnce();
    expect(server.activeRoom!.activeBotCount).toBe(0);
    server.tickOnce();
    expect(server.activeRoom!.activeBotCount).toBe(1);
    server.tickOnce(); server.tickOnce(); server.tickOnce();
    expect(server.activeRoom!.activeBotCount).toBe(2);
    server.tickOnce(); server.tickOnce(); server.tickOnce();
    expect(server.activeRoom!.activeBotCount).toBe(3);
  });

  it("chỉ bắt đầu lobby khi người chơi bấm sẵn sàng", async () => {
    server = new NetServer({ port: 0, onlineBots: 0 });
    await server.listen();
    const a = new TestClient(`ws://127.0.0.1:${server.port}`);
    clients = [a];
    await a.open();
    a.join("An", undefined, false);
    await a.waitWelcome();
    await waitFor(() => a.lobby !== null, 1000, "lobby chưa ready");
    expect(a.lobby).toMatchObject({ started: false, readyCount: 0, selfReady: false });

    server.tickOnce();
    expect(a.snapshots).toHaveLength(0);
    a.ready(true);
    await waitFor(() => a.lobby?.started === true, 1000, "lobby bắt đầu sau ready");
    server.tickOnce();
    await waitFor(() => a.snapshots.length > 0, 1000, "snapshot sau ready");
  });

  it("resume đúng room/seat trong grace và cancel giải phóng ghế ngay", async () => {
    server = new NetServer({ port: 0, onlineBots: 0, reconnectGraceMs: 200 });
    await server.listen();
    const url = `ws://127.0.0.1:${server.port}`;
    const a = new TestClient(url);
    clients = [a];
    await a.open();
    a.join("An", undefined, false);
    await a.waitWelcome();
    const firstWelcome = a.welcome!;
    expect(firstWelcome.reconnectToken).toBeTruthy();
    a.ws.terminate();
    await delay(15);

    const resumed = new TestClient(url);
    clients.push(resumed);
    await resumed.open();
    resumed.join("An", undefined, false, firstWelcome.reconnectToken);
    await resumed.waitWelcome();
    expect(resumed.welcome).toMatchObject({ playerId: firstWelcome.playerId, resumed: true });
    expect(server.roomCount).toBe(1);
    expect(server.activeRoom?.occupied()).toBe(1);

    resumed.cancelLobby();
    await waitFor(() => server!.roomCount === 0, 1000, "cancel giải phóng room");
  });

  it("resume thay thế socket cũ đang OPEN giả mà không tạo ghế mới", async () => {
    server = new NetServer({ port: 0, onlineBots: 0 });
    await server.listen();
    const url = `ws://127.0.0.1:${server.port}`;
    const stale = new TestClient(url);
    clients = [stale];
    await stale.open();
    stale.join("An", undefined, false);
    await stale.waitWelcome();
    const first = stale.welcome!;

    const resumed = new TestClient(url);
    clients.push(resumed);
    await resumed.open();
    resumed.join("An", undefined, false, first.reconnectToken);
    await resumed.waitWelcome();
    expect(resumed.welcome).toMatchObject({ playerId: first.playerId, resumed: true });
    expect(server.activeRoom?.occupied()).toBe(1);
    await waitFor(() => stale.ws.readyState === WebSocket.CLOSED, 1000, "socket cũ bị thay thế");
  });

  it("VÒNG ĐỜI: phòng tạo khi JOIN, ĐÓNG khi hết người", async () => {
    server = new NetServer({ port: 0, reconnectGraceMs: 20 });
    await server.listen();
    expect(server.roomCount).toBe(0);

    const url = `ws://127.0.0.1:${server.port}`;
    const a = new TestClient(url);
    clients = [a];
    await a.open();
    a.join("An");
    await a.waitWelcome();
    expect(server.roomCount).toBe(1);
    expect(server.activeRoom).not.toBeNull();

    // Rời đi → phòng đóng, không còn phòng nào chạy nền.
    await a.close();
    clients = [];
    await waitFor(() => server!.roomCount === 0, 2000, "phòng đóng");
    expect(server.activeRoom).toBeNull();
  });
});
