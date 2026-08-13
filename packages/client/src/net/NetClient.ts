// Lớp bọc WebSocket phía trình duyệt cho netplay (Pha 2). Vì dùng `WebSocket` nên KHÔNG
// được unit-test trực tiếp — giữ logic MỎNG, ủy thác toàn bộ tính toán cho các module
// thuần: `Predictor` (dự đoán/hòa giải đầu cục bộ) và `InterpolationBuffer` (nội suy
// thực thể từ xa).
//
// Luồng:
//  - connect(url): mở WS, gửi JOIN. Nhận WELCOME (text) → lưu playerId/arenaRadius/…
//  - sendInput(targetHeading, dt): tăng seq, encodeInput → gửi binary; đẩy input vào
//    Predictor để dự đoán tức thì.
//  - onmessage (binary) → decodeSnapshot → nạp thực thể từ xa vào InterpolationBuffer
//    và hòa giải đầu cục bộ bằng ackSeq + trạng thái server của entity cục bộ.
//  - getRenderState(): đọc mỗi frame → { self: đầu đã dự đoán, others: thực thể nội suy }.

import {
  EntitySnap,
  Snapshot,
  decodeControl,
  decodeSnapshot,
  decodeTerritory,
  decodeTerritoryMinimap,
  decodeTerritoryDelta,
  encodeControl,
  encodeInput,
  peekTag,
  TAG,
  GAME_PROTOCOL_VERSION,
  DEFAULT_PLAYER_APPEARANCE,
  sanitizePlayerAppearance,
  type PlayerAppearance,
  type S2CControl,
  type TerritoryCell,
  type WorldUiEntity,
} from "@hexagon/shared";
import { Predictor } from "./prediction";
import { InterpolationBuffer, InterpState, INTERP_DELAY_MS } from "./interpolation";
import { HeadState } from "./stepHead";
import { shouldSendTerritoryInterest, type TerritoryInterestState } from "./territoryInterest";

/** URL server mặc định (override qua biến môi trường build-time của Next). */
export const DEFAULT_SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "ws://localhost:8910";

export type ConnStatus = "idle" | "connecting" | "open" | "closed" | "error";

/** Thông tin trận từ WELCOME. */
export interface WelcomeInfo {
  playerId: number;
  arenaRadius: number;
  hexSize: number;
  tickRate: number;
  seed: number;
  maxPlayers: number;
  botCount: number;
}

/** Một thực thể để render (đã gộp thông tin hiển thị từ snapshot mới nhất). */
export interface RenderEntity {
  id: number;
  x: number;
  y: number;
  heading: number;
  colorIndex: number;
  trailPatternIndex: number;
  shapeIndex: number;
  alive: boolean;
  hasTrail: boolean;
  score: number;
}

/** Trạng thái render tổng hợp đọc mỗi frame. */
export interface RenderState {
  status: ConnStatus;
  playerId: number | null;
  /** Đầu người chơi cục bộ đã dự đoán (null nếu chưa có). */
  self: RenderEntity | null;
  /** Các thực thể từ xa đã nội suy. */
  others: RenderEntity[];
  playerCount: number;
  /** Ms chuẩn bị còn lại của người chơi cục bộ (>0 = đang đếm ngược, đứng yên). */
  selfPrep: number;
  /** Giây còn phải giữ ngôi KING để thắng (server tính) — cho đồng hồ 3 phút ở HUD. */
  kingHold: number;
  /** Ping (RTT) tới server tính bằng ms (0 nếu chưa đo). */
  ping: number;
}

/** Trạng thái PHÒNG CHỜ online. */
export interface LobbyInfo {
  /** Số người thật hiện có trong phòng. */
  present: number;
  /** Số người thật cần để bắt đầu. */
  needed: number;
  /** Đã vào trận chưa (false = còn đang chờ). */
  started: boolean;
}

/** Callback tuỳ chọn để UI phản ứng theo sự kiện (không bắt buộc). */
export interface NetClientHandlers {
  onStatus?: (s: ConnStatus) => void;
  onWelcome?: (w: WelcomeInfo) => void;
  onEvent?: (ev: Extract<S2CControl, { t: "event" }>) => void;
  onLobby?: (l: LobbyInfo) => void;
  /** Danh sách tên người chơi theo ghế (id → name). */
  onRoster?: (players: { id: number; name: string }[]) => void;
  onWorldUi?: (entities: WorldUiEntity[]) => void;
}

export class NetClient {
  private ws: WebSocket | null = null;
  private status: ConnStatus = "idle";
  private welcome: WelcomeInfo | null = null;
  /** Trạng thái phòng chờ mới nhất (null trước khi nhận). */
  private lobby: LobbyInfo | null = null;
  /** Roster tên người chơi mới nhất. */
  private roster: { id: number; name: string }[] = [];
  /** Toàn bộ người tham gia phục vụ UI nhịp thấp; độc lập với entity AoI của scene 3D. */
  private worldUi: WorldUiEntity[] = [];

  private readonly predictor = new Predictor();
  private readonly interp = new InterpolationBuffer();

  /** seq input tăng dần gửi lên server. */
  private seq = 0;

  /** Ping (RTT) đã đo tới server (ms, làm mượt nhẹ). */
  private ping = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  /** Snapshot mới nhất — nguồn thông tin hiển thị (color/alive/score) cho mọi entity. */
  private latest: Snapshot | null = null;
  /** Trạng thái sống ở snapshot gần nhất đã thấy, dùng nhận diện dead → alive (respawn). */
  private readonly lastAlive = new Map<number, boolean>();

  /** Keyframe LÃNH THỔ mới nhất + phiên bản (tăng mỗi keyframe) để renderer chỉ dựng lại
   *  lưới đất/đuôi khi có thay đổi, không phải mỗi frame. */
  private territory: TerritoryCell[] = [];
  private territoryVersion = 0;
  private territoryRevision = 0;
  private minimapTerritory: TerritoryCell[] = [];
  private minimapTerritoryVersion = 0;
  private territoryInterest: TerritoryInterestState | null = null;
  /** Trả offset thời gian giữa đồng hồ client và tick server không cần thiết ở Pha 2:
   *  ta dùng thời gian client (performance.now / Date.now) làm mốc cho InterpolationBuffer. */

  /** Callback UI — có thể gán/đổi sau khi khởi tạo (dùng bởi hook React). */
  handlers: NetClientHandlers;

  constructor(handlers: NetClientHandlers = {}) {
    this.handlers = handlers;
  }

  /** Đồng hồ hiện tại (ms). Tách hàm để dễ thay trong môi trường không có performance. */
  private now(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  private setStatus(s: ConnStatus): void {
    this.status = s;
    this.handlers.onStatus?.(s);
  }

  /** Mở kết nối và gửi JOIN. */
  connect(
    url: string = DEFAULT_SERVER_URL,
    name = "Bạn",
    appearance: PlayerAppearance = DEFAULT_PLAYER_APPEARANCE,
    ticket?: string
  ): void {
    this.disconnect();
    this.setStatus("connecting");
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      this.setStatus("open");
      const look = sanitizePlayerAppearance(appearance);
      ws.send(encodeControl({ t: "join", name, ticket, ...look, protocolVersion: GAME_PROTOCOL_VERSION }));
      // Đo ping định kỳ (mỗi 1s) để hiển thị độ trễ mạng.
      this.sendPing();
      this.pingTimer = setInterval(() => this.sendPing(), 1000);
    };
    ws.onclose = () => this.setStatus("closed");
    ws.onerror = () => this.setStatus("error");
    ws.onmessage = (ev: MessageEvent) => this.onMessage(ev.data);
  }

  /** Gửi PING đo RTT. */
  private sendPing(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeControl({ t: "ping", time: this.now() }));
    }
  }

  /** Ping (RTT) mới nhất tới server (ms). */
  getPing(): number {
    return this.ping;
  }

  /** Đóng kết nối và dọn trạng thái nội suy. */
  disconnect(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {
        /* bỏ qua */
      }
      this.ws = null;
    }
    this.interp.clear();
    this.lastAlive.clear();
    this.territoryInterest = null;
    this.latest = null;
    this.welcome = null;
    this.lobby = null;
    this.roster = [];
    this.worldUi = [];
    this.territory = [];
    this.territoryVersion++;
    this.territoryRevision = 0;
  }

  /**
   * Gửi ý định điều khiển (heading mong muốn) cho khoảng thời gian `dt` (giây).
   * Tăng seq, mã hoá binary rồi gửi; đồng thời đẩy vào Predictor để dự đoán tức thì.
   */
  sendInput(targetHeading: number, dt: number): void {
    this.seq = (this.seq + 1) >>> 0;
    this.predictor.applyInput(this.seq, targetHeading, dt);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeInput(this.seq, targetHeading));
    }
  }

  /**
   * Gửi HƯỚNG ngắm khi đang CHUẨN BỊ (prep): server chỉ xoay đầu, KHÔNG di chuyển. Không
   * đẩy vào Predictor → không dự đoán tiến (tránh giật khi server còn đứng yên).
   */
  sendAim(targetHeading: number): void {
    this.seq = (this.seq + 1) >>> 0;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeInput(this.seq, targetHeading));
    }
  }

  /** Gửi yêu cầu HỒI SINH lên server (khi bấm nút trong popup chết). */
  sendRevive(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeControl({ t: "revive" }));
    }
  }

  private onMessage(data: unknown): void {
    if (typeof data === "string") {
      this.onControl(data);
      return;
    }
    // Binary frame (ArrayBuffer).
    const buf = data as ArrayBuffer;
    const tag = peekTag(buf);
    if (tag === TAG.SNAPSHOT) {
      const snap = decodeSnapshot(buf);
      if (snap) this.onSnapshot(snap);
    } else if (tag === TAG.TERRITORY) {
      const kf = decodeTerritory(buf);
      if (kf) {
        this.territory = kf.cells;
        this.territoryRevision = 0;
        this.territoryVersion++;
      }
    } else if (tag === TAG.TERRITORY_DELTA) {
      const delta = decodeTerritoryDelta(buf);
      if (!delta || delta.baseRevision !== this.territoryRevision) {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(encodeControl({ t: "territory_resync" }));
        }
        return;
      }
      const cells = new Map(this.territory.map((cell) => [`${cell.q},${cell.r}`, cell]));
      for (const change of delta.operations) {
        if (change.operation === "remove") cells.delete(`${change.q},${change.r}`);
        else cells.set(`${change.cell.q},${change.cell.r}`, change.cell);
      }
      this.territory = [...cells.values()];
      this.territoryRevision = delta.revision;
      this.territoryVersion++;
    } else if (tag === TAG.TERRITORY_MINIMAP) {
      const keyframe = decodeTerritoryMinimap(buf);
      if (keyframe) {
        this.minimapTerritory = keyframe.cells;
        this.minimapTerritoryVersion++;
      }
    }
  }

  /** Keyframe lãnh thổ mới nhất + phiên bản (đọc để dựng lại lưới khi version đổi). */
  getTerritory(): { version: number; cells: TerritoryCell[] } {
    return { version: this.territoryVersion, cells: this.territory };
  }

  /** Cập nhật tâm AoI khi camera spectator đổi mục tiêu; null để server tự chọn leader. */
  sendSpectateTarget(targetId: number | null): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeControl({ t: "interest", targetId }));
    }
  }

  getMinimapTerritory(): { version: number; cells: TerritoryCell[] } {
    return { version: this.minimapTerritoryVersion, cells: this.minimapTerritory };
  }

  /** Move the territory AoI only after meaningful camera movement (hysteresis). */
  setTerritoryInterest(x: number, y: number): void {
    const now = this.now();
    if (!shouldSendTerritoryInterest(this.territoryInterest, x, y, now)) return;
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(encodeControl({ t: "territory_interest", x, y }));
    this.territoryInterest = { x, y, sentAt: now };
  }

  private onControl(text: string): void {
    const msg = decodeControl<S2CControl>(text);
    if (!msg) return;
    switch (msg.t) {
      case "welcome": {
        this.interp.clear();
        this.lastAlive.clear();
        this.welcome = {
          playerId: msg.playerId,
          arenaRadius: msg.arenaRadius,
          hexSize: msg.hexSize,
          tickRate: msg.tickRate,
          seed: msg.seed,
          maxPlayers: msg.maxPlayers,
          botCount: msg.botCount,
        };
        this.seq = 0;
        this.lobby = null; // ván mới → chờ trạng thái phòng chờ tiếp theo
        this.roster = [];
        this.worldUi = [];
        this.handlers.onWelcome?.(this.welcome);
        break;
      }
      case "pong": {
        // RTT = giờ hiện tại - dấu thời gian đã gửi. Làm mượt nhẹ (EMA) cho đỡ nhảy số.
        const rtt = Math.max(0, Math.round(this.now() - msg.time));
        this.ping = this.ping > 0 ? Math.round(this.ping * 0.6 + rtt * 0.4) : rtt;
        break;
      }
      case "lobby": {
        this.lobby = {
          present: msg.present,
          needed: msg.needed,
          started: msg.started,
        };
        this.handlers.onLobby?.(this.lobby);
        if (!msg.started) {
          // Ván kế tiếp spawn lại toàn bộ ghế; không giữ lịch sử vị trí từ ván cũ.
          this.interp.clear();
          this.lastAlive.clear();
        }
        break;
      }
      case "roster": {
        this.roster = msg.players;
        this.handlers.onRoster?.(msg.players);
        break;
      }
      case "world_ui": {
        this.worldUi = msg.entities;
        this.handlers.onWorldUi?.(msg.entities);
        break;
      }
      case "event":
        if (msg.kind === "death") this.lastAlive.set(msg.id, false);
        this.handlers.onEvent?.(msg);
        break;
    }
  }

  private onSnapshot(snap: Snapshot): void {
    const previous = this.latest;
    this.latest = snap;
    const t = this.now();

    // Snapshot là tập authoritative của AoI. Xóa entity vắng khỏi toàn bộ lịch sử nội suy;
    // khi enter lại nó được xem như spawn mới và không kéo theo tọa độ cũ.
    if (previous) {
      const currentIds = new Set(snap.entities.map((entity) => entity.id));
      for (const entity of previous.entities) {
        if (!currentIds.has(entity.id)) {
          this.interp.removeEntity(entity.id);
          this.lastAlive.delete(entity.id);
        }
      }
    }

    // Nạp thực thể TỪ XA (không phải người chơi cục bộ) vào buffer nội suy.
    const remote = new Map<number, InterpState>();
    let localSnap: EntitySnap | null = null;
    let localSpawned = false;
    for (const e of snap.entities) {
      const wasAlive = this.lastAlive.get(e.id);
      const spawned = e.alive && wasAlive !== true;
      this.lastAlive.set(e.id, e.alive);
      if (this.welcome && e.id === this.welcome.playerId) {
        localSnap = e;
        localSpawned = spawned;
        continue;
      }
      const state = { x: e.x, y: e.y, heading: e.heading };
      if (spawned) this.interp.teleportEntity(e.id, state);
      remote.set(e.id, state);
    }
    this.interp.insert(t, remote);

    // Hòa giải đầu CỤC BỘ với trạng thái server của chính nó + ackSeq.
    if (localSnap) {
      const serverHead: HeadState = {
        x: localSnap.x,
        y: localSnap.y,
        heading: localSnap.heading,
      };
      if (localSpawned) {
        this.predictor.reset(serverHead);
      } else {
        this.predictor.onServerState(serverHead, snap.ackSeq);
      }
    }
  }

  /** Đọc mỗi frame: đầu cục bộ (dự đoán) + thực thể từ xa (nội suy). */
  getRenderState(): RenderState {
    const playerId = this.welcome?.playerId ?? null;

    // Bản đồ thông tin hiển thị từ snapshot mới nhất.
    const meta = new Map<number, EntitySnap>();
    if (this.latest) for (const e of this.latest.entities) meta.set(e.id, e);

    // Đầu cục bộ.
    let self: RenderEntity | null = null;
    if (playerId !== null && meta.has(playerId)) {
      const m = meta.get(playerId)!;
      const p = this.predictor.getRenderHead();
      self = {
        id: playerId,
        x: p.x,
        y: p.y,
        heading: p.heading,
        colorIndex: m.colorIndex,
        trailPatternIndex: m.trailPatternIndex,
        shapeIndex: m.shapeIndex,
        alive: m.alive,
        hasTrail: m.hasTrail,
        score: m.score,
      };
    }

    // Thực thể từ xa: nội suy tại (ĐỒNG HỒ HIỆN TẠI - độ trễ). Dùng now() thay vì thời
    // điểm snapshot cuối → thời gian render tiến LIÊN TỤC giữa 2 snapshot → mượt ở 60fps
    // (nếu pin theo snapshot-cuối thì thực thể chỉ nhảy mỗi 24Hz → GIẬT).
    const sampled = this.interp.sample(this.now() - INTERP_DELAY_MS);
    const others: RenderEntity[] = [];
    for (const [id, s] of sampled) {
      const m = meta.get(id);
      // InterpolationBuffer có thể còn giữ frame cũ thêm INTERP_DELAY_MS sau khi entity đã
      // rời AoI. Không có trong snapshot MỚI NHẤT nghĩa là không được render trong scene.
      if (!m) continue;
      others.push({
        id,
        x: s.x,
        y: s.y,
        heading: s.heading,
        colorIndex: m.colorIndex,
        trailPatternIndex: m.trailPatternIndex,
        shapeIndex: m.shapeIndex,
        alive: m.alive,
        hasTrail: m.hasTrail,
        score: m.score,
      });
    }

    // Snapshot đã được server lọc theo AoI, vì vậy entities.length chỉ là số thực thể gần.
    // Roster là tổng người thật trong phòng; botCount là số bot authoritative của phòng.
    const playerCount = this.roster.length + (this.welcome?.botCount ?? 0);
    const selfPrep = this.latest ? this.latest.selfPrep : 0;
    const kingHold = this.latest?.kingHold ?? 0;
    return {
      status: this.status,
      playerId,
      self,
      others,
      playerCount,
      selfPrep,
      kingHold,
      ping: this.ping,
    };
  }

  getStatus(): ConnStatus {
    return this.status;
  }

  getWelcome(): WelcomeInfo | null {
    return this.welcome;
  }

  /** Trạng thái phòng chờ mới nhất (null nếu chưa nhận). */
  getLobby(): LobbyInfo | null {
    return this.lobby;
  }

  /** Roster tên người chơi mới nhất. */
  getRoster(): { id: number; name: string }[] {
    return this.roster;
  }

  getWorldUi(): readonly WorldUiEntity[] {
    return this.worldUi;
  }

  /** Đặt lại mốc dự đoán khi (re)spawn — bên gọi cấp trạng thái đầu authoritative. */
  resetPrediction(state: HeadState): void {
    this.predictor.reset(state);
  }
}
