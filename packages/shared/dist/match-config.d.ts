import type { HexKey } from "./hex";
import type { TotemKind } from "./totems";
/** Totem đặt tường minh bởi tác giả cấp (trình vẽ admin — doc 32). Loại + ô (axial). */
export interface AuthoredTotem {
    kind: TotemKind;
    q: number;
    r: number;
}
/** Loại điều kiện thắng (doc 25 §1.2). P0 hiện thực `king_hold` + `none`; các loại còn lại
 *  khai báo sẵn contract để mode sau cắm vào mà không phải đổi hình dạng config. */
export type WinConditionKind = "king_hold" | "territory_pct" | "survive" | "capture_totems" | "none";
export interface WinCondition {
    kind: WinConditionKind;
    /** Ngưỡng % để lên King (king_hold). */
    kingPct: number;
    /** Giây phải giữ King liên tục để thắng (king_hold). */
    winHoldTime: number;
    /** Mục tiêu % lãnh thổ (territory_pct). */
    targetPct?: number;
    /** Mục tiêu thời gian sống sót, giây (survive). */
    durationSec?: number;
    /** Số totem cần thu (capture_totems). */
    totemGoal?: number;
}
export interface MatchMapConfig {
    shape: "hexagon" | "custom";
    /** Bán kính NGOẠI TIẾP sân lục giác (world units) — ARENA_RADIUS. */
    radius: number;
    /** Hệ số co biên va chạm — WALL_SCALE. */
    wallScale: number;
    /** Kích thước 1 hex — HEX_SIZE. */
    hexSize: number;
    /** Lề phủ thêm hex ngoài tường cho flood fill — MAP_MARGIN. */
    mapMargin: number;
    /** [custom, P1] Tập ô hợp lệ tường minh (thay cho lục giác đều). */
    cells?: HexKey[];
    /** [custom, P1] Ô chướng ngại coi như barrier nội bộ. */
    obstacles?: HexKey[];
    /** [doc 32] Totem đặt tường minh bởi tác giả. Có (≥1) ⇒ dùng ĐÚNG danh sách này, BỎ sinh
     *  ngẫu nhiên; vắng ⇒ giữ hành vi sinh ngẫu nhiên theo seed. */
    totems?: AuthoredTotem[];
    /** [doc 33] Hiện đường COLLIDER (viền obstacle + biên sân) trong game — dùng cho Campaign để
     *  thấy rõ mặt va chạm. Default false ⇒ bất biến. */
    showColliders?: boolean;
}
export interface MatchBotConfig {
    count: number;
    /** Chỉ số vòng vào CONFIG.BOT_DIFFICULTY gán luân phiên cho bot. Mặc định [0..n-1]
     *  (luân phiên toàn bảng) → giữ hành vi hiện tại. */
    difficultyMix?: number[];
}
/** Đường cong tốc độ nền theo % tiến tới ngưỡng King (CONFIG.SPEED.BY_KING_PCT). */
export interface MatchSpeedRules {
    min: number;
    max: number;
}
/** Cấu hình TOTEM per-ván (CONFIG.TOTEMS.*) — mode chỉnh số lượng/độ mạnh/khoảng cách riêng. */
export interface MatchTotemRules {
    speedCount: number;
    speedBonus: number;
    slowCount: number;
    slowEnemySpeed: number;
    slowRadius: number;
    radarCount: number;
    minSpawnDistance: number;
    spawnClearance: number;
}
/** Luật cơ bản GameState đọc trực tiếp mỗi tick. P1 (S2): thêm totem + tốc độ + turn-rate bot
 *  (trước đọc thẳng CONFIG, chia sẻ với totems.ts) để mode Luyện tập/Campaign chỉnh riêng. */
export interface MatchRules {
    prepTime: number;
    startRadius: number;
    spawnClearance: number;
    turnRate: number;
    botTurnRate: number;
    trailPointDist: number;
    killRadius: number;
    selfTrailGrace: number;
    /** Đường cong tốc độ nền (SPEED.BY_KING_PCT). */
    speed: MatchSpeedRules;
    /** Bật/tắt sinh Totem (Luyện tập có thể tắt hẳn). */
    totemsEnabled: boolean;
    /** Cấu hình Totem (số lượng/độ mạnh/khoảng cách). */
    totems: MatchTotemRules;
    /** [Campaign] Số mạng của CHỦ THỂ trước khi THUA. `0` = VÔ HẠN (hồi sinh tự do — hành vi
     *  mặc định /play, /netplay). `>0` = chết đủ số này ⇒ `GameState.lost` (doc 28 §E2b). */
    maxLives: number;
}
export interface MatchConfig {
    map: MatchMapConfig;
    bots: MatchBotConfig;
    rules: MatchRules;
    win: WinCondition;
    /** Seed RNG cho totem (deterministic giữa server/client) — trước là `matchSeed`. */
    seed: number;
}
/** Override rules cho phép partial cả nhánh lồng (speed/totems) mà không phải khai đủ. */
export type MatchRulesInput = Partial<Omit<MatchRules, "speed" | "totems">> & {
    speed?: Partial<MatchSpeedRules>;
    totems?: Partial<MatchTotemRules>;
};
/** Deep-partial để override từng nhánh mà không phải khai lại toàn bộ. */
export type MatchConfigInput = {
    map?: Partial<MatchMapConfig>;
    bots?: Partial<MatchBotConfig>;
    rules?: MatchRulesInput;
    win?: Partial<WinCondition>;
    seed?: number;
};
/** Điền default từ CONFIG rồi ghép override. Không truyền gì ⇒ bằng hành vi hiện tại. */
export declare function resolveMatchConfig(input?: MatchConfigInput): MatchConfig;
/** Preset LUYỆN TẬP (`/play`): endless (`win=none`, không thắng/thua), tự chỉnh số bot; các luật
 *  khác = default CONFIG. Client dựng `new GameState({ config: practiceConfig({ botCount }) })`. */
export declare function practiceConfig(input?: {
    botCount?: number;
}): MatchConfigInput;
/** Preset TOURNAMENT (`/netplay`): giữ ngôi King (`king_hold`) đủ `winHoldTime` giây. Phòng online
 *  bật `externalWinControl` nên tự chạy countdown theo vòng đời; `winHoldTime` gửi xuống client để
 *  hiển thị đúng thời lượng giữ ngôi. */
export declare function tournamentConfig(input?: {
    botCount?: number;
    winHoldTime?: number;
}): MatchConfigInput;
