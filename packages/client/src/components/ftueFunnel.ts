// FTUE — phần ĐO (doc 35 §D1, lát d1.2). Tách khỏi `Ftue.tsx` vì cùng một lý do đã tách
// `ftueSteps.ts`: đây là thứ hỏng ÂM THẦM.
//
// Luật vượt bước hỏng thì người mới kẹt và ta thấy ngay khi chơi thử. Phần đo hỏng thì **không ai
// thấy gì cả** — game vẫn chạy đúng, cổng CI vẫn xanh, chỉ có con số "hoàn thành FTUE ≥ 70%"
// (doc 35 §8) lặng lẽ trả về một giá trị sai. Và một chỉ số sai còn tệ hơn không có chỉ số: nó
// được đem ra quyết định.
//
// Nên ba luật dưới đây được cưỡng chế bằng mã chứ không bằng ghi chú, và được test bằng dữ liệu:
//
//  1. **Mỗi bước phát ĐÚNG MỘT LẦN.** `onStats` chạy 24 lần/giây; phát theo frame thì mẫu số của
//     funnel sẽ là số frame chứ không phải số người.
//  2. **Các rổ LOẠI TRỪ NHAU.** Một thiết bị phải rơi vào đúng một trong ba kết cục:
//     còn-đang-làm / xong / bỏ-qua. Nếu một thiết bị đếm được ở cả `xong` lẫn `bo_qua` thì hai cột
//     của funnel không cộng lại thành tổng nào có nghĩa. Hôm nay nút "Bỏ qua" bị ẩn ngay khi hiện
//     lời khen, nên chuyện đó gần như không xảy ra — nhưng "gần như không xảy ra" là một tính chất
//     của CSS và thứ tự render, không phải của phép đo. Ở đây nó thành bất khả theo cấu trúc.
//  3. **Có THỜI GIAN.** doc 35 §D1 nói "90 giây đầu". Không có `seconds` thì không trả lời được câu
//     hỏi thực sự hành động được: người bỏ dở là người *loay hoay mãi không qua được*, hay người
//     *đóng app sau 5 giây*? Hai nguyên nhân đó cần hai cách sửa ngược nhau.

import { FTUE_STEP_IDS, ftueStepIndex, type FtueStepId } from "./ftueSteps";

/** Kết cục của một sự kiện `ftue_step`. Khớp đúng chuỗi mà `analytics-queries.md` §Q2 lọc theo. */
export type FtueOutcome = "enter" | "complete" | "skipped";

/** Thân `props` của một sự kiện `ftue_step`. */
export interface FtueFunnelEvent {
  /** Id bước, hoặc `"done"` khi đã qua hết. */
  step: FtueStepId | "done";
  /** Thứ tự bước, 1-based; bằng `total` khi đã xong. */
  index: number;
  total: number;
  outcome: FtueOutcome;
  /** Giây kể từ lúc FTUE bắt đầu, làm tròn. */
  seconds: number;
}

/**
 * Bộ đếm funnel của MỘT lượt FTUE.
 *
 * Thuần: không chạm React, không chạm mạng, không đọc đồng hồ toàn cục — mọi mốc thời gian đều
 * truyền vào. Nhờ vậy test lái được cả những chuỗi mà tay người không bấm ra được.
 */
export class FtueFunnel {
  private readonly announced = new Set<string>();
  private closed = false;

  constructor(private readonly startedMs: number) {}

  /** Đã chốt kết cục cuối (xong hoặc bỏ qua) chưa. */
  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Ghi nhận bước hiện tại. Trả về sự kiện cần phát, hoặc `null` khi không có gì mới.
   *
   * `null` là trường hợp THƯỜNG GẶP NHẤT — hàm này được gọi mỗi lần `signals` đổi.
   */
  observe(step: FtueStepId | null, nowMs: number): FtueFunnelEvent | null {
    if (this.closed) return null;
    const key = step ?? "__done__";
    // Lùi bước rồi tiến lại (pct tụt xuống dưới ngưỡng rồi lên lại) KHÔNG phát lần hai: funnel đếm
    // "đã từng tới bước này", nên một thiết bị chỉ được góp một lần vào mỗi bậc.
    if (this.announced.has(key)) return null;
    this.announced.add(key);
    if (step === null) this.closed = true;
    return this.event(step, step === null ? "complete" : "enter", nowMs);
  }

  /**
   * Người chơi bấm "Bỏ qua". Trả `null` nếu kết cục đã chốt — xem luật 2 ở đầu file.
   */
  skip(step: FtueStepId | null, nowMs: number): FtueFunnelEvent | null {
    if (this.closed) return null;
    this.closed = true;
    return this.event(step, "skipped", nowMs);
  }

  private event(step: FtueStepId | null, outcome: FtueOutcome, nowMs: number): FtueFunnelEvent {
    return {
      step: step ?? "done",
      index: step ? ftueStepIndex(step) : FTUE_STEP_IDS.length,
      total: FTUE_STEP_IDS.length,
      outcome,
      seconds: elapsedSeconds(this.startedMs, nowMs),
    };
  }
}

/**
 * Giây đã trôi, làm tròn, không bao giờ âm.
 *
 * Kẹp về 0 khi đồng hồ đi lùi: `Date.now()` nhảy ngược được (đồng bộ NTP, người dùng chỉnh giờ,
 * máy ngủ dậy). Một `seconds` âm không sai *nhiều hơn* một `seconds` bằng 0 — nhưng nó làm hỏng
 * mọi phép trung bình/percentile ở phía truy vấn, và nó lọt qua `sanitizeProps` vì -3 vẫn là số
 * hữu hạn hợp lệ.
 */
export function elapsedSeconds(startedMs: number, nowMs: number): number {
  if (!Number.isFinite(startedMs) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, Math.round((nowMs - startedMs) / 1000));
}
