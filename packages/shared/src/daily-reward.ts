/**
 * doc 35 §B2 — điểm danh hằng ngày + chuỗi ngày. Phần THUẦN, dùng chung client và server.
 *
 * ┌─ VÌ SAO TÁCH RA ĐÂY THAY VÌ VIẾT THẲNG TRONG SQL ─────────────────────────────────────────┐
 * │ Client phải đếm ngược tới đúng mốc reset mà server dùng để quyết định "hôm nay đã nhận      │
 * │ chưa". Lệch một chút thôi là người chơi thấy đồng hồ về 0 rồi bấm và bị từ chối — kiểu lỗi  │
 * │ làm người ta mất niềm tin vào phần thưởng, mà log thì sạch bong.                            │
 * │ Một phép tính, một chỗ, hai bên import.                                                     │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ VÌ SAO UTC (chốt #3) ────────────────────────────────────────────────────────────────────┐
 * │ Không phải vì UTC "chuẩn hơn", mà vì nó KHÔNG CÓ giờ mùa hè. Một múi giờ có DST sẽ có một   │
 * │ ngày dài 25 giờ và một ngày dài 23 giờ mỗi năm; hôm đó chuỗi ngày của người chơi hoặc đứt   │
 * │ oan hoặc nhận được hai lần. Hai lỗi đều xảy ra một lần trong năm và đều không tái hiện nổi. │
 * │ Đổi lại: người ở múi giờ xa thấy mốc reset rơi vào giữa ngày của họ — nên client BẮT BUỘC   │
 * │ hiển thị đếm ngược, đó là lý do `msToNextReset` nằm ở đây.                                  │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 */

/** Mốc cắt ngày dùng chung cho điểm danh, nhiệm vụ, mùa và bảng xếp hạng (chốt #3). */
export const DAY_RESET_TZ = "UTC";

/** Số ngày trong một vòng thưởng trước khi quay lại ngày 1. */
export const DAILY_CYCLE_DAYS = 7;

const MS_MOI_NGAY = 86_400_000;

/**
 * Khoá ngày dạng `YYYY-MM-DD` theo UTC — khớp đúng kiểu `date` của `player_daily_claims`.
 *
 * Dùng `toISOString().slice(0,10)` chứ không `getFullYear()/getMonth()`: bộ getter không có `UTC`
 * đọc theo múi giờ của MÁY, nên cùng một thời điểm sẽ ra hai khoá khác nhau trên máy dev ở
 * Việt Nam và trên máy chủ ở UTC. Đó chính là lớp lỗi mà cả file này sinh ra để chặn.
 */
export function utcDayKey(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 10);
}

/** Số mili giây còn lại tới mốc reset kế tiếp (00:00 UTC). Dùng cho đồng hồ đếm ngược. */
export function msToNextReset(atMs: number): number {
  return MS_MOI_NGAY - (((atMs % MS_MOI_NGAY) + MS_MOI_NGAY) % MS_MOI_NGAY);
}

/** Khoá ngày UTC liền trước một khoá ngày. Qua tháng, qua năm, qua năm nhuận đều đúng. */
export function previousDayKey(dayKey: string): string {
  return utcDayKey(Date.parse(`${dayKey}T00:00:00Z`) - MS_MOI_NGAY);
}

export interface DailyClaimState {
  /** Khoá ngày UTC của lần nhận gần nhất, hoặc null nếu chưa từng nhận. */
  lastClaimDay: string | null;
  /** Chuỗi ngày liên tiếp tính tới `lastClaimDay`. */
  streak: number;
}

export interface DailyClaimPlan {
  /** Đã nhận trong ngày UTC này rồi ⇒ không cấp gì thêm. */
  alreadyClaimed: boolean;
  /** Chuỗi ngày SAU khi nhận hôm nay. */
  streak: number;
  /** Ngày thứ mấy trong vòng 7 (1..7) — chính là khoá tra `daily_rewards_config`. */
  cycleDay: number;
  /** Chuỗi có bị đứt so với lần nhận trước không (để client nói "chuỗi đã reset"). */
  streakReset: boolean;
}

/**
 * Quyết định lần điểm danh hôm nay cấp gì, từ trạng thái đã lưu.
 *
 * CỐ Ý là hàm thuần nhận `todayKey` thay vì tự gọi `Date.now()`: nếu không thì không test nổi
 * chuyện qua ngày, qua tháng, qua năm — và đó đúng là chỗ hay sai nhất.
 *
 * Lưu ý về `lastClaimDay` ở TƯƠNG LAI: không xử lý riêng. Nó chỉ xảy ra khi đồng hồ máy chủ bị
 * đẩy lùi, và khi đó rơi vào nhánh "đứt chuỗi" — thà reset chuỗi còn hơn phát thưởng theo một
 * mốc thời gian không tin được.
 */
export function planDailyClaim(state: DailyClaimState, todayKey: string): DailyClaimPlan {
  if (state.lastClaimDay === todayKey) {
    const streak = Math.max(1, state.streak);
    return { alreadyClaimed: true, streak, cycleDay: cycleDayOf(streak), streakReset: false };
  }
  const lienTiep = state.lastClaimDay !== null && state.lastClaimDay === previousDayKey(todayKey);
  const streak = lienTiep ? Math.max(1, state.streak) + 1 : 1;
  return {
    alreadyClaimed: false,
    streak,
    cycleDay: cycleDayOf(streak),
    streakReset: !lienTiep && state.lastClaimDay !== null,
  };
}

/** Ngày thứ mấy trong vòng lặp 7 ngày, từ chuỗi ngày. Chuỗi 8 quay lại ngày 1. */
export function cycleDayOf(streak: number): number {
  const s = Math.max(1, Math.floor(streak));
  return ((s - 1) % DAILY_CYCLE_DAYS) + 1;
}
