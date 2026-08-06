// Cấu hình tập trung cho MVP. Chỉnh gameplay/hiển thị tại đây.

export const CONFIG = {
  /** Nửa chiều rộng / cao SÂN CHƠI (world units) — sân HÌNH CHỮ NHẬT, biên thẳng. */
  ARENA_HALF_W: 34,
  ARENA_HALF_H: 24,
  /** Lề phủ thêm hex quanh sân để mọi vị trí clamp đều rơi vào ô hợp lệ. */
  MAP_MARGIN: 1.5,
  /** Bán kính khởi đầu vùng an toàn của người chơi (theo cube distance). */
  START_RADIUS: 3,
  /** Kích thước 1 hex (tâm → đỉnh), đơn vị world. */
  HEX_SIZE: 1,
  /** Tốc độ di chuyển liên tục (world units / giây). Nhỏ = chậm. */
  SPEED: 4.5,
  /** Tốc độ quay đầu tối đa (rad / giây) — làm chuyển hướng mượt. */
  TURN_RATE: 7,
  /** Khoảng cách tối thiểu giữa 2 điểm ghi vào đường đuôi (để line mượt & gọn). */
  TRAIL_POINT_DIST: 0.18,
  /** Ngưỡng % diện tích để lên King. */
  KING_PCT: 20,
  /** Camera perspective: vị trí lệch so với người chơi (x, sau, cao) + fov + độ mượt pan.
   *  Rotation KHOÁ cố định (chỉ pan theo người chơi, không xoay theo chuột). */
  CAMERA: {
    OFFSET: [0, -9, 34] as [number, number, number],
    FOV: 42,
    LERP: 0.15,
  },
} as const;

// Bảng màu (r,g,b trong [0,1]).
export const COLORS = {
  neutral: [0.16, 0.18, 0.23] as [number, number, number],
  owned: [0.19, 0.55, 0.95] as [number, number, number],
  /** Ô lục giác đã đi qua (đuôi) — amber trầm để ống đuôi sáng nổi bật hơn. */
  trailCell: [0.55, 0.4, 0.12] as [number, number, number],
};
