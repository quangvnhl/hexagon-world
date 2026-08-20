/** Chuyển mã màu sRGB #RGB/#RRGGBB thành RGB tuyến tính dùng trực tiếp bởi renderer. */
export declare function hexToLinearRgb(hex: string): [number, number, number];
export declare const CONFIG: {
    /** Bán kính NGOẠI TIẾP (tâm → đỉnh) của SÂN CHƠI hình LỤC GIÁC (flat-top), world
     *  units. Biên là 6 tường nghiêng 120° → không còn góc vuông gây kẹt. */
    readonly ARENA_RADIUS: 130;
    /** Hệ số CO BIÊN VA CHẠM THẬT vào trong (nhân vào inradius/circumradius). 1 = biên đầy
     *  đủ; < 1 = tường va chạm + sàn hex + đường line đỏ debug cùng co vào (vd 0.97 ≈ sát
     *  hơn 3%). ĐÂY LÀ NGUỒN DUY NHẤT: physics (arena.ts), vùng ô hợp lệ (mapArena) và line
     *  đỏ (ArenaCollider) đều đọc chung → biên vật lý LUÔN trùng đường line đỏ. */
    readonly WALL_SCALE: 0.99;
    /** Lề (world units) phủ thêm hex NGOÀI tường: chỉ dùng cho tính toán (đầu người
     *  chơi luôn rơi vào ô hợp lệ + flood fill có vành biên); các ô này KHÔNG render
     *  nên không "thò ra" ngoài tường. */
    readonly MAP_MARGIN: 0.6;
    /** Số bot đối kháng. */
    readonly BOT_COUNT: 24;
    /** Bán kính cụm khởi đầu (cube distance). 1 = ô hiện tại + 6 ô kề = 7 ô. */
    readonly START_RADIUS: 1;
    /** Khoảng trống tối thiểu quanh điểm spawn (cube distance): không được có ô đất của
     *  BẤT KỲ ai trong bán kính này → spawn không nằm sát lãnh thổ đã chiếm. */
    readonly SPAWN_CLEARANCE: 10;
    /** Thời gian chuẩn bị (giây) khi vào trận / hồi sinh: đứng yên, chỉ xoay hướng. */
    readonly PREP_TIME: 3;
    /** Kích thước 1 hex (tâm → đỉnh), đơn vị world. */
    readonly HEX_SIZE: 1;
    /** Hình thức viên lát lục giác và hiệu ứng nhấn khi người chơi bước sang ô mới. */
    readonly GRID: {
        /** Tỉ lệ bán kính phần nhìn thấy. Nhỏ hơn → khe giữa các ô trông dày hơn. */
        readonly TILE_SCALE: 0.9;
        /** Độ dày thật của khối lục giác (world units); mặt trên luôn nằm tại z = 0. */
        readonly THICKNESS: 0.2;
        /** Độ sâu tối đa và độ co ngang tại điểm nhún thấp nhất. */
        readonly PRESS_DEPTH: 0.4;
        readonly PRESS_SCALE: 0.95;
        /** Tổng thời gian nhún xuống rồi trở lại vị trí ban đầu (giây). */
        readonly PRESS_DURATION: 0.2;
    };
    /** Màu nền của bàn chơi và màu các ô lục giác chưa có chủ. */
    readonly MAP_COLORS: {
        readonly BACKGROUND: "#0e1013";
        /** Nhập màu sRGB dạng #RRGGBB; hệ thống tự chuyển sang RGB tuyến tính khi khởi động. */
        readonly NEUTRAL_HEX: "#2a2b2e";
    };
    /** Cạnh cube nhân vật (người + bot), đơn vị world. Chỉnh to/nhỏ nhân vật ở đây. */
    readonly CUBE_SIZE: 1.2;
    /** Tốc độ di chuyển liên tục (world units / giây). Nhỏ = chậm. */
    readonly SPEED: {
        readonly BY_KING_PCT: {
            readonly MIN: 5.5;
            readonly MAX: 7;
        };
    };
    readonly TOTEMS: {
        readonly SPEED: {
            readonly COUNT: 32;
            readonly BONUS_PER_TOTEM: 0.5;
        };
        readonly SLOW: {
            readonly COUNT: 12;
            readonly RADIUS: 8;
            readonly ENEMY_SPEED: 3;
        };
        readonly RADAR: {
            readonly COUNT: 30;
        };
        readonly MIN_SPAWN_DISTANCE: 18;
        readonly SPAWN_CLEARANCE: 12;
    };
    /** Tốc độ quay đầu tối đa (rad / giây) — làm chuyển hướng mượt. */
    readonly TURN_RATE: 4.5;
    /** Khoảng cách tối thiểu giữa 2 điểm ghi vào đường đuôi (để line mượt & gọn). */
    readonly TRAIL_POINT_DIST: 0.1;
    /** Ngưỡng % diện tích để lên King. */
    readonly KING_PCT: 20;
    /** Thời gian (giây) phải giữ ngôi King liên tục để thắng. */
    readonly WIN_HOLD_TIME: 180;
    /** Bán kính va chạm ĐẦU (world units): chủ đất hạ kẻ xâm nhập khi hai đầu sát nhau. */
    readonly KILL_RADIUS: 0.25;
    /** Số ô ĐUÔI mới nhất (sát đầu) được MIỄN luật tự-cắt-đuôi. Cần ≥1 để đầu không "chết
     *  oan" khi làm tròn hex dao động lúc đi dọc đúng ranh giới cột hex / men theo tường
     *  (đầu bị bật qua-lại giữa 2 ô kề). Cắt vào đoạn đuôi CŨ hơn thì vẫn chết như thường. */
    readonly SELF_TRAIL_GRACE: 2;
    /** Tường biên: dày (world units, ăn ra ngoài sân), cao, độ nhô lên khỏi mặt sân. */
    readonly WALL: {
        readonly THICKNESS: 0.1;
        readonly HEIGHT: 0.2;
    };
    /** AI bot. */
    readonly BOT: {
        /** Giới hạn AI tối đa 20 lần/giây; hướng đã chốt vẫn được nội suy mỗi frame. */
        readonly THINK_INTERVAL_MIN: 0.05;
        /** Tốc độ quay đầu RIÊNG của bot (rad/giây) — TÁCH khỏi TURN_RATE của người chơi để
         *  chỉnh độ nhanh nhẹn của bot mà không đổi cảm giác lái của người. Cao hơn → bot
         *  khép được vòng LỚN (bành trướng nhanh) nhưng nếu quá cao dễ curl vào đuôi mình. */
        readonly TURN_RATE: 2;
        /** Khoảng cách tối đa rời "nhà" trước khi quay về khép vòng (world units). */
        readonly RANGE_MIN: 6;
        readonly RANGE_MAX: 6;
        /** Nhiễu hướng khi bành trướng (rad) — cho đường đi bớt thẳng đơ. */
        readonly WANDER: 0.05;
        /** Thời gian (giây) bot nằm chờ trước khi tự hồi sinh sau khi chết. */
        readonly RESPAWN_DELAY: 3;
        /** Cự ly quét chướng ngại phía trước (world units) khi né đuôi/tường. */
        readonly AVOID_DIST: 1;
    };
    /** Hồ sơ ĐỘ KHÓ của bot (gán luân phiên cho từng bot). FSM: EXPAND/RETURN/HUNT/FLEE.
     *  - aggression: xác suất chuyển sang SĂN khi thấy con mồi.
     *  - vision: tầm phát hiện đối thủ (world units).
     *  - skill: chất lượng né chướng ngại (0..1) — cao thì quét nhiều hướng, nhìn xa hơn.
     *  - reaction: nhịp ra quyết định (giây) — nhỏ = phản ứng nhanh. */
    readonly BOT_DIFFICULTY: readonly [{
        readonly label: "Dễ";
        readonly aggression: 1;
        readonly vision: 12;
        readonly skill: 0.3;
        readonly reaction: 0.3;
    }, {
        readonly label: "Thường";
        readonly aggression: 4;
        readonly vision: 16;
        readonly skill: 0.5;
        readonly reaction: 0.2;
    }, {
        readonly label: "Khó";
        readonly aggression: 10;
        readonly vision: 20;
        readonly skill: 1;
        readonly reaction: 0.1;
    }];
    /** Camera: vị trí lệch so với người chơi (x, sau, cao) + projection + độ mượt pan.
     *  Rotation KHOÁ cố định (chỉ pan theo người chơi, không xoay theo chuột). */
    readonly CAMERA: {
        /** Đổi thành "ORTHOGRAPHIC" để dùng camera trực giao; mặc định giữ phối cảnh hiện tại. */
        readonly TYPE: "PERSPECTIVE" | "ORTHOGRAPHIC";
        readonly OFFSET: [number, number, number];
        readonly FOV: 60;
        readonly LERP: 0.15;
        /**
         * Cấu hình vùng nhìn riêng cho từng kiểu màn hình.
         * VIEW_SCALE: 1 = vùng nhìn chuẩn; >1 = rộng hơn.
         * ZOOM tăng dần từ MIN tới MAX theo phần trăm lãnh thổ của người chơi.
         */
        readonly PROFILES: {
            readonly DESKTOP: {
                readonly VIEW_SCALE: 1;
                readonly ZOOM: {
                    readonly MIN: 1;
                    readonly MAX: 1.4;
                };
            };
            readonly MOBILE_PORTRAIT: {
                readonly VIEW_SCALE: 1.2;
                readonly ZOOM: {
                    readonly MIN: 1;
                    readonly MAX: 1.8;
                };
            };
            readonly MOBILE_LANDSCAPE: {
                readonly VIEW_SCALE: 2.5;
                readonly ZOOM: {
                    readonly MIN: 1;
                    readonly MAX: 1.8;
                };
            };
        };
    };
    /** Hiệu ứng "juice": số hạt mỗi lần nổ + thời gian sống (giây) của hạt. */
    readonly EFFECTS: {
        readonly PARTICLES: 14;
        readonly LIFE: 0.8;
        /** Số giọt 3D và thời gian tồn tại của vụ nổ khi một nhân vật chết. */
        readonly DEATH_DROPS: 28;
        readonly DEATH_LIFE: 1.25;
        readonly DEATH_GRAVITY: 12;
        /** Chờ hiệu ứng chết kết thúc rồi mới phủ popup hồi sinh/xem (giây). */
        readonly DEATH_POPUP_DELAY: 2;
        /**
         * Kích thước sparkle chiếm đất. Perspective dùng world/attenuated size;
         * Orthographic dùng pixel size để không bị thu nhỏ li ti.
         */
        readonly CAPTURE_SPARK_SIZE: {
            readonly PERSPECTIVE: 0.5;
            readonly ORTHOGRAPHIC: 5;
        };
    };
    /** Vạch vàng ngăn cách hai vùng ĐẤT cùng màu khác chủ: bề rộng (world units), màu, và
     *  độ phát sáng (dùng blending cộng dồn) — WIDTH lớn = vạch dày, GLOW lớn = sáng hơn. */
    readonly BORDER: {
        readonly WIDTH: 0.18;
        readonly COLOR: "#ffe14d";
        readonly GLOW: 2.2;
        /** VIỀN TỐI (casing) vẽ RỘNG HƠN nằm dưới lõi vàng → vạch nổi trên MỌI màu đất, kể cả
         *  nền ấm (cam/vàng) khiến lõi vàng additive bị "cháy trắng" chìm. CASING_WIDTH = bề
         *  rộng dải tối (world units, > WIDTH); CASING_COLOR = màu viền (đục, blend thường).
         *  Đặt CASING_WIDTH = 0 để TẮT viền tối (chỉ còn lõi vàng như cũ). */
        readonly CASING_WIDTH: 0.34;
        readonly CASING_COLOR: "#05070d";
    };
    /** Joystick ảo (thiết bị chạm): SIZE = đường kính base, KNOB = đường kính núm
     *  (px); DEADZONE = vùng chết tính theo tỉ lệ bán kính (bỏ qua rung tay nhỏ). */
    readonly JOYSTICK: {
        readonly SIZE: 132;
        readonly KNOB: 56;
        readonly DEADZONE: 0.18;
    };
    /** Bật/tắt các lớp HIỂN THỊ để giảm tải khi đông bot (mỗi lớp là 1 chi phí/​frame).
     *  Tắt bớt khi máy yếu / nhiều bot cho mượt. FPS = đồng hồ khung hình góc màn hình. */
    readonly DISPLAY: {
        /** Đồng hồ FPS (overlay DOM góc trên-trái). */
        readonly FPS: true;
        /** Bảng điều khiển HUD (điểm số, King, countdown, popup chết…). */
        readonly HUD: true;
        /** Bản đồ con minimap (góc dưới-phải) — có vòng lặp rAF riêng, tắt để tiết kiệm. */
        readonly MINIMAP: true;
        /** Ống ĐUÔI 3D phát sáng của MỌI thực thể — CHI PHÍ LỚN NHẤT khi đông bot (mỗi
         *  frame dựng lại 1 TubeGeometry/​thực thể đang vẽ đuôi). Tắt → đuôi chỉ còn ô màu. */
        readonly TRAILS: true;
        /** Hạt hiệu ứng nổ/​chiếm đất (pooled Points). */
        readonly PARTICLES: true;
        /** Vạch vàng phân ranh đất cùng màu khác chủ. */
        readonly TERRITORY_BORDERS: true;
    };
    /** Gỡ lỗi hình ảnh. COLLISION_VECTORS = true → vẽ mũi tên vector vật lý va chạm
     *  tường ngay tại đầu người chơi: xanh dương = hướng đi mong muốn, đỏ = pháp tuyến
     *  tường đang chạm, xanh lá = hướng trượt kết quả. Dùng để thấy vì sao chết sát biên. */
    readonly DEBUG: {
        readonly COLLISION_VECTORS: true;
        /** Đường LINE ĐỎ ở BIÊN va chạm (ArenaCollider) — viền lục giác + mũi tên pháp tuyến 6
         *  tường. Chỉ vẽ khi COLLISION_VECTORS bật. COLOR = màu đường/​mũi tên; Z = độ cao nhô
         *  khỏi mặt sân (tránh z-fight); NORMALS = có vẽ mũi tên pháp tuyến không; NORMAL_LEN =
         *  độ dài mũi tên (world units). Lưu ý: bề rộng nét (linewidth) đa số GPU BỎ QUA nên
         *  không đưa vào — muốn dày hơn thì tăng GLOW/đổi màu cho nổi. */
        /** Đường LINE va chạm của CHƯỚNG NGẠI (ObstacleCollider) — cạnh hex giáp ô mở. COLOR = màu;
         *  Z = cao hơn ARENA_LINE chút để không z-fight với mặt sân/obstacle. */
        readonly OBSTACLE_LINE: {
            readonly COLOR: "#ffb020";
            readonly Z: 0.4;
        };
        readonly ARENA_LINE: {
            readonly COLOR: "#ff4d6d";
            readonly Z: 0.35;
            readonly NORMALS: true;
            readonly NORMAL_LEN: 2.4;
        };
        /** Ngưỡng (world units) coi là "đang áp sát tường" để hiện vector (sớm hơn eps thật). */
        readonly WALL_NEAR: 0.6;
        /** Bán kính (world units) VÒNG collider của cube người chơi (stroke tròn debug). */
        readonly CUBE_COLLIDER_RADIUS: 0.6;
        /** Bán kính (world units) VÒNG va chạm đầu vẽ debug. Mặc định = KILL_RADIUS thật;
         *  đổi ở đây để phóng to/thu nhỏ vòng hiển thị mà không ảnh hưởng luật chơi. */
        readonly KILL_RING_RADIUS: 0.3;
    };
};
export declare const COLORS: {
    neutral: [number, number, number];
    /** Tường biên (hex string cho three.js). */
    wall: string;
    wallEdge: string;
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
export declare const PLAYER_COLORS: PlayerColor[];
/** Các hình 3D người chơi được phép chọn ở màn Welcome. Thứ tự là contract trên wire. */
export declare const PLAYER_SHAPES: readonly ["cube", "cylinder", "sphere", "cone", "fly", "bee", "ladybug"];
export type PlayerShape = (typeof PLAYER_SHAPES)[number];
/** Pattern texture của ống đuôi. Thứ tự là contract trên wire. */
export declare const TRAIL_PATTERNS: readonly ["solid", "stripes", "dots", "chevrons"];
export type TrailPattern = (typeof TRAIL_PATTERNS)[number];
/** Ngoại hình được dùng chung giữa Welcome, mô phỏng local và JOIN multiplayer. */
export interface PlayerAppearance {
    colorIndex: number;
    trailPattern: TrailPattern;
    shape: PlayerShape;
}
export declare const DEFAULT_PLAYER_APPEARANCE: PlayerAppearance;
/** Chuẩn hoá dữ liệu từ localStorage/network về đúng palette và danh sách hình cho phép. */
export declare function sanitizePlayerAppearance(value?: Partial<PlayerAppearance> | null): PlayerAppearance;
