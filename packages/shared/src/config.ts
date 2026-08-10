// Cấu hình tập trung cho MVP. Chỉnh gameplay/hiển thị tại đây.

export const CONFIG = {
  /** Bán kính NGOẠI TIẾP (tâm → đỉnh) của SÂN CHƠI hình LỤC GIÁC (flat-top), world
   *  units. Biên là 6 tường nghiêng 120° → không còn góc vuông gây kẹt. */
  ARENA_RADIUS: 60,
  /** Lề (world units) phủ thêm hex NGOÀI tường: chỉ dùng cho tính toán (đầu người
   *  chơi luôn rơi vào ô hợp lệ + flood fill có vành biên); các ô này KHÔNG render
   *  nên không "thò ra" ngoài tường. */
  MAP_MARGIN: 1.5,
  /** Số bot đối kháng. */
  BOT_COUNT: 4,
  /** Bán kính cụm khởi đầu (cube distance). 1 = ô hiện tại + 6 ô kề = 7 ô. */
  START_RADIUS: 1,
  /** Khoảng trống tối thiểu quanh điểm spawn (cube distance): không được có ô đất của
   *  BẤT KỲ ai trong bán kính này → spawn không nằm sát lãnh thổ đã chiếm. */
  SPAWN_CLEARANCE: 10,
  /** Thời gian chuẩn bị (giây) khi vào trận / hồi sinh: đứng yên, chỉ xoay hướng. */
  PREP_TIME: 3,
  /** Kích thước 1 hex (tâm → đỉnh), đơn vị world. */
  HEX_SIZE: 1,
  /** Cạnh cube nhân vật (người + bot), đơn vị world. Chỉnh to/nhỏ nhân vật ở đây. */
  CUBE_SIZE: 1,
  /** Tốc độ di chuyển liên tục (world units / giây). Nhỏ = chậm. */
  SPEED: 10,
  /** Tốc độ quay đầu tối đa (rad / giây) — làm chuyển hướng mượt. */
  TURN_RATE: 15,
  /** Khoảng cách tối thiểu giữa 2 điểm ghi vào đường đuôi (để line mượt & gọn). */
  TRAIL_POINT_DIST: 0.18,
  /** Ngưỡng % diện tích để lên King. */
  KING_PCT: 20,
  /** Thời gian (giây) phải giữ ngôi King liên tục để thắng. */
  WIN_HOLD_TIME: 180,
  /** Bán kính va chạm ĐẦU (world units): chủ đất hạ kẻ xâm nhập khi hai đầu sát nhau. */
  KILL_RADIUS: 0.7,
  /** Tường biên: dày (world units, ăn ra ngoài sân), cao, độ nhô lên khỏi mặt sân. */
  WALL: {
    THICKNESS: 0.1,
    HEIGHT: 0.2,
  },
  /** AI bot. */
  BOT: {
    /** Khoảng cách tối đa rời "nhà" trước khi quay về khép vòng (world units). */
    RANGE_MIN: 6,
    RANGE_MAX: 16,
    /** Nhiễu hướng khi bành trướng (rad) — cho đường đi bớt thẳng đơ. */
    WANDER: 0.05,
    /** Thời gian (giây) bot nằm chờ trước khi tự hồi sinh sau khi chết. */
    RESPAWN_DELAY: 1.5,
    /** Cự ly quét chướng ngại phía trước (world units) khi né đuôi/tường. */
    AVOID_DIST: 1.6,
  },
  /** Hồ sơ ĐỘ KHÓ của bot (gán luân phiên cho từng bot). FSM: EXPAND/RETURN/HUNT/FLEE.
   *  - aggression: xác suất chuyển sang SĂN khi thấy con mồi.
   *  - vision: tầm phát hiện đối thủ (world units).
   *  - skill: chất lượng né chướng ngại (0..1) — cao thì quét nhiều hướng, nhìn xa hơn.
   *  - reaction: nhịp ra quyết định (giây) — nhỏ = phản ứng nhanh. */
  BOT_DIFFICULTY: [
    { label: "Dễ", aggression: 0.12, vision: 12, skill: 0.4, reaction: 0.6 },
    { label: "Thường", aggression: 0.45, vision: 20, skill: 0.75, reaction: 0.3 },
    { label: "Khó", aggression: 3.8, vision: 28, skill: 10.0, reaction: 0.15 },
  ],
  /** Camera perspective: vị trí lệch so với người chơi (x, sau, cao) + fov + độ mượt pan.
   *  Rotation KHOÁ cố định (chỉ pan theo người chơi, không xoay theo chuột). */
  CAMERA: {
    OFFSET: [0, -11, 42] as [number, number, number],
    FOV: 42,
    LERP: 0.15,
    /** Hệ số phóng lớn camera theo diện tích — 1 = gần nhất, MAX = xa nhất khi đạt
     *  ngưỡng King (giống agar.io: càng lớn càng thấy rộng sân). */
    ZOOM: { MIN: 1, MAX: 1.3 },
  },
  /** Hiệu ứng "juice": số hạt mỗi lần nổ + thời gian sống (giây) của hạt. */
  EFFECTS: {
    PARTICLES: 14,
    LIFE: 0.8,
  },
  /** Vạch vàng ngăn cách hai vùng ĐẤT cùng màu khác chủ: bề rộng (world units), màu, và
   *  độ phát sáng (dùng blending cộng dồn) — WIDTH lớn = vạch dày, GLOW lớn = sáng hơn. */
  BORDER: { WIDTH: 0.18, COLOR: "#ffe14d", GLOW: 2.2 },
  /** Joystick ảo (thiết bị chạm): SIZE = đường kính base, KNOB = đường kính núm
   *  (px); DEADZONE = vùng chết tính theo tỉ lệ bán kính (bỏ qua rung tay nhỏ). */
  JOYSTICK: { SIZE: 132, KNOB: 56, DEADZONE: 0.18 },
  /** Gỡ lỗi hình ảnh. COLLISION_VECTORS = true → vẽ mũi tên vector vật lý va chạm
   *  tường ngay tại đầu người chơi: xanh dương = hướng đi mong muốn, đỏ = pháp tuyến
   *  tường đang chạm, xanh lá = hướng trượt kết quả. Dùng để thấy vì sao chết sát biên. */
  DEBUG: {
    COLLISION_VECTORS: true,
    /** Ngưỡng (world units) coi là "đang áp sát tường" để hiện vector (sớm hơn eps thật). */
    WALL_NEAR: 0.6,
  },
} as const;

// Bảng màu (r,g,b trong [0,1]).
export const COLORS = {
  neutral: [0.16, 0.18, 0.23] as [number, number, number],
  /** Tường biên (hex string cho three.js). */
  wall: "#3a4358",
  wallEdge: "#5b6b8c",
};

export interface PlayerColor {
  /** Màu lãnh thổ đã chiếm. */
  owned: [number, number, number];
  /** Màu ô đuôi (trầm hơn). */
  trail: [number, number, number];
  /** Màu cube + ống đuôi (hex string cho three.js). */
  cube: string;
  glow: string;
  /** Tên hiển thị. */
  name: string;
}

/** players[0] = người chơi (xanh dương). Còn lại cho bot. */
export const PLAYER_COLORS: PlayerColor[] = [
  { owned: [0.19, 0.55, 0.95], trail: [0.12, 0.3, 0.55], cube: "#eef4ff", glow: "#2f8fe6", name: "Bạn" },
  { owned: [0.93, 0.35, 0.4], trail: [0.5, 0.16, 0.2], cube: "#ffe9ea", glow: "#e6414c", name: "Bot Đỏ" },
  { owned: [0.35, 0.82, 0.46], trail: [0.15, 0.42, 0.22], cube: "#e9ffef", glow: "#33cc63", name: "Bot Lục" },
  { owned: [0.95, 0.68, 0.24], trail: [0.5, 0.35, 0.1], cube: "#fff3e0", glow: "#f0a52a", name: "Bot Cam" },
  { owned: [0.72, 0.46, 0.96], trail: [0.36, 0.22, 0.5], cube: "#f6ecff", glow: "#a06be8", name: "Bot Tím" },
  { owned: [0.25, 0.78, 0.82], trail: [0.1, 0.38, 0.42], cube: "#e6ffff", glow: "#2fc6d0", name: "Bot Ngọc" },
];
