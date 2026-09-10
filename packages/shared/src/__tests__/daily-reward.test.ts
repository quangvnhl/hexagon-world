// doc 35 §B2 — chuỗi ngày và mốc reset UTC.
//
// Thứ đáng giữ ở đây KHÔNG phải "cộng 1 vào streak" mà là ba chỗ mà lịch làm cho sai:
// qua tháng, qua năm, và ngày nhuận. Cả ba đều không bao giờ lộ ra trong lúc phát triển vì
// người viết code hiếm khi test đúng vào 28/2 hay 31/12.
import { describe, expect, it } from "vitest";
import {
  DAILY_CYCLE_DAYS, DAY_RESET_TZ, cycleDayOf, msToNextReset, planDailyClaim, previousDayKey, utcDayKey,
} from "../daily-reward";

describe("mốc ngày UTC", () => {
  it("chốt #3: mốc reset là UTC", () => {
    expect(DAY_RESET_TZ).toBe("UTC");
  });

  it("khoá ngày lấy theo UTC, không theo múi giờ của máy", () => {
    // 2026-09-10T23:30Z. Ở Việt Nam (UTC+7) đây đã là 06:30 ngày 11 — nếu ai đó dùng
    // `getFullYear()/getMonth()/getDate()` thì máy dev sẽ cho "2026-09-11" còn máy chủ cho
    // "2026-09-10", và người chơi mất hoặc được thêm một lần điểm danh tuỳ chỗ chạy.
    expect(utcDayKey(Date.parse("2026-09-10T23:30:00Z"))).toBe("2026-09-10");
    expect(utcDayKey(Date.parse("2026-09-11T00:00:00Z"))).toBe("2026-09-11");
  });

  it("đếm ngược về đúng 0 tại nửa đêm UTC và bằng cả ngày ngay sau đó", () => {
    expect(msToNextReset(Date.parse("2026-09-10T00:00:00Z"))).toBe(86_400_000);
    expect(msToNextReset(Date.parse("2026-09-10T23:59:59Z"))).toBe(1000);
    expect(msToNextReset(Date.parse("2026-09-10T12:00:00Z"))).toBe(43_200_000);
  });

  it("ngày liền trước đúng qua tháng, qua năm và qua ngày nhuận", () => {
    expect(previousDayKey("2026-09-10")).toBe("2026-09-09");
    expect(previousDayKey("2026-09-01")).toBe("2026-08-31");   // qua tháng
    expect(previousDayKey("2026-01-01")).toBe("2025-12-31");   // qua năm
    expect(previousDayKey("2028-03-01")).toBe("2028-02-29");   // 2028 là năm nhuận
    expect(previousDayKey("2027-03-01")).toBe("2027-02-28");   // 2027 thì không
  });
});

describe("chuỗi ngày", () => {
  it("lần đầu tiên là chuỗi 1, ngày 1 trong vòng", () => {
    const kh = planDailyClaim({ lastClaimDay: null, streak: 0 }, "2026-09-10");
    expect(kh).toMatchObject({ alreadyClaimed: false, streak: 1, cycleDay: 1, streakReset: false });
  });

  it("nhận hôm qua ⇒ chuỗi tăng", () => {
    const kh = planDailyClaim({ lastClaimDay: "2026-09-09", streak: 3 }, "2026-09-10");
    expect(kh).toMatchObject({ alreadyClaimed: false, streak: 4, cycleDay: 4, streakReset: false });
  });

  it("chuỗi tăng đúng cả khi hôm qua là tháng trước", () => {
    // Đây là chỗ một phép `dayKey.slice(-2) - 1` sẽ vỡ, và nó vỡ đúng một ngày mỗi tháng.
    const kh = planDailyClaim({ lastClaimDay: "2026-08-31", streak: 5 }, "2026-09-01");
    expect(kh.streak).toBe(6);
    expect(kh.streakReset).toBe(false);
  });

  it("bỏ một ngày ⇒ chuỗi về 1 và báo là đã đứt", () => {
    const kh = planDailyClaim({ lastClaimDay: "2026-09-08", streak: 6 }, "2026-09-10");
    expect(kh).toMatchObject({ streak: 1, cycleDay: 1, streakReset: true });
  });

  it("người mới KHÔNG bị báo 'chuỗi đã đứt' — chưa từng có chuỗi thì không có gì để đứt", () => {
    expect(planDailyClaim({ lastClaimDay: null, streak: 0 }, "2026-09-10").streakReset).toBe(false);
  });

  it("nhận lại trong cùng ngày UTC ⇒ alreadyClaimed, chuỗi KHÔNG tăng", () => {
    const kh = planDailyClaim({ lastClaimDay: "2026-09-10", streak: 4 }, "2026-09-10");
    expect(kh).toMatchObject({ alreadyClaimed: true, streak: 4, cycleDay: 4 });
  });

  it("đồng hồ bị đẩy lùi (lastClaimDay ở tương lai) ⇒ reset chuỗi, không phát thưởng theo mốc sai", () => {
    const kh = planDailyClaim({ lastClaimDay: "2026-09-20", streak: 9 }, "2026-09-10");
    expect(kh).toMatchObject({ alreadyClaimed: false, streak: 1, streakReset: true });
  });
});

describe("vòng 7 ngày", () => {
  it("chuỗi 8 quay lại ngày 1, không tràn ra ngoài bảng cấu hình", () => {
    expect(cycleDayOf(7)).toBe(7);
    expect(cycleDayOf(8)).toBe(1);
    expect(cycleDayOf(15)).toBe(1);
    expect(cycleDayOf(14)).toBe(7);
  });

  it("mọi chuỗi từ 1 tới 100 đều rơi vào 1..7 — đây là khoá tra bảng nên không được lọt ra ngoài", () => {
    for (let s = 1; s <= 100; s++) {
      const d = cycleDayOf(s);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(DAILY_CYCLE_DAYS);
    }
  });

  it("chuỗi 0 hoặc âm vẫn cho ngày hợp lệ thay vì chỉ số âm", () => {
    // Dữ liệu hỏng không được biến thành một truy vấn tra `daily_rewards_config` với day = 0.
    expect(cycleDayOf(0)).toBe(1);
    expect(cycleDayOf(-5)).toBe(1);
  });
});
