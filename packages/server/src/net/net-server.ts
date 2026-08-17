import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import {
  CONFIG,
  GAME_PROTOCOL_VERSION,
  decodeControl,
  decodeInput,
  encodeControl,
  encodeMatchConfig,
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
import { DT, TICK_RATE, MAX_HUMAN_PLAYERS, ONLINE_BOT_JOIN_INTERVAL_MS, KING_ROOM_DURATION_SECONDS, MIN_PLAYERS, ENTITY_AOI_RADIUS, TERRITORY_AOI_RADIUS, TERRITORY_AOI_HYSTERESIS, WS_BACKPRESSURE_BYTES, onlineBotCapacityForRoom, LOBBY_RECONNECT_GRACE_MS, WS_HEARTBEAT_INTERVAL_MS, WS_INPUT_RATE_PER_SEC, WS_INPUT_BURST, WS_TEXT_RATE_MAX, WS_TEXT_RATE_WINDOW_MS, WS_TEXT_FLOOD_STRIKES, WS_MAX_CONN_PER_IP } from "../config";
import { NetworkTransport, gameNetworkMetrics, type NetworkMetricsSnapshot } from "./network-transport";
import { TokenBucket, SlidingWindowCounter } from "./rate-limit";
import { serverTelemetry } from "./telemetry";

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
  /** performance.now() lúc lịch tick kế (đo event-loop lag ở đầu loop). */
  scheduledAt: number;
  /** territoryRevision lần cuối đã broadcast keyframe TERRITORY. Dùng để FLUSH NGAY khi chủ
   *  ô đổi (capture/chết) thay vì chờ nhịp định kỳ → flood fill hiện gần như tức thì. */
  lastTerrRev: number;
  lastTotemRev: number;
  // theo dõi để phát event
  prevAlive: boolean[];
  prevWon: boolean;
  prevKingId: number;
  matchId: string | null;
  startedAt: string | null;
  reported: boolean;
  participants: Map<number, AuthenticatedJoin>;
  matchStats: Map<number, { kills: number; deaths: number; deathCause: string }>;
  botActivationElapsedMs: number;
  /** Ghế đã bấm Sẵn sàng khi phòng chưa bắt đầu. */
  readySeats: Set<number>;
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
  reconnectToken: string | null;
  intentionalClose: boolean;
  /** Pha 5 · B1 — trạng thái rate-limit theo kết nối. */
  ip: string | null;
  inputBucket: TokenBucket;
  textWindow: SlidingWindowCounter;
  textStrikes: number;
}

interface ResumeSession {
  token: string;
  room: Room;
  entityId: number;
  identity: AuthenticatedJoin | null;
  socket: WebSocket | null;
  timer: NodeJS.Timeout | null;
  expiresAt: number | null;
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
  maxHumans?: number;
  onlineBots?: number;
  botJoinIntervalMs?: number;
  kingDurationSeconds?: number;
  reconnectGraceMs?: number;
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
  private readonly maxHumans: number;
  private readonly onlineBotsOverride: number | null;
  private readonly botJoinIntervalMs: number;
  private readonly kingDurationSeconds: number;
  private readonly reconnectGraceMs: number;

  /** Bật vòng lặp thời gian thực (start()); false ở chế độ test (listen() + tickOnce()). */
  private autoLoop = false;
  private nextRoomId = 1;

  // Pha 5 · B1 — ngưỡng rate-limit (từ config.ts / env).
  private readonly inputRatePerSec = WS_INPUT_RATE_PER_SEC;
  private readonly inputBurst = WS_INPUT_BURST;
  private readonly textRateMax = WS_TEXT_RATE_MAX;
  private readonly textRateWindowMs = WS_TEXT_RATE_WINDOW_MS;
  private readonly textFloodStrikes = WS_TEXT_FLOOD_STRIKES;
  private readonly maxConnPerIp = WS_MAX_CONN_PER_IP;
  /** Số socket đang mở theo IP (trần đồng thời / IP). */
  private readonly connsByIp = new Map<string, number>();

  private readonly conns = new Map<WebSocket, ConnState>();
  private readonly rooms = new Set<Room>();
  private readonly resumeSessions = new Map<string, ResumeSession>();
  private readonly socketAlive = new WeakMap<WebSocket, boolean>();
  private readonly heartbeatTimer: NodeJS.Timeout;
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
    this.maxHumans = opts.maxHumans ?? MAX_HUMAN_PLAYERS;
    this.onlineBotsOverride = opts.onlineBots === undefined
      ? null
      : Math.min(16, Math.max(0, Math.round(opts.onlineBots)));
    this.botJoinIntervalMs = opts.botJoinIntervalMs ?? ONLINE_BOT_JOIN_INTERVAL_MS;
    this.kingDurationSeconds = opts.kingDurationSeconds ?? KING_ROOM_DURATION_SECONDS;
    this.reconnectGraceMs = Math.max(100, Math.round(opts.reconnectGraceMs ?? LOBBY_RECONNECT_GRACE_MS));
    this.wss = opts.httpServer
      ? new WebSocketServer({ server: opts.httpServer, ...(opts.path ? { path: opts.path } : {}) })
      : new WebSocketServer({ port: opts.port ?? 0 });
    this.wss.on("connection", (ws, req: IncomingMessage) => this.onConnection(ws, req));
    this.heartbeatTimer = setInterval(() => this.heartbeatSockets(), WS_HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref();
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
    return this.active && !this.active.ended ? this.active.room : ([...this.rooms].find((room) => !room.ended)?.room ?? null);
  }
  /** Số phòng đang tồn tại. */
  get roomCount(): number {
    return this.rooms.size;
  }
  get networkMetrics(): NetworkMetricsSnapshot { return this.transport.snapshot(); }
  get roomStats() {
    return [...this.rooms].map((room) => ({
      id: room.id,
      humanCount: room.room.occupied(),
      activeBotCount: room.room.activeBotCount,
      capacity: room.room.capacity,
      capacityFull: room.room.occupied() >= room.room.capacity,
      kingAdmissionLocked: room.room.kingAdmissionLocked,
      ended: room.ended,
    }));
  }
  /** Lái đúng 1 tick + broadcast cho phòng đang mở (test tất định). Chỉ khi ĐÃ bắt đầu. */
  tickOnce(): void {
    for (const r of this.rooms) {
      if (!r.started || r.ended) continue;
      this.stepRoom(r);
      this.broadcast(r);
      this.broadcastWorldUiIfDue(r);
      this.flushTerritoryIfDue(r);
    }
  }

  private whenListening(): Promise<void> {
    if (this.wss.address()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.wss.once("listening", () => resolve());
      this.wss.once("error", reject);
    });
  }

  // ---- Vòng đời phòng ----
  private findJoinableRoom(): Room | null {
    for (const room of this.rooms) {
      if (!room.ended && !room.room.kingAdmissionLocked && room.room.occupied() < room.room.capacity) return room;
    }
    return null;
  }

  private ensureActiveRoom(): Room {
    const joinable = this.findJoinableRoom();
    if (joinable) { this.active = joinable; return joinable; }
    {
      const roomId = this.nextRoomId++;
      const botCapacity = this.onlineBotsOverride ?? onlineBotCapacityForRoom(roomId);
      const r: Room = {
        id: roomId,
        // Online: CHỈ người thật (0 bot). Phòng mở ở trạng thái CHỜ (chưa mô phỏng).
        room: new GameRoom(this.maxHumans, botCapacity, this.kingDurationSeconds, roomId),
        conns: new Set(),
        started: false,
        ended: false,
        endedAt: 0,
        timer: null,
        lastTime: 0,
        accumulator: 0,
        running: false,
        scheduledAt: 0,
        lastTerrRev: -1,
        lastTotemRev: -1,
        prevAlive: [],
        prevWon: false,
        prevKingId: -1,
        matchId: null,
        startedAt: null,
        reported: false,
        participants: new Map(),
        matchStats: new Map(),
        botActivationElapsedMs: 0,
        readySeats: new Set(),
      };
      r.prevAlive = r.room.gameState.snapshotEntities().map((e) => e.alive);
      this.rooms.add(r);
      this.active = r;
      serverTelemetry.setRoomsActive(this.rooms.size);
      // KHÔNG chạy vòng lặp khi mới tạo — chờ đủ người mới bắt đầu (startGame).
    }
    return this.active!;
  }

  private canStart(r: Room): boolean {
    const present = r.room.occupied();
    return !r.started && !r.ended && present >= MIN_PLAYERS &&
      r.conns.size === present && r.readySeats.size === present;
  }

  /** Đủ người và tất cả đã sẵn sàng → bắt đầu ván. */
  private startGame(r: Room): void {
    if (!this.canStart(r)) return;
    r.room.startMatch(); // spawn tươi tất cả ghế đang có người
    r.started = true;
    r.prevAlive = r.room.gameState.snapshotEntities().map((e) => e.alive);
    r.prevWon = false;
    r.prevKingId = -1;
    r.matchId = randomUUID();
    r.startedAt = new Date().toISOString();
    r.reported = false;
    r.botActivationElapsedMs = 0;
    r.participants.clear();
    r.matchStats.clear();
    r.readySeats.clear();
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
    // Population loss never awards an early win; only a completed King countdown ends a match.
    this.revertToWaiting(r);
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

  /** Phát trạng thái phòng chờ riêng từng client vì selfReady khác nhau. */
  private broadcastLobby(r: Room): void {
    for (const ws of r.conns) {
      const conn = this.conns.get(ws);
      if (!conn || conn.entityId === null) continue;
      this.send(ws, {
        t: "lobby",
        present: r.room.occupied(),
        needed: MIN_PLAYERS,
        started: r.started,
        readyCount: r.readySeats.size,
        selfReady: r.readySeats.has(conn.entityId),
      });
    }
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
    for (const ws of r.conns) {
      const conn = this.conns.get(ws);
      if (!conn || conn.entityId === null) continue;
      const radarActive = r.room.gameState.radarActiveFor(conn.entityId);
      this.send(ws, {
        t: "minimap_ui",
        radarActive,
        entities: r.room.minimapUiEntitiesFor(conn.entityId),
      });
    }
  }

  private sendTotems(ws: WebSocket, r: Room): void {
    this.send(ws, {
      t: "totems",
      revision: r.room.gameState.totemRevision,
      items: [...r.room.gameState.totemStates()],
    });
  }

  private broadcastTotemsIfChanged(r: Room): void {
    const revision = r.room.gameState.totemRevision;
    if (revision === r.lastTotemRev) return;
    r.lastTotemRev = revision;
    for (const ws of r.conns) this.sendTotems(ws, r);
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
    serverTelemetry.setRoomsActive(this.rooms.size);
    if (this.active === r) this.active = null;
    for (const [token, session] of this.resumeSessions) {
      if (session.room !== r) continue;
      if (session.timer) clearTimeout(session.timer);
      this.resumeSessions.delete(token);
    }
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
    r.scheduledAt = performance.now();
    r.timer = setTimeout(() => this.loop(r), this.tickMs);
  }

  private loop(r: Room): void {
    if (!r.running) return;
    // Pha 5 · B3 — event-loop lag: lệch giữa lúc timer ĐÁNG LẼ chạy và lúc chạy thật.
    const lag = performance.now() - (r.scheduledAt + this.tickMs);
    if (lag > 0) serverTelemetry.recordEventLoopLag(lag);
    if (r.ended) {
      if (Date.now() - r.endedAt > ENDED_GRACE_MS) this.closeRoom(r);
      else this.scheduleNext(r);
      return;
    }
    const now = Date.now();
    let elapsed = (now - r.lastTime) / 1000;
    r.lastTime = now;
    let clamped = false;
    if (elapsed > this.dt * 5) { elapsed = this.dt * 5; clamped = true; }
    r.accumulator += elapsed;

    let steps = 0;
    while (r.accumulator >= this.dt) {
      this.stepRoom(r);
      r.accumulator -= this.dt;
      steps++;
    }
    if (steps > 0) {
      serverTelemetry.recordTick(steps, clamped);
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
    const start = performance.now();
    r.room.stepTick(this.dt);
    this.reconcileBots(r, this.dt * 1000);
    this.emitEvents(r);
    serverTelemetry.recordTickStep(performance.now() - start);
  }

  private reconcileBots(r: Room, elapsedMs: number): void {
    if (r.room.kingCountdownActive || r.ended) return;
    const target = r.room.botCapacity;
    if (r.room.activeBotCount >= target) { r.botActivationElapsedMs = 0; return; }
    r.botActivationElapsedMs += elapsedMs;
    if (r.botActivationElapsedMs < this.botJoinIntervalMs) return;
    r.botActivationElapsedMs -= this.botJoinIntervalMs;
    r.room.activateNextBot();
  }

  // ---- Kết nối ----
  /** IP client: ưu tiên x-forwarded-for (sau proxy), fallback socket remoteAddress. */
  private clientIp(req?: IncomingMessage): string {
    const xff = req?.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();
    if (Array.isArray(xff) && xff.length > 0) return String(xff[0]).split(",")[0].trim();
    return req?.socket?.remoteAddress ?? "unknown";
  }

  /** Trả 1 slot IP khi socket rời this.conns (đóng hoặc bị thay bởi resume). */
  private releaseIp(ip: string | null): void {
    if (!ip) return;
    const n = this.connsByIp.get(ip);
    if (n === undefined) return;
    if (n <= 1) this.connsByIp.delete(ip);
    else this.connsByIp.set(ip, n - 1);
  }

  private onConnection(ws: WebSocket, req?: IncomingMessage): void {
    // Pha 5 · B1 — trần kết nối đồng thời / IP. Vượt → từ chối kết nối mới (không đăng ký).
    const ip = this.clientIp(req);
    const current = this.connsByIp.get(ip) ?? 0;
    if (current >= this.maxConnPerIp) {
      serverTelemetry.incIpRejected();
      try { ws.close(4008, "too many connections"); } catch { /* đã đóng */ }
      return;
    }
    this.connsByIp.set(ip, current + 1);
    this.socketAlive.set(ws, true);
    this.conns.set(ws, {
      entityId: null,
      room: null,
      identity: null,
      territoryRevision: 0,
      territoryCells: new Map(),
      territoryInterest: null,
      interestTargetId: null,
      reconnectToken: null,
      intentionalClose: false,
      ip,
      inputBucket: new TokenBucket(this.inputBurst, this.inputRatePerSec),
      textWindow: new SlidingWindowCounter(this.textRateMax, this.textRateWindowMs),
      textStrikes: 0,
    });
    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) this.onBinary(ws, data);
      else this.onText(ws, data.toString());
    });
    ws.on("close", () => this.onClose(ws));
    ws.on("error", () => this.onClose(ws));
    ws.on("pong", () => this.socketAlive.set(ws, true));
  }

  private heartbeatSockets(): void {
    for (const ws of this.conns.keys()) {
      if (!this.socketAlive.get(ws)) {
        ws.terminate();
        continue;
      }
      this.socketAlive.set(ws, false);
      try { ws.ping(); } catch { ws.terminate(); }
    }
  }

  private onBinary(ws: WebSocket, data: Buffer): void {
    const conn = this.conns.get(ws);
    if (!conn) return;
    // Pha 5 · B1 — token-bucket theo kết nối. Vượt trần → DROP im lặng khung thừa
    // (input idempotent, chỉ giữ heading mới nhất; KHÔNG ngắt kết nối).
    if (!conn.inputBucket.tryConsume()) {
      serverTelemetry.incInputDropped();
      return;
    }
    if (conn.entityId === null || !conn.room || conn.room.ended) return;
    const input = decodeInput(data);
    if (!input) return;
    conn.room.room.applyInput(conn.entityId, input.seq, input.heading);
  }

  private issueResumeSession(ws: WebSocket, conn: ConnState, r: Room, entityId: number): string {
    const token = randomUUID();
    conn.reconnectToken = token;
    this.resumeSessions.set(token, {
      token,
      room: r,
      entityId,
      identity: conn.identity,
      socket: ws,
      timer: null,
      expiresAt: null,
    });
    return token;
  }

  private sendJoinState(ws: WebSocket, conn: ConnState, r: Room, resumed: boolean): void {
    const id = conn.entityId;
    if (id === null) return;
    const reconnectToken = this.issueResumeSession(ws, conn, r, id);
    this.send(ws, {
      t: "welcome",
      playerId: id,
      arenaRadius: CONFIG.ARENA_RADIUS,
      hexSize: CONFIG.HEX_SIZE,
      tickRate: this.tickRate,
      seed: r.id,
      maxPlayers: this.maxHumans,
      botCount: r.room.botCapacity,
      // MatchConfig ĐANG CHẠY của phòng (authoritative) → client dựng lại view khớp luật/sân.
      config: encodeMatchConfig(r.room.gameState.config),
      reconnectToken,
      resumed,
    });
    this.sendTerritory(ws, r);
    this.sendMinimapTerritory(ws, r);
    this.sendTotems(ws, r);
    this.broadcastRoster(r);
    this.broadcastLobby(r);
  }

  private resumeConnection(ws: WebSocket, conn: ConnState, token: string): boolean {
    const session = this.resumeSessions.get(token);
    if (!session || session.room.ended ||
        (!session.socket && (session.expiresAt === null || session.expiresAt <= Date.now()))) return false;
    if (session.socket && session.socket !== ws) {
      // Mobile/proxy có thể giữ socket cũ ở trạng thái OPEN giả. Token là bearer
      // capability: kết nối mới hợp lệ được quyền thay thế socket cũ nhưng giữ nguyên ghế.
      const staleSocket = session.socket;
      const staleConn = this.conns.get(staleSocket);
      session.room.conns.delete(staleSocket);
      if (staleConn) {
        staleConn.room = null;
        staleConn.entityId = null;
        staleConn.reconnectToken = null;
        staleConn.intentionalClose = true;
      }
      this.conns.delete(staleSocket);
      this.releaseIp(staleConn?.ip ?? null);
      this.transport.remove(staleSocket);
      try { staleSocket.terminate(); } catch { /* đã đóng */ }
    }
    if (session.timer) clearTimeout(session.timer);
    this.resumeSessions.delete(token);
    conn.entityId = session.entityId;
    conn.room = session.room;
    conn.identity = session.identity;
    conn.interestTargetId = null;
    session.room.conns.add(ws);
    this.sendJoinState(ws, conn, session.room, true);
    if (this.canStart(session.room)) this.startGame(session.room);
    return true;
  }

  private afterSeatRemoved(r: Room): void {
    if (r.room.occupied() === 0) {
      this.closeRoom(r);
    } else if (!r.ended && r.started && r.room.occupied() < MIN_PLAYERS) {
      this.handleLastPlayer(r);
    } else {
      this.broadcastRoster(r);
      this.broadcastLobby(r);
    }
  }

  private removeConnectionSeat(ws: WebSocket, conn: ConnState): void {
    const r = conn.room;
    const entityId = conn.entityId;
    if (!r || entityId === null) return;
    if (conn.reconnectToken) {
      const session = this.resumeSessions.get(conn.reconnectToken);
      if (session?.timer) clearTimeout(session.timer);
      this.resumeSessions.delete(conn.reconnectToken);
    }
    r.readySeats.delete(entityId);
    r.room.leave(entityId);
    r.conns.delete(ws);
    conn.room = null;
    conn.entityId = null;
    conn.reconnectToken = null;
    this.afterSeatRemoved(r);
  }

  private expireResumeSession(token: string): void {
    const session = this.resumeSessions.get(token);
    if (!session || session.socket) return;
    this.resumeSessions.delete(token);
    const r = session.room;
    r.readySeats.delete(session.entityId);
    r.room.leave(session.entityId);
    this.afterSeatRemoved(r);
  }

  private onText(ws: WebSocket, text: string): void {
    const conn = this.conns.get(ws);
    if (!conn) return;
    // Pha 5 · B1 — rate-limit khung text theo kết nối (cửa sổ trượt). Mọi khung đều đếm
    // (kể cả rác) để chặn flood mở phiên. Vượt lặp lại đủ số strike → ĐÓNG socket.
    if (!conn.textWindow.record()) {
      conn.textStrikes++;
      serverTelemetry.incTextFlood();
      if (conn.textStrikes >= this.textFloodStrikes) {
        serverTelemetry.incTextDisconnect();
        try { ws.close(4009, "text rate limit"); } catch { /* đã đóng */ }
      }
      return;
    }
    const msg = decodeControl<C2SControl>(text);
    if (!msg) return;

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
      if (msg.reconnectToken) {
        if (!this.resumeConnection(ws, conn, msg.reconnectToken)) {
          ws.close(4003, "reconnect token khong hop le hoac da het han");
        }
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
      r.readySeats.delete(id);
      if (r.started) {
        const joinedIdentity = identity ?? { playerId: null, guestId: `legacy-${r.id}-${id}`, isGuest: true, platform: "web", displayName: r.room.gameState.nameOf(id), appearance: { colorIndex: 0, shape: "cube", trailPattern: "solid" } as PlayerAppearance };
        r.participants.set(id, joinedIdentity);
        r.matchStats.set(id, { kills: 0, deaths: 0, deathCause: "" });
      }
      this.sendJoinState(ws, conn, r, false);
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
    } else if (msg.t === "lobby_ready") {
      if (conn.room && conn.entityId !== null && !conn.room.started && !conn.room.ended) {
        if (msg.ready) conn.room.readySeats.add(conn.entityId);
        else conn.room.readySeats.delete(conn.entityId);
        this.broadcastLobby(conn.room);
        if (this.canStart(conn.room)) this.startGame(conn.room);
      }
    } else if (msg.t === "lobby_cancel") {
      conn.intentionalClose = true;
      this.removeConnectionSeat(ws, conn);
      ws.close(1000, "roi phong");
    } else if (msg.t === "revive") {
      if (conn.room && conn.entityId !== null) {
        const entity = conn.room.room.gameState.players[conn.entityId];
        if (!entity || entity.phase !== "dead") {
          this.send(ws, { t: "revive_result", ok: false, reason: "not_dead" });
        } else if (conn.room.room.kingCountdownActive) {
          this.send(ws, { t: "revive_result", ok: false, reason: "king_locked" });
        } else if (conn.room.room.reviveSeat(conn.entityId)) {
          conn.interestTargetId = null;
          this.send(ws, { t: "revive_result", ok: true });
        } else {
          this.send(ws, { t: "revive_result", ok: false, reason: "no_spawn" });
        }
      }
    }
  }

  private onClose(ws: WebSocket): void {
    const conn = this.conns.get(ws);
    if (!conn) return;
    this.conns.delete(ws);
    this.releaseIp(conn.ip);
    this.transport.remove(ws);
    const r = conn.room;
    if (r && conn.entityId !== null) {
      r.conns.delete(ws);
      if (conn.intentionalClose || !conn.reconnectToken || r.ended) {
        this.removeConnectionSeat(ws, conn);
      } else {
        const session = this.resumeSessions.get(conn.reconnectToken);
        if (!session) {
          this.removeConnectionSeat(ws, conn);
        } else {
          session.socket = null;
          session.expiresAt = Date.now() + this.reconnectGraceMs;
          session.timer = setTimeout(() => this.expireResumeSession(session.token), this.reconnectGraceMs);
          this.broadcastLobby(r);
        }
      }
    }
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
    this.broadcastTotemsIfChanged(r);
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
    const conn = this.conns.get(ws);
    if (!conn || conn.entityId === null) return;
    const radarActive = r.room.gameState.radarActiveFor(conn.entityId);
    const cells = r.room.gameState.territoryCells().filter(
      (cell) => radarActive || cell.owner === conn.entityId
    );
    this.transport.send(ws, encodeTerritoryMinimap(r.room.tick, cells), "territory_minimap", { binary: true, droppable: true });
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
      const finalScores = r.room.worldUiEntities()
        .map((entity) => ({ id: entity.id, score: entity.score }))
        .sort((a, b) => b.score - a.score || a.id - b.id)
        .map((entity, index) => ({ ...entity, placement: index + 1 }));
      this.broadcastControl(r, {
        t: "event",
        kind: "match_end",
        winnerId: gs.winnerId,
        reason: "king_countdown",
        finalScores,
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
    clearInterval(this.heartbeatTimer);
    for (const r of this.rooms) {
      r.running = false;
      if (r.timer) {
        clearTimeout(r.timer);
        r.timer = null;
      }
    }
    this.rooms.clear();
    this.active = null;
    for (const session of this.resumeSessions.values()) {
      if (session.timer) clearTimeout(session.timer);
    }
    this.resumeSessions.clear();
    for (const ws of this.conns.keys()) {
      try {
        ws.terminate();
      } catch {
        // bỏ qua
      }
    }
    this.conns.clear();
    this.connsByIp.clear();
    serverTelemetry.setRoomsActive(0);
    return new Promise((resolve) => this.wss.close(() => resolve()));
  }
}
