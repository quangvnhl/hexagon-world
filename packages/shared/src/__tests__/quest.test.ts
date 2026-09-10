// doc 35 §B3 — khoá chu kỳ nhiệm vụ.
//
// Thứ đáng giữ ở đây là TUẦN ISO quanh giao thừa. Năm ISO khác năm dương lịch ở vài ngày cuối/đầu
// năm, và một phép `getUTCFullYear()` trần sẽ sai đúng vào tuần đó — tức là sai vào đúng dịp mà
// người chơi hay chơi nhất, và sai theo kiểu "tiến độ rơi vào chu kỳ khác" mà không có gì đỏ lên.
//
// Các mốc dưới đây đối chiếu với lịch ISO 8601 chuẩn; bản dựng còn được đối chiếu TRỰC TIẾP với
// `to_char(..., 'IYYY-"W"IW')` của Postgres trong lúc làm lát này.
import { describe, expect, it } from "vitest";
import { msToPeriodEnd, questCompleted, questPeriodKey, utcIsoWeekKey } from "../quest";

const luc = (iso: string) => Date.parse(iso);

describe("khoá tuần ISO", () => {
  it("tuần thường trong năm", () => {
    expect(utcIsoWeekKey(luc("2026-09-10T00:00:00Z"))).toBe("2026-W37");
    expect(utcIsoWeekKey(luc("2026-01-15T12:00:00Z"))).toBe("2026-W03");
  });

  it("thứ Hai và Chủ nhật của CÙNG một tuần cho cùng một khoá", () => {
    // 2026-09-07 là thứ Hai, 2026-09-13 là Chủ nhật.
    expect(utcIsoWeekKey(luc("2026-09-07T00:00:00Z"))).toBe("2026-W37");
    expect(utcIsoWeekKey(luc("2026-09-13T23:59:59Z"))).toBe("2026-W37");
    // Ngày kế tiếp đã sang tuần mới.
    expect(utcIsoWeekKey(luc("2026-09-14T00:00:00Z"))).toBe("2026-W38");
  });

  it("giao thừa: ngày đầu năm dương lịch có thể thuộc năm ISO TRƯỚC", () => {
    // 2027-01-01 là thứ Sáu ⇒ vẫn thuộc tuần 53 của năm ISO 2026.
    expect(utcIsoWeekKey(luc("2027-01-01T00:00:00Z"))).toBe("2026-W53");
    expect(utcIsoWeekKey(luc("2026-12-31T00:00:00Z"))).toBe("2026-W53");
  });

  it("giao thừa: ngày cuối năm dương lịch có thể thuộc năm ISO SAU", () => {
    // 2024-12-30 là thứ Hai ⇒ thuộc tuần 1 của năm ISO 2025.
    expect(utcIsoWeekKey(luc("2024-12-30T00:00:00Z"))).toBe("2025-W01");
  });

  it("năm có 53 tuần được đánh số tới W53, không tràn sang W01", () => {
    expect(utcIsoWeekKey(luc("2026-12-28T00:00:00Z"))).toBe("2026-W53");
  });

  it("khoá luôn đúng định dạng IYYY-Www với hai chữ số tuần", () => {
    for (let i = 0; i < 400; i++) {
      const k = utcIsoWeekKey(luc("2026-01-01T00:00:00Z") + i * 86_400_000);
      expect(k).toMatch(/^\d{4}-W\d{2}$/);
    }
  });
});

describe("khoá chu kỳ theo loại", () => {
  it("daily dùng ngày UTC, weekly dùng tuần ISO", () => {
    const t = luc("2026-09-10T23:30:00Z");
    expect(questPeriodKey("daily", t)).toBe("2026-09-10");
    expect(questPeriodKey("weekly", t)).toBe("2026-W37");
  });
});

describe("đếm ngược tới cuối chu kỳ", () => {
  it("daily về 0 tại nửa đêm UTC", () => {
    expect(msToPeriodEnd("daily", luc("2026-09-10T23:59:59Z"))).toBe(1000);
    expect(msToPeriodEnd("daily", luc("2026-09-10T00:00:00Z"))).toBe(86_400_000);
  });

  it("weekly kết thúc cuối Chủ nhật UTC", () => {
    // Chủ nhật 2026-09-13 lúc 23:59:59 ⇒ còn đúng 1 giây.
    expect(msToPeriodEnd("weekly", luc("2026-09-13T23:59:59Z"))).toBe(1000);
    // Thứ Hai 2026-09-07 lúc 00:00 ⇒ còn trọn 7 ngày.
    expect(msToPeriodEnd("weekly", luc("2026-09-07T00:00:00Z"))).toBe(7 * 86_400_000);
  });

  it("weekly luôn dài hơn hoặc bằng daily — nếu ngược lại thì một trong hai sai dấu", () => {
    for (let i = 0; i < 14; i++) {
      const t = luc("2026-09-07T05:00:00Z") + i * 86_400_000;
      expect(msToPeriodEnd("weekly", t)).toBeGreaterThanOrEqual(msToPeriodEnd("daily", t));
    }
  });
});

describe("đạt mục tiêu", () => {
  it("vượt cũng tính là đạt — tiến độ có thể nhảy nhiều bậc trong một trận", () => {
    // `territory_capture` cộng theo số ô chiếm được, nên nó nhảy chứ không tăng từng 1.
    expect(questCompleted(0, 3)).toBe(false);
    expect(questCompleted(2, 3)).toBe(false);
    expect(questCompleted(3, 3)).toBe(true);
    expect(questCompleted(57, 3)).toBe(true);
  });
});
