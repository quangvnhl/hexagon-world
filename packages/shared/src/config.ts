// Cấu hình tập trung cho MVP. Chỉnh gameplay/hiển thị tại đây.

export const CONFIG = {
  /** Bán kính NGOẠI TIẾP (tâm → đỉnh) của SÂN CHƠI hình LỤC GIÁC (flat-top), world
   *  units. Biên là 6 tường nghiêng 120° → không còn góc vuông gây kẹt. */
  ARENA_RADIUS: 130,
  /** Hệ số CO BIÊN VA CHẠM THẬT vào trong (nhân vào inradius/circumradius). 1 = biên đầy
   *  đủ; < 1 = tường va chạm + sàn hex + đường line đỏ debug cùng co vào (vd 0.97 ≈ sát
   *  hơn 3%). ĐÂY LÀ NGUỒN DUY NHẤT: physics (arena.ts), vùng ô hợp lệ (mapArena) và line
   *  đỏ (ArenaCollider) đều đọc chung → biên vật lý LUÔN trùng đường line đỏ. */
  WALL_SCALE: 0.99,
  /** Lề (world units) phủ thêm hex NGOÀI tường: chỉ dùng cho tính toán (đầu người
   *  chơi luôn rơi vào ô hợp lệ + flood fill có vành biên); các ô này KHÔNG render
   *  nên không "thò ra" ngoài tường. */
  MAP_MARGIN: 0.6,
  /** Số bot đối kháng. */
  BOT_COUNT: 24,
  /** Bán kính cụm khởi đầu (cube distance). 1 = ô hiện tại + 6 ô kề = 7 ô. */
  START_RADIUS: 1,
  /** Khoảng trống tối thiểu quanh điểm spawn (cube distance): không được có ô đất của
   *  BẤT KỲ ai trong bán kính này → spawn không nằm sát lãnh thổ đã chiếm. */
  SPAWN_CLEARANCE: 10,
  /** Thời gian chuẩn bị (giây) khi vào trận / hồi sinh: đứng yên, chỉ xoay hướng. */
  PREP_TIME: 3,
  /** Kích thước 1 hex (tâm → đỉnh), đơn vị world. */
  HEX_SIZE: 1,
  /** Hình thức viên lát lục giác và hiệu ứng nhấn khi người chơi bước sang ô mới. */
  GRID: {
    /** Tỉ lệ bán kính phần nhìn thấy. Nhỏ hơn → khe giữa các ô trông dày hơn. */
    TILE_SCALE: 0.9,
    /** Độ dày thật của khối lục giác (world units); mặt trên luôn nằm tại z = 0. */
    THICKNESS: 0.2,
    /** Độ sâu tối đa và độ co ngang tại điểm nhún thấp nhất. */
    PRESS_DEPTH: 0.4,
    PRESS_SCALE: 0.95,
    /** Tổng thời gian nhún xuống rồi trở lại vị trí ban đầu (giây). */
    PRESS_DURATION: 0.2,
  },
  /** Cạnh cube nhân vật (người + bot), đơn vị world. Chỉnh to/nhỏ nhân vật ở đây. */
  CUBE_SIZE: 1.2,
  /** Tốc độ di chuyển liên tục (world units / giây). Nhỏ = chậm. */
  SPEED: 5.5,
  /** Tốc độ quay đầu tối đa (rad / giây) — làm chuyển hướng mượt. */
  TURN_RATE: 4.5,
  /** Khoảng cách tối thiểu giữa 2 điểm ghi vào đường đuôi (để line mượt & gọn). */
  TRAIL_POINT_DIST: 0.1,
  /** Ngưỡng % diện tích để lên King. */
  KING_PCT: 20,
  /** Thời gian (giây) phải giữ ngôi King liên tục để thắng. */
  WIN_HOLD_TIME: 180,
  /** Bán kính va chạm ĐẦU (world units): chủ đất hạ kẻ xâm nhập khi hai đầu sát nhau. */
  KILL_RADIUS: 0.25,
  /** Số ô ĐUÔI mới nhất (sát đầu) được MIỄN luật tự-cắt-đuôi. Cần ≥1 để đầu không "chết
   *  oan" khi làm tròn hex dao động lúc đi dọc đúng ranh giới cột hex / men theo tường
   *  (đầu bị bật qua-lại giữa 2 ô kề). Cắt vào đoạn đuôi CŨ hơn thì vẫn chết như thường. */
  SELF_TRAIL_GRACE: 2,
  /** Tường biên: dày (world units, ăn ra ngoài sân), cao, độ nhô lên khỏi mặt sân. */
  WALL: {
    THICKNESS: 0.1,
    HEIGHT: 0.2,
  },
  /** AI bot. */
  BOT: {
    /** Giới hạn AI tối đa 20 lần/giây; hướng đã chốt vẫn được nội suy mỗi frame. */
    THINK_INTERVAL_MIN: 0.05,
    /** Tốc độ quay đầu RIÊNG của bot (rad/giây) — TÁCH khỏi TURN_RATE của người chơi để
     *  chỉnh độ nhanh nhẹn của bot mà không đổi cảm giác lái của người. Cao hơn → bot
     *  khép được vòng LỚN (bành trướng nhanh) nhưng nếu quá cao dễ curl vào đuôi mình. */
    TURN_RATE: 14,
    /** Khoảng cách tối đa rời "nhà" trước khi quay về khép vòng (world units). */
    RANGE_MIN: 2,
    RANGE_MAX: 20,
    /** Nhiễu hướng khi bành trướng (rad) — cho đường đi bớt thẳng đơ. */
    WANDER: 0.05,
    /** Thời gian (giây) bot nằm chờ trước khi tự hồi sinh sau khi chết. */
    RESPAWN_DELAY: 3,
    /** Cự ly quét chướng ngại phía trước (world units) khi né đuôi/tường. */
    AVOID_DIST: 3,
  },
  /** Hồ sơ ĐỘ KHÓ của bot (gán luân phiên cho từng bot). FSM: EXPAND/RETURN/HUNT/FLEE.
   *  - aggression: xác suất chuyển sang SĂN khi thấy con mồi.
   *  - vision: tầm phát hiện đối thủ (world units).
   *  - skill: chất lượng né chướng ngại (0..1) — cao thì quét nhiều hướng, nhìn xa hơn.
   *  - reaction: nhịp ra quyết định (giây) — nhỏ = phản ứng nhanh. */
  BOT_DIFFICULTY: [
    { label: "Dễ", aggression: 1, vision: 12, skill: 0.3, reaction: 0.3 },
    { label: "Thường", aggression: 4, vision: 16, skill: 0.5, reaction: 0.2 },
    { label: "Khó", aggression: 10, vision: 20, skill: 1, reaction: 0.1 },
  ],
  /** Camera perspective: vị trí lệch so với người chơi (x, sau, cao) + fov + độ mượt pan.
   *  Rotation KHOÁ cố định (chỉ pan theo người chơi, không xoay theo chuột). */
  CAMERA: {
    OFFSET: [0, -4, 20] as [number, number, number],
    FOV: 70,
    /**
     * Hệ số mở rộng vùng nhìn khi mobile xoay ngang.
     * 1 = giữ đúng bề rộng tương đương bản dọc; >1 = camera xa/rộng hơn.
     */
    MOBILE_LANDSCAPE_VIEW_SCALE: 2.5,
    LERP: 0.15,
    /** Hệ số phóng lớn camera theo diện tích — 1 = gần nhất, MAX = xa nhất khi đạt
     *  ngưỡng King (giống agar.io: càng lớn càng thấy rộng sân). */
    ZOOM: { MIN: 1, MAX: 1.4 },
  },
  /** Hiệu ứng "juice": số hạt mỗi lần nổ + thời gian sống (giây) của hạt. */
  EFFECTS: {
    PARTICLES: 14,
    LIFE: 0.8,
    /** Số giọt 3D và thời gian tồn tại của vụ nổ khi một nhân vật chết. */
    DEATH_DROPS: 28,
    DEATH_LIFE: 1.25,
    DEATH_GRAVITY: 12,
    /** Chờ hiệu ứng chết kết thúc rồi mới phủ popup hồi sinh/xem (giây). */
    DEATH_POPUP_DELAY: 2,
  },
  /** Vạch vàng ngăn cách hai vùng ĐẤT cùng màu khác chủ: bề rộng (world units), màu, và
   *  độ phát sáng (dùng blending cộng dồn) — WIDTH lớn = vạch dày, GLOW lớn = sáng hơn. */
  BORDER: {
    WIDTH: 0.18,
    COLOR: "#ffe14d",
    GLOW: 2.2,
    /** VIỀN TỐI (casing) vẽ RỘNG HƠN nằm dưới lõi vàng → vạch nổi trên MỌI màu đất, kể cả
     *  nền ấm (cam/vàng) khiến lõi vàng additive bị "cháy trắng" chìm. CASING_WIDTH = bề
     *  rộng dải tối (world units, > WIDTH); CASING_COLOR = màu viền (đục, blend thường).
     *  Đặt CASING_WIDTH = 0 để TẮT viền tối (chỉ còn lõi vàng như cũ). */
    CASING_WIDTH: 0.34,
    CASING_COLOR: "#05070d",
  },
  /** Joystick ảo (thiết bị chạm): SIZE = đường kính base, KNOB = đường kính núm
   *  (px); DEADZONE = vùng chết tính theo tỉ lệ bán kính (bỏ qua rung tay nhỏ). */
  JOYSTICK: { SIZE: 132, KNOB: 56, DEADZONE: 0.18 },
  /** Bật/tắt các lớp HIỂN THỊ để giảm tải khi đông bot (mỗi lớp là 1 chi phí/​frame).
   *  Tắt bớt khi máy yếu / nhiều bot cho mượt. FPS = đồng hồ khung hình góc màn hình. */
  DISPLAY: {
    /** Đồng hồ FPS (overlay DOM góc trên-trái). */
    FPS: true,
    /** Bảng điều khiển HUD (điểm số, King, countdown, popup chết…). */
    HUD: true,
    /** Bản đồ con minimap (góc dưới-phải) — có vòng lặp rAF riêng, tắt để tiết kiệm. */
    MINIMAP: true,
    /** Ống ĐUÔI 3D phát sáng của MỌI thực thể — CHI PHÍ LỚN NHẤT khi đông bot (mỗi
     *  frame dựng lại 1 TubeGeometry/​thực thể đang vẽ đuôi). Tắt → đuôi chỉ còn ô màu. */
    TRAILS: true,
    /** Hạt hiệu ứng nổ/​chiếm đất (pooled Points). */
    PARTICLES: true,
    /** Vạch vàng phân ranh đất cùng màu khác chủ. */
    TERRITORY_BORDERS: true,
  },
  /** Gỡ lỗi hình ảnh. COLLISION_VECTORS = true → vẽ mũi tên vector vật lý va chạm
   *  tường ngay tại đầu người chơi: xanh dương = hướng đi mong muốn, đỏ = pháp tuyến
   *  tường đang chạm, xanh lá = hướng trượt kết quả. Dùng để thấy vì sao chết sát biên. */
  DEBUG: {
    COLLISION_VECTORS: false,
    /** Đường LINE ĐỎ ở BIÊN va chạm (ArenaCollider) — viền lục giác + mũi tên pháp tuyến 6
     *  tường. Chỉ vẽ khi COLLISION_VECTORS bật. COLOR = màu đường/​mũi tên; Z = độ cao nhô
     *  khỏi mặt sân (tránh z-fight); NORMALS = có vẽ mũi tên pháp tuyến không; NORMAL_LEN =
     *  độ dài mũi tên (world units). Lưu ý: bề rộng nét (linewidth) đa số GPU BỎ QUA nên
     *  không đưa vào — muốn dày hơn thì tăng GLOW/đổi màu cho nổi. */
    ARENA_LINE: {
      COLOR: "#ff4d6d",
      Z: 0.35,
      NORMALS: true,
      NORMAL_LEN: 2.4,
      // Bán kính viền = biên va chạm thật: đọc `CONFIG.WALL_SCALE` (không có knob riêng nữa)
      // → line đỏ luôn trùng tường vật lý. Muốn kéo line vào/ra thì chỉnh WALL_SCALE ở trên.
    },
    /** Ngưỡng (world units) coi là "đang áp sát tường" để hiện vector (sớm hơn eps thật). */
    WALL_NEAR: 0.6,
    /** Bán kính (world units) VÒNG collider của cube người chơi (stroke tròn debug). */
    CUBE_COLLIDER_RADIUS: 0.6,
    /** Bán kính (world units) VÒNG va chạm đầu vẽ debug. Mặc định = KILL_RADIUS thật;
     *  đổi ở đây để phóng to/thu nhỏ vòng hiển thị mà không ảnh hưởng luật chơi. */
    KILL_RING_RADIUS: 0.3,
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
  { owned: [0.19, 0.55, 0.95], trail: [0.12, 0.3, 0.55], cube: "#eef4ff", glow: "#2f8fe6", name: "Bot Lam" },
  { owned: [0.93, 0.35, 0.4], trail: [0.5, 0.16, 0.2], cube: "#ffe9ea", glow: "#e6414c", name: "Bot Đỏ" },
  { owned: [0.35, 0.82, 0.46], trail: [0.15, 0.42, 0.22], cube: "#e9ffef", glow: "#33cc63", name: "Bot Lục" },
  { owned: [0.95, 0.68, 0.24], trail: [0.5, 0.35, 0.1], cube: "#fff3e0", glow: "#f0a52a", name: "Bot Cam" },
  { owned: [0.72, 0.46, 0.96], trail: [0.36, 0.22, 0.5], cube: "#f6ecff", glow: "#a06be8", name: "Bot Tím" },
  { owned: [0.25, 0.78, 0.82], trail: [0.1, 0.38, 0.42], cube: "#e6ffff", glow: "#2fc6d0", name: "Bot Ngọc" },
];

/** Các hình 3D người chơi được phép chọn ở màn Welcome. Thứ tự là contract trên wire. */
export const PLAYER_SHAPES = [
  "cube",
  "cylinder",
  "sphere",
  "cone",
  "fly",
  "bee",
  "ladybug",
] as const;
export type PlayerShape = (typeof PLAYER_SHAPES)[number];

/** Pattern texture của ống đuôi. Thứ tự là contract trên wire. */
export const TRAIL_PATTERNS = ["solid", "stripes", "dots", "chevrons"] as const;
export type TrailPattern = (typeof TRAIL_PATTERNS)[number];

/** Ngoại hình được dùng chung giữa Welcome, mô phỏng local và JOIN multiplayer. */
export interface PlayerAppearance {
  colorIndex: number;
  trailPattern: TrailPattern;
  shape: PlayerShape;
}

export const DEFAULT_PLAYER_APPEARANCE: PlayerAppearance = {
  colorIndex: 0,
  trailPattern: "solid",
  shape: "cube",
};

/** Chuẩn hoá dữ liệu từ localStorage/network về đúng palette và danh sách hình cho phép. */
export function sanitizePlayerAppearance(
  value?: Partial<PlayerAppearance> | null
): PlayerAppearance {
  const colorIndex = Number.isInteger(value?.colorIndex)
    ? Math.max(0, Math.min(PLAYER_COLORS.length - 1, value!.colorIndex!))
    : DEFAULT_PLAYER_APPEARANCE.colorIndex;
  const trailPattern = TRAIL_PATTERNS.includes(value?.trailPattern as TrailPattern)
    ? (value!.trailPattern as TrailPattern)
    : DEFAULT_PLAYER_APPEARANCE.trailPattern;
  const shape = PLAYER_SHAPES.includes(value?.shape as PlayerShape)
    ? (value!.shape as PlayerShape)
    : DEFAULT_PLAYER_APPEARANCE.shape;
  return { colorIndex, trailPattern, shape };
}
