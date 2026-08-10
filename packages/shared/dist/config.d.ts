export declare const CONFIG: {
    /** Bán kính NGOẠI TIẾP (tâm → đỉnh) của SÂN CHƠI hình LỤC GIÁC (flat-top), world
     *  units. Biên là 6 tường nghiêng 120° → không còn góc vuông gây kẹt. */
    readonly ARENA_RADIUS: 60;
    /** Lề (world units) phủ thêm hex NGOÀI tường: chỉ dùng cho tính toán (đầu người
     *  chơi luôn rơi vào ô hợp lệ + flood fill có vành biên); các ô này KHÔNG render
     *  nên không "thò ra" ngoài tường. */
    readonly MAP_MARGIN: 1.5;
    /** Số bot đối kháng. */
    readonly BOT_COUNT: 4;
    /** Bán kính cụm khởi đầu (cube distance). 1 = ô hiện tại + 6 ô kề = 7 ô. */
    readonly START_RADIUS: 1;
    /** Khoảng trống tối thiểu quanh điểm spawn (cube distance): không được có ô đất của
     *  BẤT KỲ ai trong bán kính này → spawn không nằm sát lãnh thổ đã chiếm. */
    readonly SPAWN_CLEARANCE: 10;
    /** Thời gian chuẩn bị (giây) khi vào trận / hồi sinh: đứng yên, chỉ xoay hướng. */
    readonly PREP_TIME: 3;
    /** Kích thước 1 hex (tâm → đỉnh), đơn vị world. */
    readonly HEX_SIZE: 1;
    /** Cạnh cube nhân vật (người + bot), đơn vị world. Chỉnh to/nhỏ nhân vật ở đây. */
    readonly CUBE_SIZE: 1;
    /** Tốc độ di chuyển liên tục (world units / giây). Nhỏ = chậm. */
    readonly SPEED: 10;
    /** Tốc độ quay đầu tối đa (rad / giây) — làm chuyển hướng mượt. */
    readonly TURN_RATE: 15;
    /** Khoảng cách tối thiểu giữa 2 điểm ghi vào đường đuôi (để line mượt & gọn). */
    readonly TRAIL_POINT_DIST: 0.18;
    /** Ngưỡng % diện tích để lên King. */
    readonly KING_PCT: 20;
    /** Thời gian (giây) phải giữ ngôi King liên tục để thắng. */
    readonly WIN_HOLD_TIME: 180;
    /** Bán kính va chạm ĐẦU (world units): chủ đất hạ kẻ xâm nhập khi hai đầu sát nhau. */
    readonly KILL_RADIUS: 0.7;
    /** Tường biên: dày (world units, ăn ra ngoài sân), cao, độ nhô lên khỏi mặt sân. */
    readonly WALL: {
        readonly THICKNESS: 0.1;
        readonly HEIGHT: 0.2;
    };
    /** AI bot. */
    readonly BOT: {
        /** Khoảng cách tối đa rời "nhà" trước khi quay về khép vòng (world units). */
        readonly RANGE_MIN: 6;
        readonly RANGE_MAX: 16;
        /** Nhiễu hướng khi bành trướng (rad) — cho đường đi bớt thẳng đơ. */
        readonly WANDER: 0.05;
        /** Thời gian (giây) bot nằm chờ trước khi tự hồi sinh sau khi chết. */
        readonly RESPAWN_DELAY: 1.5;
        /** Cự ly quét chướng ngại phía trước (world units) khi né đuôi/tường. */
        readonly AVOID_DIST: 1.6;
    };
    /** Hồ sơ ĐỘ KHÓ của bot (gán luân phiên cho từng bot). FSM: EXPAND/RETURN/HUNT/FLEE.
     *  - aggression: xác suất chuyển sang SĂN khi thấy con mồi.
     *  - vision: tầm phát hiện đối thủ (world units).
     *  - skill: chất lượng né chướng ngại (0..1) — cao thì quét nhiều hướng, nhìn xa hơn.
     *  - reaction: nhịp ra quyết định (giây) — nhỏ = phản ứng nhanh. */
    readonly BOT_DIFFICULTY: readonly [{
        readonly label: "Dễ";
        readonly aggression: 0.12;
        readonly vision: 12;
        readonly skill: 0.4;
        readonly reaction: 0.6;
    }, {
        readonly label: "Thường";
        readonly aggression: 0.45;
        readonly vision: 20;
        readonly skill: 0.75;
        readonly reaction: 0.3;
    }, {
        readonly label: "Khó";
        readonly aggression: 3.8;
        readonly vision: 28;
        readonly skill: 10;
        readonly reaction: 0.15;
    }];
    /** Camera perspective: vị trí lệch so với người chơi (x, sau, cao) + fov + độ mượt pan.
     *  Rotation KHOÁ cố định (chỉ pan theo người chơi, không xoay theo chuột). */
    readonly CAMERA: {
        readonly OFFSET: [number, number, number];
        readonly FOV: 42;
        readonly LERP: 0.15;
        /** Hệ số phóng lớn camera theo diện tích — 1 = gần nhất, MAX = xa nhất khi đạt
         *  ngưỡng King (giống agar.io: càng lớn càng thấy rộng sân). */
        readonly ZOOM: {
            readonly MIN: 1;
            readonly MAX: 1.3;
        };
    };
    /** Hiệu ứng "juice": số hạt mỗi lần nổ + thời gian sống (giây) của hạt. */
    readonly EFFECTS: {
        readonly PARTICLES: 14;
        readonly LIFE: 0.8;
    };
    /** Vạch vàng ngăn cách hai vùng ĐẤT cùng màu khác chủ: bề rộng (world units), màu, và
     *  độ phát sáng (dùng blending cộng dồn) — WIDTH lớn = vạch dày, GLOW lớn = sáng hơn. */
    readonly BORDER: {
        readonly WIDTH: 0.18;
        readonly COLOR: "#ffe14d";
        readonly GLOW: 2.2;
    };
    /** Joystick ảo (thiết bị chạm): SIZE = đường kính base, KNOB = đường kính núm
     *  (px); DEADZONE = vùng chết tính theo tỉ lệ bán kính (bỏ qua rung tay nhỏ). */
    readonly JOYSTICK: {
        readonly SIZE: 132;
        readonly KNOB: 56;
        readonly DEADZONE: 0.18;
    };
    /** Gỡ lỗi hình ảnh. COLLISION_VECTORS = true → vẽ mũi tên vector vật lý va chạm
     *  tường ngay tại đầu người chơi: xanh dương = hướng đi mong muốn, đỏ = pháp tuyến
     *  tường đang chạm, xanh lá = hướng trượt kết quả. Dùng để thấy vì sao chết sát biên. */
    readonly DEBUG: {
        readonly COLLISION_VECTORS: true;
        /** Ngưỡng (world units) coi là "đang áp sát tường" để hiện vector (sớm hơn eps thật). */
        readonly WALL_NEAR: 0.6;
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
