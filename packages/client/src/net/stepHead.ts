// Động học ĐẦU người chơi (head kinematics) — nguồn chân lý DUY NHẤT cho chuyển động
// đầu, dùng chung cho client prediction VÀ unit test. Phải khớp CHÍNH XÁC với server
// (`updateEntity` trong @hexagon/shared) để prediction và server đồng thuận.
//
// Chỉ mô phỏng ĐẦU ở trạng thái chơi ổn định (steady-state "playing"): xoay hướng có
// giới hạn theo TURN_RATE, rồi di chuyển và clamp về trong sân (tự trượt dọc tường).
// KHÔNG dự đoán đuôi/chiếm đất (đó là việc của server).

import { CONFIG, slideMove } from "@hexagon/shared";

/** Trạng thái đầu tối thiểu cần cho dự đoán. */
export interface HeadState {
  x: number;
  y: number;
  heading: number;
}

/** Đưa một góc về khoảng (-pi, pi]. Sao y bản gốc server để hai bên khớp nhau. */
export function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Một bước động học đầu (thuần, không phụ thuộc trạng thái ngoài):
 *  1) Quay `heading` về `targetHeading`, giới hạn bởi `CONFIG.TURN_RATE * dt`.
 *  2) Dịch theo hướng mới một đoạn `CONFIG.SPEED * dt`, rồi `clampInside` về trong
 *     lục giác. Nếu có di chuyển thực, cập nhật `heading` theo hướng di chuyển thực
 *     (trượt dọc tường) — y hệt server.
 *
 * Trả về một object MỚI, không đột biến `state` đầu vào.
 */
export function stepHead(
  state: HeadState,
  targetHeading: number,
  dt: number,
): HeadState {
  // 1) Quay đầu có giới hạn.
  const maxTurn = CONFIG.TURN_RATE * dt;
  let diff = normalizeAngle(targetHeading - state.heading);
  if (diff > maxTurn) diff = maxTurn;
  else if (diff < -maxTurn) diff = -maxTurn;
  let heading = state.heading + diff;

  // 2) Di chuyển rồi TRƯỢT dọc tường ở tốc độ đầy đủ (khớp updateEntity của server).
  const dist = CONFIG.SPEED * dt;
  const c = slideMove(state.x, state.y, heading, dist);
  const mdx = c.x - state.x;
  const mdy = c.y - state.y;
  if (Math.hypot(mdx, mdy) > 1e-7) {
    // Xoay đầu theo hướng DI CHUYỂN THỰC (khi trượt dọc tường).
    heading = Math.atan2(mdy, mdx);
    return { x: c.x, y: c.y, heading };
  }
  // Không nhúc nhích (áp sát tường/góc): giữ vị trí, chỉ giữ heading đã quay.
  return { x: state.x, y: state.y, heading };
}
