/**
 * virtual-client.mjs — một CLIENT NGƯỜI THẬT mô phỏng cho harness load/soak.
 *
 * Vòng đời khớp `net-server.ts#onText`:
 *   1. mở ws tới `<wsUrl>` (mặc định ws://localhost:8910/game)
 *   2. gửi text JOIN {t:"join", protocolVersion:5, name, colorIndex, shape, trailPattern}
 *   3. nhận WELCOME (text) → lấy playerId + reconnectToken (token issued mỗi welcome)
 *   4. orchestrator gọi ready() → gửi {t:"lobby_ready", ready:true} (canStart cần MỌI
 *      conn trong phòng đều ready) → server startGame khi đủ điều kiện
 *   5. phát KHUNG INPUT nhị phân ở nhịp thực (~24 msg/s, heading random-walk mượt)
 *   6. đọc SNAPSHOT (tag 102) để xác nhận SỐNG + đo độ trễ ack (input→snapshot phía client)
 *
 * Hỗ trợ RECONNECT CHURN: terminate() giả rớt mạng rồi resume trong grace 30s bằng token
 * (bám đúng đường resume ở net-server.ts#resumeConnection).
 */
import { WebSocket } from "ws";
import {
  GAME_PROTOCOL_VERSION,
  TAG,
  encodeInput,
  encodeControl,
  decodeControl,
  peekTag,
  peekSnapshot,
  readSelfRadar,
} from "./protocol.mjs";

const SHAPES = ["cube", "sphere", "cone", "cylinder"];
const TRAILS = ["solid", "stripe", "dash"];

let SEQ_ID = 0;

export class VirtualClient {
  /**
   * @param {object} opts
   * @param {string} opts.wsUrl
   * @param {number} [opts.inputRate]  khung input / giây (mặc định 24 ≈ tick rate)
   * @param {number} [opts.turnStep]   biên độ đổi heading mỗi khung (rad)
   * @param {boolean} [opts.interest]  bật gửi interest/territory_interest định kỳ (biến thể AoI)
   * @param {(c:VirtualClient)=>void} [opts.onEnded] gọi khi match_end / phòng đóng
   */
  constructor(opts) {
    this.wsUrl = opts.wsUrl;
    this.inputRate = opts.inputRate ?? 24;
    this.turnStep = opts.turnStep ?? 0.35;
    this.interest = opts.interest ?? false;
    this.onEnded = opts.onEnded ?? null;
    this.id = ++SEQ_ID;
    this.name = `load-${this.id}`;

    this.ws = null;
    this.playerId = null;
    this.reconnectToken = null;
    this.heading = Math.random() * Math.PI * 2 - Math.PI;
    this.seq = 0;
    this.inputTimer = null;
    this.interestTimer = null;
    this.closedByHarness = false;
    this.expectResume = false;

    // Đo lường (per-client, tổng hợp ở orchestrator).
    this.stats = {
      connects: 0,
      resumes: 0,
      rejoins: 0,
      snapshots: 0,
      snapshotBytes: 0,
      inputsSent: 0,
      lastTick: 0,
      firstSnapshotAt: 0,
      started: false,
      radarSeen: false,
      ackLatencies: [], // ms: từ lúc gửi seq đến snapshot có ackSeq >= seq
    };
    this._sendTimeBySeq = new Map(); // seq -> hrtime ms
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl, { perMessageDeflate: false });
      ws.binaryType = "nodebuffer";
      this.ws = ws;
      let settled = false;

      ws.on("open", () => {
        this.stats.connects++;
        const join = {
          t: "join",
          name: this.name,
          protocolVersion: GAME_PROTOCOL_VERSION,
          colorIndex: this.id % 8,
          shape: SHAPES[this.id % SHAPES.length],
          trailPattern: TRAILS[this.id % TRAILS.length],
        };
        if (this.expectResume && this.reconnectToken) {
          join.reconnectToken = this.reconnectToken;
        }
        ws.send(encodeControl(join));
      });

      ws.on("message", (data, isBinary) => {
        if (isBinary) this._onBinary(data);
        else this._onText(data.toString());
        if (!settled && this.playerId !== null) {
          settled = true;
          resolve(this);
        }
      });

      ws.on("close", (code) => {
        this._stopLoops();
        if (this.closedByHarness) return;
        // Rớt ngoài ý muốn (match_end / kick / lỗi) → báo orchestrator để xử lý rejoin.
        if (!settled) {
          settled = true;
          reject(new Error(`ws closed before welcome (code=${code})`));
          return;
        }
        if (this.onEnded) this.onEnded(this);
      });

      ws.on("error", (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
    });
  }

  _onText(text) {
    const msg = decodeControl(text);
    if (!msg) return;
    if (msg.t === "welcome") {
      this.playerId = msg.playerId;
      this.reconnectToken = msg.reconnectToken ?? this.reconnectToken;
      if (msg.resumed) this.stats.resumes++;
      this._startInputLoop();
      if (this.interest) this._startInterestLoop();
    } else if (msg.t === "lobby") {
      if (msg.started) this.stats.started = true;
    } else if (msg.t === "event" && msg.kind === "match_end") {
      // Ván kết thúc: server sẽ đóng phòng sau grace. Đánh dấu để rejoin fresh.
      this.stats.started = false;
    } else if (msg.t === "revive_result") {
      // bỏ qua
    }
  }

  _onBinary(data) {
    const tag = peekTag(data);
    if (tag === TAG.SNAPSHOT) {
      const snap = peekSnapshot(data);
      if (!snap) return;
      this.stats.snapshots++;
      this.stats.snapshotBytes += snap.bytes;
      this.stats.lastTick = snap.tick;
      if (!this.stats.firstSnapshotAt) this.stats.firstSnapshotAt = now();
      if (snap.selfPrep === 0) this.stats.started = true;
      // Ack latency: snapshot xác nhận đã áp tới ackSeq.
      if (snap.ackSeq > 0) {
        for (const [seq, t] of this._sendTimeBySeq) {
          if (seq <= snap.ackSeq) {
            this.stats.ackLatencies.push(now() - t);
            this._sendTimeBySeq.delete(seq);
          }
        }
        // chặn rò bộ nhớ nếu ack không tiến (ví dụ chưa vào trận)
        if (this._sendTimeBySeq.size > 256) this._sendTimeBySeq.clear();
      }
      if (this.playerId !== null && readSelfRadar(data, this.playerId)) {
        this.stats.radarSeen = true;
      }
    }
    // TERRITORY / MINIMAP: chỉ tính là traffic downstream (đã đo qua /health/network).
  }

  /** Orchestrator gọi khi muốn client báo Sẵn sàng (điều khiển thời điểm startGame). */
  ready() {
    this._send({ t: "lobby_ready", ready: true });
  }

  _startInputLoop() {
    if (this.inputTimer) return;
    const periodMs = 1000 / this.inputRate;
    this.inputTimer = setInterval(() => {
      // Random-walk mượt trong [-π, π].
      this.heading += (Math.random() - 0.5) * 2 * this.turnStep;
      if (this.heading > Math.PI) this.heading -= Math.PI * 2;
      else if (this.heading < -Math.PI) this.heading += Math.PI * 2;
      this.seq++;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(encodeInput(this.seq, this.heading), { binary: true });
        this.stats.inputsSent++;
        this._sendTimeBySeq.set(this.seq, now());
      }
    }, periodMs);
    this.inputTimer.unref?.();
  }

  _startInterestLoop() {
    if (this.interestTimer) return;
    this.interestTimer = setInterval(() => {
      // Biến thể AoI: đổi tiêu điểm territory + entity interest quanh sân.
      const x = (Math.random() - 0.5) * 200;
      const y = (Math.random() - 0.5) * 200;
      this._send({ t: "territory_interest", x, y });
      this._send({ t: "interest", targetId: null });
    }, 3000);
    this.interestTimer.unref?.();
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeControl(obj));
    }
  }

  _stopLoops() {
    if (this.inputTimer) clearInterval(this.inputTimer);
    if (this.interestTimer) clearInterval(this.interestTimer);
    this.inputTimer = null;
    this.interestTimer = null;
  }

  /** Giả rớt mạng (giữ token) → sẽ resume trong grace. */
  drop() {
    this.expectResume = true;
    this._stopLoops();
    try {
      this.ws?.terminate();
    } catch {
      /* đã đóng */
    }
  }

  /** Resume phiên bằng reconnectToken (đường net-server.ts#resumeConnection). */
  async resume() {
    await this.connect();
    this.expectResume = false;
    return this;
  }

  /** Rejoin FRESH (mất ghế cũ / phòng đóng) — token mới, ghế mới. */
  async rejoin() {
    this.expectResume = false;
    this.reconnectToken = null;
    this.playerId = null;
    this.seq = 0;
    this._sendTimeBySeq.clear();
    await this.connect();
    this.stats.rejoins++;
    return this;
  }

  close() {
    this.closedByHarness = true;
    this._stopLoops();
    try {
      this.ws?.close(1000, "harness done");
    } catch {
      /* noop */
    }
  }
}

function now() {
  return Number(process.hrtime.bigint() / 1000n) / 1000; // ms, phân giải cao
}
