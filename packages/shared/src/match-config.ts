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
}

export interface MatchBotConfig {
  count: number;
  /** Chỉ số vòng vào CONFIG.BOT_DIFFICULTY gán luân phiên cho bot. Mặc định [0..n-1]
   *  (luân phiên toàn bảng) → giữ hành vi hiện tại. */
  difficultyMix?: number[];
}

/** Luật cơ bản GameState đọc trực tiếp mỗi tick (không gồm totem/speed sâu — xem ghi chú đầu file). */
export interface MatchRules {
  prepTime: number; // PREP_TIME
  startRadius: number; // START_RADIUS
  spawnClearance: number; // SPAWN_CLEARANCE
  turnRate: number; // TURN_RATE (người chơi)
  trailPointDist: number; // TRAIL_POINT_DIST
  killRadius: number; // KILL_RADIUS
  selfTrailGrace: number; // SELF_TRAIL_GRACE
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
      trailPointDist: input.rules?.trailPointDist ?? CONFIG.TRAIL_POINT_DIST,
      killRadius: input.rules?.killRadius ?? CONFIG.KILL_RADIUS,
      selfTrailGrace: input.rules?.selfTrailGrace ?? CONFIG.SELF_TRAIL_GRACE,
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
