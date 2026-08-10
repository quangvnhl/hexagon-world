import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  decodeControl,
  decodeSnapshot,
  encodeControl,
  encodeInput,
  peekTag,
  TAG,
  type S2CControl,
  type Snapshot,
} from "@hexagon/shared";
import { NetServer } from "../src/net/net-server";
import { MAX_PLAYERS } from "../src/config";

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

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        if (peekTag(data) === TAG.SNAPSHOT) {
          const s = decodeSnapshot(data);
          if (s) this.snapshots.push(s);
        }
      } else {
        const msg = decodeControl<S2CControl>(data.toString());
        if (msg && msg.t === "welcome") this.welcome = msg;
      }
    });
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
  }

  join(name: string): void {
    this.ws.send(encodeControl({ t: "join", name }));
  }

  input(seq: number, heading: number): void {
    this.ws.send(encodeInput(seq, heading));
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
    server = new NetServer({ port: 0 });
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
    a.join("An");
    b.join("Binh");
    await Promise.all([a.waitWelcome(), b.waitWelcome()]);
    expect(a.welcome).not.toBeNull();
    expect(b.welcome).not.toBeNull();
    const idA = a.welcome!.playerId;
    const idB = b.welcome!.playerId;
    expect(idA).not.toBe(idB);
    expect(a.welcome!.tickRate).toBe(24);
    expect(a.welcome!.arenaRadius).toBeGreaterThan(0);

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

    // Online KHÔNG bot → snapshot liệt kê đúng MAX_PLAYERS ghế người (ghế trống = đã "đỗ").
    expect(lastA.entities.length).toBe(MAX_PLAYERS);

    // Vị trí thực thể của CHÍNH client thay đổi theo thời gian (đã qua prep, đang chạy).
    const ownFirst = firstA.entities.find((e) => e.id === idA)!;
    const ownLast = lastA.entities.find((e) => e.id === idA)!;
    expect(ownFirst).toBeDefined();
    expect(ownLast).toBeDefined();
    const moved = Math.hypot(ownLast.x - ownFirst.x, ownLast.y - ownFirst.y);
    expect(moved).toBeGreaterThan(0.5);
    expect(ownLast.alive).toBe(true);

    // Entity của A cũng xuất hiện trong snapshot của B (thế giới dùng chung).
    const bSeesA = b.snapshots[b.snapshots.length - 1].entities.find(
      (e) => e.id === idA,
    );
    expect(bSeesA).toBeDefined();

    // selfPrep có mặt trong snapshot (số hợp lệ, đã hết prep sau 96 tick → 0).
    expect(typeof lastA.selfPrep).toBe("number");
    expect(lastA.selfPrep).toBe(0);
  });

  it("VÒNG ĐỜI: phòng tạo khi JOIN, ĐÓNG khi hết người", async () => {
    server = new NetServer({ port: 0 });
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
