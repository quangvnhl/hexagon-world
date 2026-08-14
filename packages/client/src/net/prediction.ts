// Dự đoán phía client + hòa giải (client-side prediction & reconciliation) cho ĐẦU
// người chơi CỤC BỘ. Thuần, kiểm thử được, KHÔNG chứa WebSocket.
//
// Ý tưởng: mỗi input người chơi (targetHeading trong khoảng dt) được gán một `seq`
// tăng dần và đẩy vào buffer "chưa được xác nhận". Client dự đoán ngay bằng cách fold
// `stepHead` lên các input này. Khi snapshot server về (kèm `ackSeq` = seq cuối server
// đã áp), ta bỏ các input đã được ack, rồi PHÁT LẠI (replay) các input còn lại từ trạng
// thái server để ra vị trí dự đoán đã hiệu chỉnh.

import { HeadState, stepHead, normalizeAngle } from "./stepHead";

/** Hằng số thời gian (giây) giảm dần SAI SỐ hoà giải khi render → hết "giật" 24Hz. */
const SMOOTH_TAU = 0.09;
/** Lệch vị trí lớn hơn ngưỡng này (world units) coi là teleport/spawn → SNAP ngay,
 *  không trượt mượt cả sân. */
const SNAP_DIST = 4;
/** Lệch hướng lớn hơn ngưỡng này (rad) → SNAP hướng ngay. */
const SNAP_HEADING = 2.2;

/** Đồng hồ ms (tách hàm để chạy được cả nơi không có performance). */
function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Một input chưa xác nhận của người chơi cục bộ. */
export interface PendingInput {
  seq: number;
  targetHeading: number;
  dt: number;
  speed: number;
}

/** Fold `stepHead` lên danh sách input, bắt đầu từ `startState`. */
export function predict(
  startState: HeadState,
  inputs: readonly PendingInput[],
): HeadState {
  let s = startState;
  for (const inp of inputs) {
    s = stepHead(s, inp.targetHeading, inp.dt, inp.speed);
  }
  return s;
}

/** Kết quả hòa giải: trạng thái dự đoán mới + buffer input đã cắt gọt. */
export interface ReconcileResult {
  state: HeadState;
  pending: PendingInput[];
}

/**
 * Hòa giải với trạng thái authoritative của server:
 *  - Bỏ mọi input có `seq <= ackSeq` (đã được server áp).
 *  - Phát lại các input còn lại từ `serverState` qua `stepHead`.
 * Trả về trạng thái dự đoán đã hiệu chỉnh và buffer input còn lại.
 */
export function reconcile(
  serverState: HeadState,
  ackSeq: number,
  pendingInputs: readonly PendingInput[],
): ReconcileResult {
  const pending = pendingInputs.filter((inp) => inp.seq > ackSeq);
  const state = predict(serverState, pending);
  return { state, pending };
}

/**
 * Bộ dự đoán trạng thái: giữ buffer input chưa ack + trạng thái dự đoán hiện tại.
 * Lớp mỏng bọc quanh các hàm thuần ở trên để NetClient dùng cho tiện.
 */
export class Predictor {
  /** Trạng thái server mới nhất đã biết (mốc để replay). */
  private serverState: HeadState = { x: 0, y: 0, heading: 0 };
  /** Buffer input chưa được server xác nhận. */
  private pending: PendingInput[] = [];
  /** Trạng thái dự đoán hiện tại (nguồn chân lý cho vật lý — GÁN CỨNG khi hoà giải). */
  private predicted: HeadState = { x: 0, y: 0, heading: 0 };

  /** SAI SỐ hiển thị = (đang render) - (dự đoán). Được nạp mỗi lần hoà giải rồi GIẢM
   *  DẦN theo thời gian → render đi mượt thay vì "nhảy" mỗi snapshot. */
  private errX = 0;
  private errY = 0;
  private errH = 0;
  /** Mốc thời gian lần render trước (ms) để tính hệ số giảm sai số. */
  private lastRenderMs = -1;

  /** Đặt lại mốc (khi nhận WELCOME / spawn). Xoá luôn sai số hiển thị. */
  reset(state: HeadState): void {
    this.serverState = { ...state };
    this.predicted = { ...state };
    this.pending = [];
    this.errX = 0;
    this.errY = 0;
    this.errH = 0;
    this.lastRenderMs = -1;
  }

  /**
   * Ghi một input mới rồi dự đoán tức thì. Trả về trạng thái dự đoán mới.
   * `seq` do bên gọi cấp (tăng dần, khớp seq gửi lên server).
   */
  applyInput(seq: number, targetHeading: number, dt: number, speed: number): HeadState {
    this.pending.push({ seq, targetHeading, dt, speed });
    this.predicted = stepHead(this.predicted, targetHeading, dt, speed);
    return this.predicted;
  }

  /**
   * Hòa giải khi có snapshot: cập nhật mốc server, cắt input đã ack, phát lại phần
   * còn lại. Trả về trạng thái dự đoán đã hiệu chỉnh.
   */
  onServerState(serverState: HeadState, ackSeq: number): HeadState {
    // Vị trí ĐANG hiển thị (trước hoà giải) — giữ nó liên tục qua cú hoà giải.
    const shownX = this.predicted.x + this.errX;
    const shownY = this.predicted.y + this.errY;
    const shownH = this.predicted.heading + this.errH;

    this.serverState = { ...serverState };
    const { state, pending } = reconcile(serverState, ackSeq, this.pending);
    this.pending = pending;
    this.predicted = state;

    // Nạp sai số = (đang hiển thị) - (dự đoán mới) rồi để getRenderHead giảm dần → không
    // "nhảy" khi predicted bị gán cứng. Lệch quá lớn (spawn/hồi sinh) → SNAP, khỏi trượt.
    this.errX = shownX - state.x;
    this.errY = shownY - state.y;
    this.errH = normalizeAngle(shownH - state.heading);
    if (Math.hypot(this.errX, this.errY) > SNAP_DIST) {
      this.errX = 0;
      this.errY = 0;
    }
    if (Math.abs(this.errH) > SNAP_HEADING) this.errH = 0;

    return this.predicted;
  }

  /** Trạng thái dự đoán THÔ (nguồn chân lý vật lý) — dùng cho test/logic. */
  getPredicted(): HeadState {
    return this.predicted;
  }

  /**
   * Trạng thái để RENDER: dự đoán + sai số hoà giải đã GIẢM DẦN theo thời gian thực.
   * Gọi mỗi frame. Nhờ giảm dần theo hằng số `SMOOTH_TAU`, các hiệu chỉnh nhỏ mỗi
   * snapshot (24Hz) được "rải" ra nhiều frame → đầu đi MƯỢT, hết giật ở tường & khi bám.
   */
  getRenderHead(): HeadState {
    const t = nowMs();
    if (this.lastRenderMs >= 0) {
      const dt = (t - this.lastRenderMs) / 1000;
      if (dt > 0) {
        const f = Math.exp(-dt / SMOOTH_TAU);
        this.errX *= f;
        this.errY *= f;
        this.errH *= f;
      }
    }
    this.lastRenderMs = t;
    return {
      x: this.predicted.x + this.errX,
      y: this.predicted.y + this.errY,
      heading: normalizeAngle(this.predicted.heading + this.errH),
    };
  }

  /** Số input đang chờ ack (dùng cho debug). */
  pendingCount(): number {
    return this.pending.length;
  }
}
