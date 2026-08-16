import {
  GameState,
  type PlayerAppearance,
  type Snapshot,
  type WorldUiEntity,
  type MinimapUiEntity,
} from "@hexagon/shared";
import { BOT_COUNT, MAX_HUMAN_PLAYERS, KING_ROOM_DURATION_SECONDS } from "../config";

/**
 * GameRoom — lõi mô phỏng AUTHORITATIVE, KHÔNG phụ thuộc framework, deterministic.
 *
 * Sở hữu một `GameState` với `humanCount` ghế NGƯỜI (players[0..humanCount-1]) và phần
 * còn lại là bot do AI của GameState tự điều khiển. Mỗi kết nối mạng được cấp một GHẾ
 * người (clientId → entityId). Server chỉ nhận Ý ĐỊNH hướng (heading) từ client, không
 * bao giờ tin vị trí client → chống gian lận.
 *
 * Lớp này thuần TypeScript (constructor tường minh, không dùng decorator metadata) để
 * có thể unit/integration test trực tiếp mà không cần NestJS DI.
 */
export class GameRoom {
  private readonly gs: GameState;

  /** Số ghế người tối đa. */
  private readonly maxHumans: number;

  /** Ghế nào đang có người ngồi: seats[entityId] = true nếu đã cấp. */
  private readonly seats: boolean[];

  /** Seq input CUỐI đã ÁP cho từng ghế người (cho ackSeq/reconciliation). */
  private readonly lastSeq: number[];

  /** Input đang chờ áp ở tick kế: heading mới nhất + seq của nó, theo từng ghế. */
  private readonly pending: Array<{ seq: number; heading: number } | null>;

  /** Số tick đã mô phỏng (đơn điệu tăng). */
  private tickCount = 0;
  private readonly botIds: number[];
  private readonly activeBots = new Set<number>();
  private kingCountdownRemaining = KING_ROOM_DURATION_SECONDS;
  private kingCountdownRunning = false;

  constructor(
    maxHumans: number = MAX_HUMAN_PLAYERS,
    botCount: number = BOT_COUNT,
    private readonly kingDurationSeconds = KING_ROOM_DURATION_SECONDS,
    matchSeed = 0,
  ) {
    this.maxHumans = maxHumans;
    // players[0..maxHumans-1] là ghế người (non-bot); phần còn lại là bot.
    this.gs = new GameState({
      humanCount: maxHumans,
      config: { bots: { count: botCount }, seed: matchSeed },
    });
    this.seats = new Array(maxHumans).fill(false);
    this.lastSeq = new Array(maxHumans).fill(0);
    this.pending = new Array(maxHumans).fill(null);
    this.botIds = Array.from({ length: botCount }, (_, index) => maxHumans + index);
    // GHẾ CHƯA CÓ NGƯỜI không được mô phỏng (nếu không sẽ trôi thẳng, để lại "bóng ma").
    // "Đỗ" mọi ghế người ngay từ đầu; join() sẽ respawn ghế khi có người ngồi.
    for (let id = 0; id < maxHumans; id++) this.gs.park(id);
    for (const id of this.botIds) this.gs.park(id);
  }

  /** GameState bên dưới (chỉ đọc cho tầng mạng: phát event, xem trạng thái). */
  get gameState(): GameState {
    return this.gs;
  }

  /** Số tick đã chạy. */
  get tick(): number {
    return this.tickCount;
  }

  /** Số ghế người tối đa. */
  get capacity(): number {
    return this.maxHumans;
  }

  /** Cấp một ghế người trống → trả entityId, hoặc null nếu phòng đầy. Lưu TÊN hiển thị. */
  join(name = "", appearance?: Partial<PlayerAppearance>): number | null {
    for (let id = 0; id < this.maxHumans; id++) {
      if (!this.seats[id]) {
        this.seats[id] = true;
        this.lastSeq[id] = 0;
        this.pending[id] = null;
        this.gs.setName(id, name.trim() || `Người ${id + 1}`);
        this.gs.setAppearance(id, appearance);
        // Ghế có thể đang ở trạng thái CHẾT (người trước để lại) → hồi sinh cho người mới.
        if (this.gs.players[id]?.phase === "dead") this.gs.respawn(id);
        return id;
      }
    }
    return null;
  }

  /** Danh sách {id, tên} của các ghế đang có người (cho roster gửi client). */
  roster(): { id: number; name: string }[] {
    const out: { id: number; name: string }[] = [];
    for (let id = 0; id < this.maxHumans; id++) {
      if (this.seats[id]) out.push({ id, name: this.gs.nameOf(id) });
    }
    return out;
  }

  get botCapacity(): number { return this.botIds.length; }
  get activeBotCount(): number { return this.activeBots.size; }
  get kingCountdownActive(): boolean { return this.kingCountdownRunning; }
  get kingRemaining(): number { return this.kingCountdownRunning ? this.kingCountdownRemaining : this.kingDurationSeconds; }
  get kingAdmissionLocked(): boolean { return this.kingCountdownRunning; }

  activateNextBot(): number | null {
    if (this.kingCountdownRunning) return null;
    const id = this.botIds.find((candidate) => !this.activeBots.has(candidate));
    if (id === undefined) return null;
    if (!this.gs.respawn(id)) return null;
    this.activeBots.add(id);
    return id;
  }

  trimBots(target: number): void {
    const desired = Math.max(0, Math.min(this.botIds.length, Math.round(target)));
    if (this.activeBots.size <= desired) return;
    const candidates = [...this.activeBots].sort((a, b) => {
      const aDead = this.gs.players[a]?.phase === "dead" ? 0 : 1;
      const bDead = this.gs.players[b]?.phase === "dead" ? 0 : 1;
      return aDead - bDead || b - a;
    });
    for (const id of candidates.slice(0, this.activeBots.size - desired)) {
      this.activeBots.delete(id);
      this.gs.park(id);
    }
  }

  /** Trạng thái nhẹ phục vụ minimap/xếp hạng; không đưa ghế người đang trống vào UI. */
  worldUiEntities(): WorldUiEntity[] {
    return this.gs.snapshotEntities()
      .filter((e) => e.id >= this.maxHumans ? this.activeBots.has(e.id) : this.seats[e.id])
      .map((e) => ({
        id: e.id,
        alive: e.alive,
        score: e.score,
        colorIndex: e.colorIndex,
        trailPatternIndex: e.trailPatternIndex,
        shapeIndex: e.shapeIndex,
      }));
  }

  minimapUiEntitiesFor(entityId: number): MinimapUiEntity[] {
    const radar = this.gs.radarActiveFor(entityId);
    return this.gs.snapshotEntities()
      .filter((entity) =>
        (entity.id >= this.maxHumans
          ? this.activeBots.has(entity.id)
          : Boolean(this.seats[entity.id])) &&
        (radar || entity.id === entityId)
      )
      .map((entity) => ({
        id: entity.id,
        x: entity.x,
        y: entity.y,
        alive: entity.alive,
      }));
  }

  /** Hồi sinh ghế (khi client bấm Hồi sinh). Trả false nếu không thể (đang sống / khoá / hết chỗ). */
  reviveSeat(entityId: number): boolean {
    if (entityId < 0 || entityId >= this.maxHumans) return false;
    if (!this.seats[entityId]) return false;
    if (this.kingCountdownRunning) return false;
    return this.gs.respawn(entityId);
  }

  /** Trả ghế lại phòng khi client rời đi. */
  leave(entityId: number): void {
    if (entityId < 0 || entityId >= this.maxHumans) return;
    this.seats[entityId] = false;
    this.lastSeq[entityId] = 0;
    this.pending[entityId] = null;
    this.gs.setName(entityId, ""); // trả tên về mặc định cho ghế trống
    // "Đỗ" ghế: thực thể chết & trả đất/đuôi về trung lập, không còn trôi trên sân.
    this.gs.park(entityId);
  }

  /** Số ghế người đang có người ngồi. */
  occupied(): number {
    let n = 0;
    for (const s of this.seats) if (s) n++;
    return n;
  }

  /** BẮT ĐẦU ván: spawn mới ĐỒNG BỘ tất cả ghế đang có người (cùng vào prep, sạch trạng
   *  thái cũ) → mọi người khởi đầu công bằng khi đủ người. */
  startMatch(): void {
    this.resetKingCountdown();
    for (let id = 0; id < this.maxHumans; id++) {
      if (!this.seats[id]) continue;
      this.gs.park(id); // dọn sạch trước
      this.gs.respawn(id); // spawn tươi vào prep
    }
  }

  /** "Đỗ" TẤT CẢ ghế → phòng về trạng thái CHỜ sạch (dùng khi tụt dưới mức tối thiểu). */
  parkAll(): void {
    for (let id = 0; id < this.maxHumans; id++) this.gs.park(id);
    for (const id of this.activeBots) this.gs.park(id);
    this.activeBots.clear();
    this.resetKingCountdown();
  }

  /**
   * Nhận input mạng cho một ghế NGƯỜI. Chỉ giữ heading MỚI NHẤT theo seq (chịu được gói
   * đến sai thứ tự). Bỏ qua ghế trống, id ngoài phạm vi, hoặc heading không hữu hạn.
   */
  applyInput(entityId: number, seq: number, heading: number): void {
    if (entityId < 0 || entityId >= this.maxHumans) return;
    if (!this.seats[entityId]) return;
    if (!Number.isFinite(heading)) return;
    // Pha 5 · B1: chuẩn hóa heading về [-π, π]. atan2(sin,cos) gói mọi số hữu hạn
    // (kể cả giá trị lớn/âm client gửi) về đúng dải mà không đổi hành vi hợp lệ.
    const normalizedHeading = Math.atan2(Math.sin(heading), Math.cos(heading));
    const seqU = seq >>> 0;
    // Mốc so sánh: seq của input đang chờ (nếu có) hoặc seq cuối đã áp.
    const ref = this.pending[entityId]?.seq ?? this.lastSeq[entityId];
    if (seqU <= ref) return; // gói cũ/trùng → bỏ.
    this.pending[entityId] = { seq: seqU, heading: normalizedHeading };
  }

  /**
   * Một bước mô phỏng: áp mọi input đang chờ → `gs.update(dt)` → tăng tick.
   * ackSeq chỉ nhích LÊN sau khi input được áp trong tick này.
   */
  stepTick(dt: number): void {
    for (let id = 0; id < this.maxHumans; id++) {
      const p = this.pending[id];
      if (p && this.seats[id]) {
        this.gs.setTargetHeading(id, p.heading);
        this.lastSeq[id] = p.seq;
      }
      this.pending[id] = null;
    }
    // GameState has single-player win rules; online room owns its own deadline/lifecycle.
    this.gs.won = false;
    this.gs.winnerId = -1;
    this.gs.update(dt);
    const kingId = this.gs.kingId();
    if (kingId >= 0) {
      // Khi KING là người sống duy nhất trong số ít nhất hai thực thể đã tham gia,
      // những đối thủ còn lại bị khóa hồi sinh. Không còn điều kiện nào có thể thay
      // đổi kết quả, vì vậy kết thúc ngay thay vì bắt KING chờ hết countdown.
      const participants = this.gs.players.filter((entity) =>
        entity.id >= this.maxHumans ? this.activeBots.has(entity.id) : this.seats[entity.id],
      );
      const alive = participants.filter((entity) => entity.phase === "playing" || entity.phase === "prep");
      if (participants.length >= 2 && alive.length === 1 && alive[0].id === kingId) {
        this.kingCountdownRunning = true;
        this.kingCountdownRemaining = 0;
        this.gs.declareWinner(kingId);
        this.gs.kingHoldRemaining = 0;
        this.tickCount++;
        return;
      }
      if (!this.kingCountdownRunning) {
        this.kingCountdownRunning = true;
        this.kingCountdownRemaining = this.kingDurationSeconds;
      }
      this.kingCountdownRemaining = Math.max(0, this.kingCountdownRemaining - dt);
      if (this.kingCountdownRemaining <= 0) {
        this.gs.won = false;
        this.gs.winnerId = -1;
        this.gs.declareWinner(kingId);
      }
      else {
        // Cancel GameState's early/holder-specific win while retaining current territory/King.
        this.gs.won = false;
        this.gs.winnerId = -1;
      }
    } else {
      this.resetKingCountdown();
      this.gs.won = false;
      this.gs.winnerId = -1;
    }
    this.gs.kingHoldRemaining = this.kingRemaining;
    this.tickCount++;
  }

  private resetKingCountdown(): void {
    this.kingCountdownRunning = false;
    this.kingCountdownRemaining = this.kingDurationSeconds;
    this.gs.kingHoldRemaining = this.kingDurationSeconds;
  }

  /**
   * Dựng snapshot cho một ghế cụ thể: ackSeq = seq cuối server đã áp cho ghế đó, kèm ảnh
   * chụp TOÀN BỘ thực thể (người + bot).
   */
  buildSnapshotFor(
    entityId: number,
    entityAoiRadius = Number.POSITIVE_INFINITY,
    interestTargetId: number | null = null,
  ): Snapshot {
    const ack =
      entityId >= 0 && entityId < this.maxHumans ? this.lastSeq[entityId] : 0;
    const e = this.gs.players[entityId];
    const selfPrep =
      e && e.phase === "prep" ? Math.max(0, Math.ceil(e.prepRemaining * 1000)) : 0;
    const allEntities = this.gs.snapshotEntities().filter((entity) =>
      entity.id >= this.maxHumans ? this.activeBots.has(entity.id) : Boolean(this.seats[entity.id]),
    );
    let entities = allEntities;

    if (Number.isFinite(entityAoiRadius) && entityAoiRadius > 0) {
      const self = allEntities.find((entity) => entity.id === entityId);
      const isParticipating = (id: number): boolean =>
        id >= this.maxHumans ? this.activeBots.has(id) : Boolean(this.seats[id]);

      const requestedTarget =
        interestTargetId !== null && isParticipating(interestTargetId)
          ? allEntities.find((entity) => entity.id === interestTargetId && entity.alive)
          : undefined;
      const leaderId = self?.alive ? -1 : this.gs.leaderId();
      const leader = leaderId >= 0
        ? allEntities.find((entity) => entity.id === leaderId)
        : undefined;
      const focus = self?.alive ? self : requestedTarget ?? leader ?? self;

      if (focus) {
        const radiusSq = entityAoiRadius * entityAoiRadius;
        const kingId = this.gs.kingId();
        entities = allEntities.filter((entity) => {
          if (!isParticipating(entity.id)) return false;
          // Reconciliation luôn cần self; KING cần cho HUD ngay cả khi ngoài camera.
          if (entity.id === entityId || entity.id === kingId) return true;
          const dx = entity.x - focus.x;
          const dy = entity.y - focus.y;
          return dx * dx + dy * dy <= radiusSq;
        });
      } else {
        entities = self ? [self] : [];
      }
    }

    return {
      tick: this.tickCount,
      ackSeq: ack,
      selfPrep,
      // Đồng hồ giữ ngôi KING (giây) do server tính — client dùng để đếm ngược 3 phút.
      kingRemaining: this.kingRemaining,
      entities,
    };
  }
}
