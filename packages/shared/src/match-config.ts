// MatchConfig — cấu hình MỘT VÁN, truyền vào `GameState` lúc tạo ván (doc 25 §1.1).
//
// NÚT THẮT P0: trước đây mọi ván đọc thẳng singleton `CONFIG` + hình học sân bị đóng băng
// lúc load module (`arena.ts`). Tách thành object per-instance để mỗi mode (Luyện tập /
// Tournament / Cấp độ) dựng sân + luật + điều kiện thắng riêng.
//
// NGUYÊN TẮC: MỌI field có default = giá trị `CONFIG` hiện tại ⇒ `resolveMatchConfig()`
// không truyền gì cho ra hành vi Y HỆT bản cũ (đảm bảo P0 KHÔNG đổi trải nghiệm).
//
// PHẠM VI P0 (chủ ý): chỉ đưa vào MatchConfig phần GameState cần để tách sân + luật cơ bản
// + điều kiện thắng. Cấu hình TOTEM và profile TỐC ĐỘ/AI bot vẫn đọc từ CONFIG (còn chia sẻ
// với totems.ts) — mở rộng vào `rules` là việc P1 khi làm preset Practice, không cần cho nền.

import { CONFIG } from "./config";
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
export type WinConditionKind =
  | "king_hold" // giữ ngôi King liên tục đủ winHoldTime (mặc định Tournament/đơn hiện tại)
  | "territory_pct" // đạt X% lãnh thổ (P1+)
  | "survive" // sống sót T giây (P1+)
  | "capture_totems" // thu N totem (P1+)
  | "none"; // Luyện tập: không thắng/thua

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
  min: number; // SPEED.BY_KING_PCT.MIN
  max: number; // SPEED.BY_KING_PCT.MAX
}

/** Cấu hình TOTEM per-ván (CONFIG.TOTEMS.*) — mode chỉnh số lượng/độ mạnh/khoảng cách riêng. */
export interface MatchTotemRules {
  speedCount: number; // TOTEMS.SPEED.COUNT
  speedBonus: number; // TOTEMS.SPEED.BONUS_PER_TOTEM
  slowCount: number; // TOTEMS.SLOW.COUNT
  slowEnemySpeed: number; // TOTEMS.SLOW.ENEMY_SPEED
  slowRadius: number; // TOTEMS.SLOW.RADIUS
  radarCount: number; // TOTEMS.RADAR.COUNT
  minSpawnDistance: number; // TOTEMS.MIN_SPAWN_DISTANCE
  spawnClearance: number; // TOTEMS.SPAWN_CLEARANCE
}

/** Luật cơ bản GameState đọc trực tiếp mỗi tick. P1 (S2): thêm totem + tốc độ + turn-rate bot
 *  (trước đọc thẳng CONFIG, chia sẻ với totems.ts) để mode Luyện tập/Campaign chỉnh riêng. */
export interface MatchRules {
  prepTime: number; // PREP_TIME
  startRadius: number; // START_RADIUS
  spawnClearance: number; // SPAWN_CLEARANCE
  turnRate: number; // TURN_RATE (người chơi)
  botTurnRate: number; // BOT.TURN_RATE (bot)
  trailPointDist: number; // TRAIL_POINT_DIST
  killRadius: number; // KILL_RADIUS
  selfTrailGrace: number; // SELF_TRAIL_GRACE
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
export type MatchRulesInput =
  & Partial<Omit<MatchRules, "speed" | "totems">>
  & {
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
export function resolveMatchConfig(input: MatchConfigInput = {}): MatchConfig {
  return {
    map: {
      shape: input.map?.shape ?? "hexagon",
      radius: input.map?.radius ?? CONFIG.ARENA_RADIUS,
      wallScale: input.map?.wallScale ?? CONFIG.WALL_SCALE,
      hexSize: input.map?.hexSize ?? CONFIG.HEX_SIZE,
      mapMargin: input.map?.mapMargin ?? CONFIG.MAP_MARGIN,
      cells: input.map?.cells,
      obstacles: input.map?.obstacles,
      totems: input.map?.totems,
      showColliders: input.map?.showColliders ?? false,
    },
    bots: {
      count: input.bots?.count ?? CONFIG.BOT_COUNT,
      difficultyMix: input.bots?.difficultyMix,
    },
    rules: {
      prepTime: input.rules?.prepTime ?? CONFIG.PREP_TIME,
      startRadius: input.rules?.startRadius ?? CONFIG.START_RADIUS,
      spawnClearance: input.rules?.spawnClearance ?? CONFIG.SPAWN_CLEARANCE,
      turnRate: input.rules?.turnRate ?? CONFIG.TURN_RATE,
      botTurnRate: input.rules?.botTurnRate ?? CONFIG.BOT.TURN_RATE,
      trailPointDist: input.rules?.trailPointDist ?? CONFIG.TRAIL_POINT_DIST,
      killRadius: input.rules?.killRadius ?? CONFIG.KILL_RADIUS,
      selfTrailGrace: input.rules?.selfTrailGrace ?? CONFIG.SELF_TRAIL_GRACE,
      speed: {
        min: input.rules?.speed?.min ?? CONFIG.SPEED.BY_KING_PCT.MIN,
        max: input.rules?.speed?.max ?? CONFIG.SPEED.BY_KING_PCT.MAX,
      },
      totemsEnabled: input.rules?.totemsEnabled ?? true,
      maxLives: input.rules?.maxLives ?? 0,
      totems: {
        speedCount: input.rules?.totems?.speedCount ?? CONFIG.TOTEMS.SPEED.COUNT,
        speedBonus: input.rules?.totems?.speedBonus ?? CONFIG.TOTEMS.SPEED.BONUS_PER_TOTEM,
        slowCount: input.rules?.totems?.slowCount ?? CONFIG.TOTEMS.SLOW.COUNT,
        slowEnemySpeed: input.rules?.totems?.slowEnemySpeed ?? CONFIG.TOTEMS.SLOW.ENEMY_SPEED,
        slowRadius: input.rules?.totems?.slowRadius ?? CONFIG.TOTEMS.SLOW.RADIUS,
        radarCount: input.rules?.totems?.radarCount ?? CONFIG.TOTEMS.RADAR.COUNT,
        minSpawnDistance: input.rules?.totems?.minSpawnDistance ?? CONFIG.TOTEMS.MIN_SPAWN_DISTANCE,
        spawnClearance: input.rules?.totems?.spawnClearance ?? CONFIG.TOTEMS.SPAWN_CLEARANCE,
      },
    },
    win: {
      kind: input.win?.kind ?? "king_hold",
      kingPct: input.win?.kingPct ?? CONFIG.KING_PCT,
      winHoldTime: input.win?.winHoldTime ?? CONFIG.WIN_HOLD_TIME,
      targetPct: input.win?.targetPct,
      durationSec: input.win?.durationSec,
      totemGoal: input.win?.totemGoal,
    },
    seed: input.seed ?? 0,
  };
}

// ---- Preset theo MODE (doc 25 §1.1) — trả MatchConfigInput để ghép thêm seed/override. --------

/** Preset LUYỆN TẬP (`/play`): endless (`win=none`, không thắng/thua), tự chỉnh số bot; các luật
 *  khác = default CONFIG. Client dựng `new GameState({ config: practiceConfig({ botCount }) })`. */
export function practiceConfig(input: { botCount?: number } = {}): MatchConfigInput {
  return {
    win: { kind: "none" },
    ...(input.botCount !== undefined ? { bots: { count: input.botCount } } : {}),
  };
}

/** Preset TOURNAMENT (`/netplay`): giữ ngôi King (`king_hold`) đủ `winHoldTime` giây. Phòng online
 *  bật `externalWinControl` nên tự chạy countdown theo vòng đời; `winHoldTime` gửi xuống client để
 *  hiển thị đúng thời lượng giữ ngôi. */
export function tournamentConfig(input: { botCount?: number; winHoldTime?: number } = {}): MatchConfigInput {
  return {
    win: { kind: "king_hold", ...(input.winHoldTime !== undefined ? { winHoldTime: input.winHoldTime } : {}) },
    ...(input.botCount !== undefined ? { bots: { count: input.botCount } } : {}),
  };
}
