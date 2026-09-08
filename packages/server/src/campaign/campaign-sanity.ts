import { resolveMatchConfig, type MatchConfigInput } from "@hexagon/shared";

/**
 * doc 35 §A3 lớp 2 — chặn kết quả campaign PHI LÝ.
 *
 * Lớp 1 (`a3.1`) đã bỏ việc nhận `stars`/`objectiveMet` từ client: server tự chấm bằng
 * `evaluateCampaignOutcome`. Nhưng nó vẫn chấm trên **dữ kiện thô do client khai**
 * (`territoryPct`, `deaths`, …), nên một client bị sửa vẫn khai được "đã chiếm 90% đất" ngay giây
 * đầu tiên và server không có gì để phản bác.
 *
 * Lớp này thêm một thứ server BIẾT CHẮC mà client không nói dối được: **thời gian đã trôi**, đo
 * bằng `campaign_plays.created_at` của chính server.
 *
 * ┌─ NGUYÊN TẮC THIẾT KẾ QUAN TRỌNG NHẤT ────────────────────────────────────────────────────┐
 * │ doc 35 §9 rủi ro #6: *"từ chối oan khi siết A3"*. Từ chối oan ở đây KHÔNG phải phiền toái  │
 * │ nhỏ — người chơi mất năng lượng mỗi lượt và **không bao giờ mở khoá được cấp kế tiếp**.   │
 * │ Vì vậy ngưỡng dưới đây dùng cận **VẬT LÝ TUYỆT ĐỐI** chứ không phải "thời gian hợp lý":   │
 * │                                                                                            │
 * │   • Chu vi tối thiểu để bao một diện tích lấy từ **bất đẳng thức đẳng chu** — không hình   │
 * │     nào bao được diện tích A bằng đường ngắn hơn hình tròn. Đây là cận toán học, không     │
 * │     phải ước lượng.                                                                        │
 * │   • Tốc độ lấy **MAX tuyệt đối**: tốc độ trần + toàn bộ bonus totem tốc độ, kể cả khi cấp  │
 * │     đó chỉ có vài totem.                                                                   │
 * │   • Nhân thêm `SAFETY_FACTOR` để chỉ chặn phần rõ ràng bất khả.                            │
 * │                                                                                            │
 * │ Kết quả: một người chơi giỏi bất thường vẫn chậm hơn ngưỡng này **nhiều lần**. Thứ bị chặn │
 * │ là `elapsed = 0.2s` mà khai chiếm 90% đất — tức là gian lận, không phải kỹ năng.           │
 * └────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/**
 * Chỉ chặn khi thời gian chơi **nhỏ hơn một nửa** cận vật lý.
 *
 * Vì sao không dùng thẳng 1.0: cận đã rất rộng, nhưng cấu hình cấp có thể đổi sau khi lượt chơi
 * bắt đầu (admin publish bản mới), và khi đó ta chấm bằng cấu hình MỚI trên một lượt chơi theo
 * cấu hình CŨ. Hệ số này nuốt trọn loại sai lệch đó.
 */
export const SAFETY_FACTOR = 0.5;

/** Lượt chơi dài hơn mức này là một bản ghi cũ được nộp lại, không phải một ván thật. */
export const MAX_PLAY_SECONDS = 4 * 60 * 60;

/** Trần số lần HOÀN THÀNH cùng một cấp trong một ngày UTC. */
export const DAILY_COMPLETIONS_PER_LEVEL = 20;

/** Trần số lời gọi `campaign/complete` mỗi phút cho mỗi người chơi. */
export const COMPLETE_CALLS_PER_MINUTE = 10;

/** Diện tích hình lục giác đều có bán kính ngoại tiếp `r`, đơn vị world². */
export function hexArea(r: number): number {
  return r > 0 ? (3 * Math.sqrt(3) / 2) * r * r : 0;
}

/**
 * Tốc độ lớn nhất một người chơi CÓ THỂ đạt trong cấu hình này.
 *
 * Cộng toàn bộ bonus totem tốc độ dù thực tế không ai nhặt hết — đây là cận trên, và cận trên càng
 * rộng thì càng không thể từ chối oan.
 */
export function maxAttainableSpeed(config: MatchConfigInput): number {
  const r = resolveMatchConfig(config).rules;
  const totemBonus = r.totemsEnabled ? Math.max(0, r.totems.speedCount) * Math.max(0, r.totems.speedBonus) : 0;
  return Math.max(0.1, r.speed.max + totemBonus);
}

/**
 * Thời gian TỐI THIỂU (giây) để đạt được mục tiêu của cấp, theo vật lý của bản đồ.
 *
 * Trả `0` nghĩa là không suy ra được cận nào — khi đó KHÔNG chặn. Không biết thì không đoán.
 */
export function minPlausibleSeconds(config: MatchConfigInput): number {
  const cfg = resolveMatchConfig(config);
  const speed = maxAttainableSpeed(config);
  const prep = Math.max(0, cfg.rules.prepTime);

  switch (cfg.win.kind) {
    case "territory_pct": {
      // Khớp CHÍNH XÁC cách `evaluateCampaignOutcome` đọc mục tiêu: `targetPct` là phân số 0..1,
      // thiếu nó thì lùi về `kingPct` (thang 0..100). Lệch chỗ này là chặn nhầm ngưỡng.
      const targetFrac = cfg.win.targetPct !== undefined ? cfg.win.targetPct : cfg.win.kingPct / 100;
      if (!(targetFrac > 0)) return 0;
      const arena = hexArea(cfg.map.radius);
      // Người chơi đã sẵn có vùng xuất phát — chỉ phải bao thêm phần còn thiếu.
      const need = Math.max(0, targetFrac * arena - hexArea(cfg.rules.startRadius));
      if (need <= 0) return prep;
      // Bất đẳng thức đẳng chu: chu vi P của một vùng diện tích A luôn thoả P >= 2*sqrt(pi*A).
      const perimeter = 2 * Math.sqrt(Math.PI * need);
      return prep + perimeter / speed;
    }
    case "survive":
      // Đã được `evaluateCampaignOutcome` ép; lặp ở đây để cận luôn đúng kể cả khi evaluator đổi.
      return prep + Math.max(0, cfg.win.durationSec ?? 0);
    case "capture_totems": {
      const goal = Math.max(0, cfg.win.totemGoal ?? 0);
      if (goal <= 1) return prep;
      // Totem cách nhau ít nhất `minSpawnDistance`, nên đi qua N cái tốn ít nhất (N-1) khoảng đó.
      return prep + ((goal - 1) * Math.max(0, cfg.rules.totems.minSpawnDistance)) / speed;
    }
    case "king_hold":
      return prep + Math.max(0, cfg.win.winHoldTime);
    default:
      return 0;
  }
}

export interface SanityVerdict {
  ok: boolean;
  code?: string;
  message?: string;
  /** Số liệu kèm theo để một báo cáo của người chơi thật có thể chẩn đoán được. */
  detail?: Record<string, number>;
}

const OK: SanityVerdict = { ok: true };

/**
 * Kiểm thời gian của một lượt chơi. Thuần — không chạm database, kiểm được không cần dựng gì.
 *
 * `elapsedSec` do SERVER đo (`Date.now() - campaign_plays.created_at`), không nhận từ client.
 */
export function checkElapsed(config: MatchConfigInput, elapsedSec: number): SanityVerdict {
  // Mốc thời gian hỏng ⇒ KHÔNG chặn. `NaN < x` là false nên nhánh dưới vốn đã cho qua, nhưng viết
  // rõ ra để lần sửa sau không vô tình biến nó thành chặn-tất-cả.
  if (!Number.isFinite(elapsedSec)) return OK;

  if (elapsedSec > MAX_PLAY_SECONDS) {
    return {
      ok: false, code: "play_too_old",
      message: "lượt chơi này đã quá cũ để nộp kết quả",
      detail: { elapsedSec: Math.round(elapsedSec), maxSeconds: MAX_PLAY_SECONDS },
    };
  }

  const floor = minPlausibleSeconds(config) * SAFETY_FACTOR;
  if (floor > 0 && elapsedSec < floor) {
    return {
      ok: false, code: "completed_too_fast",
      message: "thời gian chơi ngắn hơn mức vật lý cho phép của cấp này",
      detail: { elapsedSec: Math.round(elapsedSec * 100) / 100, minSeconds: Math.round(floor * 100) / 100 },
    };
  }
  return OK;
}

/** Mốc 00:00 UTC của hôm nay — cùng `DAY_RESET_TZ = "UTC"` mà doc 35 chốt #3 dùng cho mọi thứ khác. */
export function startOfUtcDay(now: number = Date.now()): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}
