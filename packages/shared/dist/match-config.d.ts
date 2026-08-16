import type { HexKey } from "./hex";
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
}
export interface MatchBotConfig {
    count: number;
    /** Chỉ số vòng vào CONFIG.BOT_DIFFICULTY gán luân phiên cho bot. Mặc định [0..n-1]
     *  (luân phiên toàn bảng) → giữ hành vi hiện tại. */
    difficultyMix?: number[];
}
/** Luật cơ bản GameState đọc trực tiếp mỗi tick (không gồm totem/speed sâu — xem ghi chú đầu file). */
export interface MatchRules {
    prepTime: number;
    startRadius: number;
    spawnClearance: number;
    turnRate: number;
    trailPointDist: number;
    killRadius: number;
    selfTrailGrace: number;
}
export interface MatchConfig {
    map: MatchMapConfig;
    bots: MatchBotConfig;
    rules: MatchRules;
    win: WinCondition;
    /** Seed RNG cho totem (deterministic giữa server/client) — trước là `matchSeed`. */
    seed: number;
}
/** Deep-partial để override từng nhánh mà không phải khai lại toàn bộ. */
export type MatchConfigInput = {
    map?: Partial<MatchMapConfig>;
    bots?: Partial<MatchBotConfig>;
    rules?: Partial<MatchRules>;
    win?: Partial<WinCondition>;
    seed?: number;
};
/** Điền default từ CONFIG rồi ghép override. Không truyền gì ⇒ bằng hành vi hiện tại. */
export declare function resolveMatchConfig(input?: MatchConfigInput): MatchConfig;
