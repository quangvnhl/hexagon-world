import {
  GameState,
  type PlayerAppearance,
  type Snapshot,
} from "@hexagon/shared";
import { BOT_COUNT, MAX_PLAYERS } from "../config";

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

  constructor(maxHumans: number = MAX_PLAYERS, botCount: number = BOT_COUNT) {
    this.maxHumans = maxHumans;
    // players[0..maxHumans-1] là ghế người (non-bot); phần còn lại là bot.
    this.gs = new GameState(undefined, botCount, maxHumans);
    this.seats = new Array(maxHumans).fill(false);
    this.lastSeq = new Array(maxHumans).fill(0);
    this.pending = new Array(maxHumans).fill(null);
    // GHẾ CHƯA CÓ NGƯỜI không được mô phỏng (nếu không sẽ trôi thẳng, để lại "bóng ma").
    // "Đỗ" mọi ghế người ngay từ đầu; join() sẽ respawn ghế khi có người ngồi.
    for (let id = 0; id < maxHumans; id++) this.gs.park(id);
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

  /** Hồi sinh ghế (khi client bấm Hồi sinh). Trả false nếu không thể (đang sống / khoá / hết chỗ). */
  reviveSeat(entityId: number): boolean {
    if (entityId < 0 || entityId >= this.maxHumans) return false;
    if (!this.seats[entityId]) return false;
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
    for (let id = 0; id < this.maxHumans; id++) {
      if (!this.seats[id]) continue;
      this.gs.park(id); // dọn sạch trước
      this.gs.respawn(id); // spawn tươi vào prep
    }
  }

  /** "Đỗ" TẤT CẢ ghế → phòng về trạng thái CHỜ sạch (dùng khi tụt dưới mức tối thiểu). */
  parkAll(): void {
    for (let id = 0; id < this.maxHumans; id++) this.gs.park(id);
  }

  /**
   * Nhận input mạng cho một ghế NGƯỜI. Chỉ giữ heading MỚI NHẤT theo seq (chịu được gói
   * đến sai thứ tự). Bỏ qua ghế trống, id ngoài phạm vi, hoặc heading không hữu hạn.
   */
  applyInput(entityId: number, seq: number, heading: number): void {
    if (entityId < 0 || entityId >= this.maxHumans) return;
    if (!this.seats[entityId]) return;
    if (!Number.isFinite(heading)) return;
    const seqU = seq >>> 0;
    // Mốc so sánh: seq của input đang chờ (nếu có) hoặc seq cuối đã áp.
    const ref = this.pending[entityId]?.seq ?? this.lastSeq[entityId];
    if (seqU <= ref) return; // gói cũ/trùng → bỏ.
    this.pending[entityId] = { seq: seqU, heading };
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
    this.gs.update(dt);
    this.tickCount++;
  }

  /**
   * Dựng snapshot cho một ghế cụ thể: ackSeq = seq cuối server đã áp cho ghế đó, kèm ảnh
   * chụp TOÀN BỘ thực thể (người + bot).
   */
  buildSnapshotFor(entityId: number): Snapshot {
    const ack =
      entityId >= 0 && entityId < this.maxHumans ? this.lastSeq[entityId] : 0;
    const e = this.gs.players[entityId];
    const selfPrep =
      e && e.phase === "prep" ? Math.max(0, Math.ceil(e.prepRemaining * 1000)) : 0;
    return {
      tick: this.tickCount,
      ackSeq: ack,
      selfPrep,
      // Đồng hồ giữ ngôi KING (giây) do server tính — client dùng để đếm ngược 3 phút.
      kingHold: this.gs.kingHoldRemaining,
      entities: this.gs.snapshotEntities(),
    };
  }
}
