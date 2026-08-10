// Dự đoán phía client + hòa giải (client-side prediction & reconciliation) cho ĐẦU
// người chơi CỤC BỘ. Thuần, kiểm thử được, KHÔNG chứa WebSocket.
//
// Ý tưởng: mỗi input người chơi (targetHeading trong khoảng dt) được gán một `seq`
// tăng dần và đẩy vào buffer "chưa được xác nhận". Client dự đoán ngay bằng cách fold
// `stepHead` lên các input này. Khi snapshot server về (kèm `ackSeq` = seq cuối server
// đã áp), ta bỏ các input đã được ack, rồi PHÁT LẠI (replay) các input còn lại từ trạng
// thái server để ra vị trí dự đoán đã hiệu chỉnh.

import { HeadState, stepHead } from "./stepHead";

/** Một input chưa xác nhận của người chơi cục bộ. */
export interface PendingInput {
  seq: number;
  targetHeading: number;
  dt: number;
}

/** Fold `stepHead` lên danh sách input, bắt đầu từ `startState`. */
export function predict(
  startState: HeadState,
  inputs: readonly PendingInput[],
): HeadState {
  let s = startState;
  for (const inp of inputs) {
    s = stepHead(s, inp.targetHeading, inp.dt);
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
  /** Trạng thái dự đoán hiện tại (đọc mỗi frame để render). */
  private predicted: HeadState = { x: 0, y: 0, heading: 0 };

  /** Đặt lại mốc (khi nhận WELCOME / spawn). */
  reset(state: HeadState): void {
    this.serverState = { ...state };
    this.predicted = { ...state };
    this.pending = [];
  }

  /**
   * Ghi một input mới rồi dự đoán tức thì. Trả về trạng thái dự đoán mới.
   * `seq` do bên gọi cấp (tăng dần, khớp seq gửi lên server).
   */
  applyInput(seq: number, targetHeading: number, dt: number): HeadState {
    this.pending.push({ seq, targetHeading, dt });
    this.predicted = stepHead(this.predicted, targetHeading, dt);
    return this.predicted;
  }

  /**
   * Hòa giải khi có snapshot: cập nhật mốc server, cắt input đã ack, phát lại phần
   * còn lại. Trả về trạng thái dự đoán đã hiệu chỉnh.
   */
  onServerState(serverState: HeadState, ackSeq: number): HeadState {
    this.serverState = { ...serverState };
    const { state, pending } = reconcile(serverState, ackSeq, this.pending);
    this.pending = pending;
    this.predicted = state;
    return this.predicted;
  }

  /** Trạng thái dự đoán hiện tại để render. */
  getPredicted(): HeadState {
    return this.predicted;
  }

  /** Số input đang chờ ack (dùng cho debug). */
  pendingCount(): number {
    return this.pending.length;
  }
}
