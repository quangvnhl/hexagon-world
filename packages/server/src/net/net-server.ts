import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  CONFIG,
  GAME_PROTOCOL_VERSION,
  decodeControl,
  decodeInput,
  encodeControl,
  encodeSnapshot,
  encodeTerritory,
  encodeTerritoryMinimap,
  encodeTerritoryDelta,
  type C2SControl,
  type PlayerAppearance,
  type S2CControl,
  type TerritoryCell,
} from "@hexagon/shared";
import { GameRoom } from "../game/game-room";
import { filterTerritoryAoi } from "./territory-aoi";
import { DT, TICK_RATE, MAX_PLAYERS, ONLINE_BOTS, MIN_PLAYERS, ENTITY_AOI_RADIUS, TERRITORY_AOI_RADIUS, TERRITORY_AOI_HYSTERESIS, WS_BACKPRESSURE_BYTES } from "../config";
import { NetworkTransport, gameNetworkMetrics, type NetworkMetricsSnapshot } from "./network-transport";

/** Gửi keyframe TERRITORY mỗi bao nhiêu tick (throttle). 6 tick @24Hz ≈ 4 Hz. */
const TERRITORY_EVERY = 6;
/** Minimap/xếp hạng toàn cục ở ~5 Hz; scene 3D vẫn dùng snapshot AoI đầy đủ tick-rate. */
const WORLD_UI_EVERY = 5;
/** Giữ phòng ĐÃ KẾT THÚC thêm chút để client xem kết quả rồi đóng (ms). */
const ENDED_GRACE_MS = 8000;

/** Một PHÒNG chơi độc lập: GameState riêng + vòng lặp riêng + tập kết nối riêng. */
interface Room {
  id: number;
  room: GameRoom;
  conns: Set<WebSocket>;
  /** Đã BẮT ĐẦU ván chưa (đủ MIN_PLAYERS người thật). false = đang ở phòng CHỜ:
   *  không mô phỏng, không gửi snapshot; chỉ phát trạng thái phòng chờ (lobby). */
  started: boolean;
  /** Ván đã kết thúc (có người thắng) → không nhận người mới, sẽ đóng sau grace. */
  ended: boolean;
  endedAt: number;
  // vòng lặp bước cố định
  timer: NodeJS.Timeout | null;
  lastTime: number;
  accumulator: number;
  running: boolean;
  /** territoryRevision lần cuối đã broadcast keyframe TERRITORY. Dùng để FLUSH NGAY khi chủ
   *  ô đổi (capture/chết) thay vì chờ nhịp định kỳ → flood fill hiện gần như tức thì. */
  lastTerrRev: number;
  // theo dõi để phát event
  prevAlive: boolean[];
  prevWon: boolean;
  prevKingId: number;
  matchId: string | null;
  startedAt: string | null;
  reported: boolean;
  participants: Map<number, AuthenticatedJoin>;
  matchStats: Map<number, { kills: number; deaths: number; deathCause: string }>;
}

export interface MatchResultEnvelope {
  eventId: string;
  matchId: string;
  roomId: string;
  region: string;
  mode: "online";
  startedAt: string;
  endedAt: string;
  winnerPlayerId: string;
  serverVersion: string;
  players: Array<{ participantKey: string; playerId: string; platform: string; isGuest: boolean; seatId: number; kills: number; deaths: number; territoryCaptured: number; deathCause: string; finalScore: number; placement: number }>;
}

interface AuthenticatedJoin {
  playerId: string | null;
  guestId: string | null;
  isGuest: boolean;
  platform: string;
  displayName: string;
  appearance: PlayerAppearance;
}

interface ConnState {
  entityId: number | null;
  room: Room | null;
  identity: AuthenticatedJoin | null;
  territoryRevision: number;
  territoryCells: Map<string, TerritoryCell>;
  territoryInterest: { x: number; y: number } | null;
  interestTargetId: number | null;
}

interface NetOpts {
  port?: number;
  tickRate?: number;
  httpServer?: HttpServer;
  path?: string;
  requireTicket?: boolean;
  authenticateTicket?: (ticket: string) => AuthenticatedJoin;
  region?: string;
  serverVersion?: string;
  onMatchResult?: (result: MatchResultEnvelope) => void | Promise<void>;
  /** Bán kính entity AoI; mặc định lấy từ ENTITY_AOI_RADIUS. */
  entityAoiRadius?: number;
  protocolVersion?: number;
  backpressureBytes?: number;
}

/**
 * NetServer — quản lý VÒNG ĐỜI PHÒNG cho server authoritative.
 *
 * - Phòng được TẠO khi có người JOIN (online: CHỈ người thật, KHÔNG bot).
 * - Phòng ở trạng thái CHỜ tới khi đủ MIN_PLAYERS người thật mới BẮT ĐẦU mô phỏng
 *   (điều kiện chơi = tối thiểu 2 người). Trong lúc chờ chỉ phát trạng thái phòng chờ.
 * - Phòng bị ĐÓNG khi: (a) hết người chơi, hoặc (b) ván kết thúc (có người thắng) →
 *   sau một khoảng grace ngắn cho client xem kết quả.
 * - Người vào mới luôn được xếp vào phòng đang mở; nếu phòng hiện tại đã kết thúc thì
 *   tạo phòng MỚI (fresh) → không bao giờ bị "vào phòng đã tàn, chết ngay".
 *
 * Logic thuần (constructor tường minh, không decorator metadata) để test trực tiếp;
 * NestJS chỉ bọc ở bootstrap production.
 */
export class NetServer {
  private readonly wss: WebSocketServer;
  private readonly tickRate: number;
  private readonly dt: number;
  private readonly tickMs: number;
  private readonly attachedToHttp: boolean;
  private readonly requireTicket: boolean;
  private readonly authenticateTicket?: (ticket: string) => AuthenticatedJoin;
  private readonly region: string;
  private readonly serverVersion: string;
  private readonly onMatchResult?: (result: MatchResultEnvelope) => void | Promise<void>;
  private readonly entityAoiRadius: number;
  private readonly protocolVersion: number;
  private readonly transport: NetworkTransport;

  /** Bật vòng lặp thời gian thực (start()); false ở chế độ test (listen() + tickOnce()). */
  private autoLoop = false;
  private nextRoomId = 1;

  private readonly conns = new Map<WebSocket, ConnState>();
  private readonly rooms = new Set<Room>();
  /** Phòng đang mở nhận người mới (null nếu chưa có / vừa kết thúc). */
  private active: Room | null = null;

  constructor(opts: NetOpts = {}) {
    this.tickRate = opts.tickRate ?? TICK_RATE;
    this.dt = this.tickRate === TICK_RATE ? DT : 1 / this.tickRate;
    this.tickMs = 1000 / this.tickRate;
    this.attachedToHttp = Boolean(opts.httpServer);
    this.requireTicket = opts.requireTicket ?? false;
    this.authenticateTicket = opts.authenticateTicket;
    this.region = opts.region ?? "local";
    this.serverVersion = opts.serverVersion ?? "dev";
    this.onMatchResult = opts.onMatchResult;
    this.entityAoiRadius = opts.entityAoiRadius ?? ENTITY_AOI_RADIUS;
    this.protocolVersion = opts.protocolVersion ?? GAME_PROTOCOL_VERSION;
    this.transport = new NetworkTransport(opts.backpressureBytes ?? WS_BACKPRESSURE_BYTES, gameNetworkMetrics);
    this.wss = opts.httpServer
      ? new WebSocketServer({ server: opts.httpServer, ...(opts.path ? { path: opts.path } : {}) })
      : new WebSocketServer({ port: opts.port ?? 0 });
    this.wss.on("connection", (ws) => this.onConnection(ws));
  }

  get port(): number {
    const addr = this.wss.address();
    if (addr && typeof addr === "object") return (addr as AddressInfo).port;
    return -1;
  }

  /** Chỉ mở socket, KHÔNG chạy vòng lặp (test tự lái tick qua tickOnce). */
  async listen(): Promise<void> {
    this.autoLoop = false;
    await this.whenListening();
  }

  /** Khởi động đầy đủ: mở socket; phòng + vòng lặp tạo khi có người JOIN. */
  async start(): Promise<void> {
    this.autoLoop = true;
    if (this.attachedToHttp) return;
    await this.whenListening();
  }

  // ---- Trợ giúp test ----
  /** GameRoom của phòng đang mở (null nếu chưa có phòng). */
  get activeRoom(): GameRoom | null {
    return this.active && !this.active.ended ? this.active.room : null;
  }
  /** Số phòng đang tồn tại. */
  get roomCount(): number {
    return this.rooms.size;
  }
  get networkMetrics(): NetworkMetricsSnapshot { return this.transport.snapshot(); }
  /** Lái đúng 1 tick + broadcast cho phòng đang mở (test tất định). Chỉ khi ĐÃ bắt đầu. */
  tickOnce(): void {
    const r = this.active;
    if (!r || !r.started) return;
    this.stepRoom(r);
    this.broadcast(r);
    this.broadcastWorldUiIfDue(r);
    this.flushTerritoryIfDue(r);
  }

  private whenListening(): Promise<void> {
    if (this.wss.address()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.wss.once("listening", () => resolve());
      this.wss.once("error", reject);
    });
  }

  // ---- Vòng đời phòng ----
  private ensureActiveRoom(): Room {
    if (!this.active || this.active.ended) {
      const r: Room = {
        id: this.nextRoomId++,
        // Online: CHỈ người thật (0 bot). Phòng mở ở trạng thái CHỜ (chưa mô phỏng).
        room: new GameRoom(MAX_PLAYERS, ONLINE_BOTS),
        conns: new Set(),
        started: false,
        ended: false,
        endedAt: 0,
        timer: null,
        lastTime: 0,
        accumulator: 0,
        running: false,
        lastTerrRev: -1,
        prevAlive: [],
        prevWon: false,
        prevKingId: -1,
        matchId: null,
        startedAt: null,
        reported: false,
        participants: new Map(),
        matchStats: new Map(),
      };
      r.prevAlive = r.room.gameState.snapshotEntities().map((e) => e.alive);
      this.rooms.add(r);
      this.active = r;
      // KHÔNG chạy vòng lặp khi mới tạo — chờ đủ người mới bắt đầu (startGame).
    }
    return this.active;
  }

  /** Đủ MIN_PLAYERS người thật → BẮT ĐẦU ván: spawn đồng bộ, bật mô phỏng, báo vào trận. */
  private startGame(r: Room): void {
    if (r.started || r.ended) return;
    r.room.startMatch(); // spawn tươi tất cả ghế đang có người
    r.started = true;
    r.prevAlive = r.room.gameState.snapshotEntities().map((e) => e.alive);
    r.prevWon = false;
    r.prevKingId = -1;
    r.matchId = randomUUID();
    r.startedAt = new Date().toISOString();
    r.reported = false;
    r.participants.clear();
    r.matchStats.clear();
    for (const ws of r.conns) {
      const conn = this.conns.get(ws);
      if (!conn || conn.entityId === null) continue;
      const identity = conn.identity ?? { playerId: null, guestId: `legacy-${r.id}-${conn.entityId}`, isGuest: true, platform: "web", displayName: r.room.gameState.nameOf(conn.entityId), appearance: { colorIndex: 0, shape: "cube", trailPattern: "solid" } };
      r.participants.set(conn.entityId, identity);
      r.matchStats.set(conn.entityId, { kills: 0, deaths: 0, deathCause: "" });
    }
    this.broadcastLobby(r);
    if (this.autoLoop) this.startLoop(r);
  }

  /**
   * Chỉ còn 1 người trong phòng ĐANG CHƠI:
   *  - Người đó CÒN SỐNG → công nhận THẮNG (người sống cuối cùng): chốt winner, phát event
   *    win, đánh dấu phòng kết thúc (đóng sau grace cho client xem màn thắng).
   *  - Người đó đã CHẾT → quay về phòng chờ (matching), chờ đủ người chơi tiếp.
   */
  private handleLastPlayer(r: Room): void {
    let lastId = -1;
    for (const ws of r.conns) {
      const c = this.conns.get(ws);
      if (c && c.entityId !== null) {
        lastId = c.entityId;
        break;
      }
    }
    const alive = lastId >= 0 && r.room.gameState.players[lastId]?.alive === true;
    if (alive) {
      r.room.gameState.declareWinner(lastId);
      this.broadcastControl(r, { t: "event", kind: "win", winnerId: lastId });
      r.prevWon = true; // tránh emitEvents phát trùng
      this.markEnded(r); // vòng lặp sẽ đóng phòng sau grace
    } else {
      this.revertToWaiting(r);
    }
  }

  /** Tụt dưới MIN_PLAYERS khi đang chơi → QUAY LẠI phòng chờ: dừng mô phỏng, dọn sân, báo
   *  client về màn matching (started=false). Người còn lại chờ đủ người mới chơi tiếp. */
  private revertToWaiting(r: Room): void {
    if (!r.started || r.ended) return;
    r.started = false;
    r.running = false;
    if (r.timer) {
      clearTimeout(r.timer);
      r.timer = null;
    }
    r.room.parkAll();
    r.prevAlive = r.room.gameState.snapshotEntities().map((e) => e.alive);
    r.prevWon = false;
    r.prevKingId = -1;
    this.broadcastLobby(r);
  }

  /** Phát trạng thái PHÒNG CHỜ cho mọi client trong phòng (số người / cần / đã bắt đầu). */
  private broadcastLobby(r: Room): void {
    this.broadcastControl(r, {
      t: "lobby",
      present: r.room.occupied(),
      needed: MIN_PLAYERS,
      started: r.started,
    });
  }

  /** Phát danh sách TÊN người chơi (roster) cho mọi client trong phòng. */
  private broadcastRoster(r: Room): void {
    this.broadcastControl(r, { t: "roster", players: r.room.roster() });
    this.broadcastWorldUi(r);
  }

  private broadcastWorldUiIfDue(r: Room): void {
    if (r.room.tick % WORLD_UI_EVERY === 0) this.broadcastWorldUi(r);
  }

  private broadcastWorldUi(r: Room): void {
    this.broadcastControl(r, { t: "world_ui", entities: r.room.worldUiEntities() });
  }

  private markEnded(r: Room): void {
    if (r.ended) return;
    r.ended = true;
    r.endedAt = Date.now();
    if (this.active === r) this.active = null; // người mới sẽ vào phòng fresh khác.
    this.reportMatch(r);
  }

  private reportMatch(r: Room): void {
    if (r.reported || !r.matchId || !r.startedAt || !this.onMatchResult) return;
    r.reported = true;
    const scores = [...r.participants.keys()].map((id) => ({ id, score: r.room.gameState.players[id]?.owned.size ?? 0 })).sort((a, b) => b.score - a.score);
    const placement = new Map(scores.map((entry, index) => [entry.id, index + 1]));
    const winner = r.room.gameState.winnerId;
    const winnerIdentity = r.participants.get(winner);
    const result: MatchResultEnvelope = {
      eventId: randomUUID(), matchId: r.matchId, roomId: String(r.id), region: this.region, mode: "online", startedAt: r.startedAt, endedAt: new Date().toISOString(), winnerPlayerId: winnerIdentity?.playerId ?? "", serverVersion: this.serverVersion,
      players: [...r.participants.entries()].map(([seatId, identity]) => {
        const stats = r.matchStats.get(seatId) ?? { kills: 0, deaths: 0, deathCause: "" };
        const finalScore = r.room.gameState.players[seatId]?.owned.size ?? 0;
        return { participantKey: identity.playerId ?? identity.guestId ?? `seat-${seatId}`, playerId: identity.playerId ?? "", platform: identity.platform, isGuest: identity.isGuest, seatId, kills: stats.kills, deaths: stats.deaths, territoryCaptured: finalScore, deathCause: stats.deathCause, finalScore, placement: placement.get(seatId) ?? scores.length };
      }),
    };
    void Promise.resolve(this.onMatchResult(result)).catch(() => { r.reported = false; });
  }

  private closeRoom(r: Room): void {
    r.running = false;
    if (r.timer) {
      clearTimeout(r.timer);
      r.timer = null;
    }
    this.rooms.delete(r);
    if (this.active === r) this.active = null;
    for (const ws of r.conns) {
      const c = this.conns.get(ws);
      if (c) c.room = null;
    }
    r.conns.clear();
  }

  // ---- Vòng lặp (một phòng) ----
  private startLoop(r: Room): void {
    if (r.running) return;
    r.running = true;
    r.lastTime = Date.now();
    r.accumulator = 0;
    this.scheduleNext(r);
  }

  private scheduleNext(r: Room): void {
    if (!r.running) return;
    r.timer = setTimeout(() => this.loop(r), this.tickMs);
  }

  private loop(r: Room): void {
    if (!r.running) return;
    const now = Date.now();
    let elapsed = (now - r.lastTime) / 1000;
    r.lastTime = now;
    if (elapsed > this.dt * 5) elapsed = this.dt * 5;
    r.accumulator += elapsed;

    let stepped = false;
    while (r.accumulator >= this.dt) {
      this.stepRoom(r);
      r.accumulator -= this.dt;
      stepped = true;
    }
    if (stepped) {
      this.broadcast(r);
      this.broadcastWorldUiIfDue(r);
      this.flushTerritoryIfDue(r);
    }
    // Phòng đã kết thúc → đóng sau grace (client kịp xem kết quả).
    if (r.ended && Date.now() - r.endedAt > ENDED_GRACE_MS) {
      this.closeRoom(r);
      return;
    }
    this.scheduleNext(r);
  }

  /** Một bước mô phỏng + phát event (broadcast do loop/tickOnce lo). */
  private stepRoom(r: Room): void {
    r.room.stepTick(this.dt);
    this.emitEvents(r);
  }

  // ---- Kết nối ----
  private onConnection(ws: WebSocket): void {
    this.conns.set(ws, {
      entityId: null,
      room: null,
      identity: null,
      territoryRevision: 0,
      territoryCells: new Map(),
      territoryInterest: null,
      interestTargetId: null,
    });
    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) this.onBinary(ws, data);
      else this.onText(ws, data.toString());
    });
    ws.on("close", () => this.onClose(ws));
    ws.on("error", () => this.onClose(ws));
  }

  private onBinary(ws: WebSocket, data: Buffer): void {
    const conn = this.conns.get(ws);
    if (!conn || conn.entityId === null || !conn.room) return;
    const input = decodeInput(data);
    if (!input) return;
    conn.room.room.applyInput(conn.entityId, input.seq, input.heading);
  }

  private onText(ws: WebSocket, text: string): void {
    const msg = decodeControl<C2SControl>(text);
    if (!msg) return;
    const conn = this.conns.get(ws);
    if (!conn) return;

    if (msg.t === "join") {
      if (conn.entityId !== null) return; // đã có ghế.
      const requestedVersion = Number(msg.protocolVersion);
      if (!Number.isInteger(requestedVersion) || requestedVersion !== this.protocolVersion) {
        ws.close(4002, `protocol mismatch client=${Number.isInteger(requestedVersion) ? requestedVersion : "missing"} server=${this.protocolVersion}`);
        return;
      }
      let identity: AuthenticatedJoin | null = null;
      if (msg.ticket && this.authenticateTicket) {
        try { identity = this.authenticateTicket(msg.ticket); }
        catch { ws.close(4003, "ticket khong hop le"); return; }
      } else if (this.requireTicket) {
        ws.close(4003, "can regional ticket");
        return;
      }
      conn.identity = identity;
      const r = this.ensureActiveRoom();
      const id = r.room.join(identity?.displayName ?? msg.name, {
        colorIndex: identity?.appearance.colorIndex ?? msg.colorIndex,
        trailPattern: identity?.appearance.trailPattern ?? msg.trailPattern,
        shape: identity?.appearance.shape ?? msg.shape,
      });
      if (id === null) {
        ws.close(4001, "phong day");
        return;
      }
      conn.entityId = id;
      conn.room = r;
      conn.interestTargetId = null;
      r.conns.add(ws);
      this.send(ws, {
        t: "welcome",
        playerId: id,
        arenaRadius: CONFIG.ARENA_RADIUS,
        hexSize: CONFIG.HEX_SIZE,
        tickRate: this.tickRate,
        seed: 0,
        maxPlayers: MAX_PLAYERS,
        botCount: ONLINE_BOTS,
      });
      this.sendTerritory(ws, r);
      this.sendMinimapTerritory(ws, r);
      this.broadcastRoster(r); // đồng bộ TÊN cho mọi người trong phòng
      // Đủ người → bắt đầu; chưa đủ → cập nhật màn chờ (cho cả người vừa vào & người cũ).
      if (!r.started && r.room.occupied() >= MIN_PLAYERS) this.startGame(r);
      else this.broadcastLobby(r);
    } else if (msg.t === "interest") {
      if (msg.targetId === null) conn.interestTargetId = null;
      else if (Number.isInteger(msg.targetId) && msg.targetId >= 0)
        conn.interestTargetId = msg.targetId;
    } else if (msg.t === "ping") {
      this.send(ws, { t: "pong", time: msg.time });
    } else if (msg.t === "territory_resync") {
      if (conn.room) this.sendTerritory(ws, conn.room);
    } else if (msg.t === "territory_interest") {
      if (conn.room && Number.isFinite(msg.x) && Number.isFinite(msg.y)) {
        conn.territoryInterest = { x: msg.x, y: msg.y };
        this.sendTerritory(ws, conn.room);
      }
    } else if (msg.t === "revive") {
      if (conn.room && conn.entityId !== null) {
        if (conn.room.room.reviveSeat(conn.entityId)) conn.interestTargetId = null;
      }
    }
  }

  private onClose(ws: WebSocket): void {
    const conn = this.conns.get(ws);
    if (!conn) return;
    const r = conn.room;
    if (r && conn.entityId !== null) {
      r.room.leave(conn.entityId);
      r.conns.delete(ws);
      // Hết người trong phòng → đóng phòng ngay.
      if (r.conns.size === 0) {
        this.closeRoom(r);
      } else if (!r.ended && r.started && r.room.occupied() < MIN_PLAYERS) {
        // Đang chơi mà tụt xuống 1 người: nếu người còn lại CÒN SỐNG → họ THẮNG (người sống
        // cuối cùng); nếu đã chết → quay về phòng chờ (matching).
        this.handleLastPlayer(r);
      } else if (!r.started) {
        // Còn đang CHỜ → cập nhật lại màn chờ + roster (số người giảm).
        this.broadcastRoster(r);
        this.broadcastLobby(r);
      } else {
        // Vẫn đủ người, đang chơi → cập nhật roster.
        this.broadcastRoster(r);
      }
    }
    this.conns.delete(ws);
    this.transport.remove(ws);
  }

  private send(ws: WebSocket, msg: S2CControl): void {
    this.transport.send(ws, encodeControl(msg), "control");
  }

  /** Snapshot riêng cho mỗi client trong phòng (ackSeq/selfPrep theo ghế). */
  private broadcast(r: Room): void {
    for (const ws of r.conns) {
      const conn = this.conns.get(ws);
      if (!conn || conn.entityId === null) continue;
      this.transport.send(ws, encodeSnapshot(r.room.buildSnapshotFor(
        conn.entityId,
        this.entityAoiRadius,
        conn.interestTargetId,
      )), "snapshot", { binary: true, droppable: true });
    }
  }

  /** Gửi keyframe TERRITORY khi TỚI NHỊP định kỳ (fallback) HOẶC khi CHỦ Ô vừa đổi
   *  (territoryRevision khác lần gửi trước — capture/chết/hồi sinh). Nhờ vế thứ hai, flood
   *  fill lan tới client trong ~1 tick (+ping) thay vì chờ tới 250ms; băng thông chỉ tăng
   *  đúng những tick có thay đổi (roaming/​đặt đuôi KHÔNG bump territoryRevision). */
  private flushTerritoryIfDue(r: Room): void {
    const rev = r.room.gameState.territoryRevision;
    if (r.room.tick % TERRITORY_EVERY === 0 || rev !== r.lastTerrRev) {
      r.lastTerrRev = rev;
      this.broadcastTerritory(r);
    }
    if (r.room.tick % WORLD_UI_EVERY === 0) this.broadcastMinimapTerritory(r);
  }

  private broadcastTerritory(r: Room): void {
    for (const ws of r.conns) {
      if (ws.readyState === WebSocket.OPEN) this.sendTerritoryDelta(ws, r);
    }
  }

  private sendTerritory(ws: WebSocket, r: Room): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const conn = this.conns.get(ws);
    if (!conn) return;
    const cells = this.territoryCellsForConnection(r, conn);
    this.transport.send(ws, encodeTerritory(r.room.tick, cells), "territory_keyframe", { binary: true });
    conn.territoryRevision = 0;
    conn.territoryCells = new Map(cells.map((cell) => [this.territoryKey(cell.q, cell.r), cell]));
  }

  /** Diff theo từng connection: full keyframe khi JOIN/resync, sau đó chỉ gửi ô thay đổi. */
  private sendTerritoryDelta(ws: WebSocket, r: Room): void {
    const conn = this.conns.get(ws);
    if (!conn) return;
    const cells = this.territoryCellsForConnection(r, conn);
    const current = new Map(cells.map((cell) => [this.territoryKey(cell.q, cell.r), cell]));
    const operations: Array<
      | { operation: "upsert"; cell: TerritoryCell }
      | { operation: "remove"; q: number; r: number }
    > = [];

    for (const [key, previous] of conn.territoryCells) {
      if (!current.has(key)) operations.push({ operation: "remove", q: previous.q, r: previous.r });
    }
    for (const [key, cell] of current) {
      const previous = conn.territoryCells.get(key);
      if (!previous || previous.owner !== cell.owner || previous.kind !== cell.kind) {
        operations.push({ operation: "upsert", cell });
      }
    }
    if (operations.length === 0) return;

    // Nếu delta lớn hơn full keyframe thì full frame vừa nhỏ hơn vừa là điểm resync sạch.
    if (15 + operations.length * 7 >= 7 + cells.length * 6) {
      this.sendTerritory(ws, r);
      return;
    }
    const nextRevision = (conn.territoryRevision + 1) >>> 0;
    const sent = this.transport.send(ws, encodeTerritoryDelta({
      tick: r.room.tick,
      baseRevision: conn.territoryRevision,
      revision: nextRevision,
      operations,
    }), "territory_delta", { binary: true, droppable: true });
    if (!sent) return;
    conn.territoryRevision = nextRevision;
    conn.territoryCells = current;
  }

  private territoryKey(q: number, r: number): string {
    return `${q},${r}`;
  }

  private territoryCellsForConnection(r: Room, conn: ConnState): TerritoryCell[] {
    let focus = conn.territoryInterest;
    if (!focus && conn.entityId !== null) {
      const entity = r.room.gameState.players[conn.entityId];
      if (entity) focus = { x: entity.pos.x, y: entity.pos.y };
    }
    if (!focus) return [];
    return filterTerritoryAoi(
      r.room.gameState.territoryCells(),
      new Set(conn.territoryCells.keys()),
      focus,
      CONFIG.HEX_SIZE,
      TERRITORY_AOI_RADIUS,
      TERRITORY_AOI_HYSTERESIS
    );
  }

  private broadcastMinimapTerritory(r: Room): void {
    for (const ws of r.conns) this.sendMinimapTerritory(ws, r);
  }

  private sendMinimapTerritory(ws: WebSocket, r: Room): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    this.transport.send(ws, encodeTerritoryMinimap(r.room.tick, r.room.gameState.territoryCells()), "territory_minimap", { binary: true, droppable: true });
  }

  /** Phát event khi chuyển trạng thái (chết/đổi King/thắng). Thắng → đánh dấu phòng kết thúc. */
  private emitEvents(r: Room): void {
    const gs = r.room.gameState;
    const snap = gs.snapshotEntities();

    for (let i = 0; i < snap.length; i++) {
      const nowAlive = snap[i].alive;
      const wasAlive = r.prevAlive[i] ?? true;
      if (wasAlive && !nowAlive) {
        const ent = gs.players[i];
        this.broadcastControl(r, {
          t: "event",
          kind: "death",
          id: snap[i].id,
          cause: ent ? ent.deathCause : "",
          killerId: ent ? ent.killerId : -1,
        });
        const victim = r.matchStats.get(snap[i].id);
        if (victim) { victim.deaths++; victim.deathCause = ent ? ent.deathCause : ""; }
        if (ent && ent.killerId >= 0) {
          const killer = r.matchStats.get(ent.killerId);
          if (killer) killer.kills++;
        }
      }
      r.prevAlive[i] = nowAlive;
    }

    const king = gs.kingId();
    if (king !== r.prevKingId) {
      r.prevKingId = king;
      if (king >= 0)
        this.broadcastControl(r, { t: "event", kind: "king", kingId: king });
    }

    if (gs.won && !r.prevWon) {
      r.prevWon = true;
      this.broadcastControl(r, {
        t: "event",
        kind: "win",
        winnerId: gs.winnerId,
      });
      this.markEnded(r); // ván xong → phòng sẽ đóng sau grace.
    }
  }

  private broadcastControl(r: Room, msg: S2CControl): void {
    const text = encodeControl(msg);
    for (const ws of r.conns) {
      this.transport.send(ws, text, "control");
    }
  }

  /** Dừng mọi phòng + đóng socket + đóng server (không sót handle). */
  close(): Promise<void> {
    for (const r of this.rooms) {
      r.running = false;
      if (r.timer) {
        clearTimeout(r.timer);
        r.timer = null;
      }
    }
    this.rooms.clear();
    this.active = null;
    for (const ws of this.conns.keys()) {
      try {
        ws.terminate();
      } catch {
        // bỏ qua
      }
    }
    this.conns.clear();
    return new Promise((resolve) => this.wss.close(() => resolve()));
  }
}
