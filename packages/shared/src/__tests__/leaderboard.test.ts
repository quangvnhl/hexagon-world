// doc 35 §A5 — danh sách scope và kỳ của bảng xếp hạng.
//
// Bài đáng giữ ở đây là RÀNG BUỘC VỚI SQL: `leaderboardPeriod` phải nói cùng một điều với
// `leaderboard_period_key` trong migration (`scope like 'weekly\_%'`). Hai bên lệch nhau thì bảng
// tuần sẽ đếm ngược tới một mốc, còn điểm lại rơi vào một kỳ khác — và không có gì đỏ lên.
import { describe, expect, it } from "vitest";
import {
  LEADERBOARD_SCOPES,
  isLeaderboardScope,
  leaderboardPeriod,
  msToPeriodEnd,
  type LeaderboardScope,
} from "../index";

describe("danh sách scope", () => {
  it("đúng ba scope khởi điểm của doc 35 §A5", () => {
    expect([...LEADERBOARD_SCOPES]).toEqual([
      "weekly_territory",
      "weekly_wins",
      "campaign_stars_total",
    ]);
  });

  it("nhận đúng tên trong danh sách, từ chối mọi thứ khác", () => {
    for (const s of LEADERBOARD_SCOPES) expect(isLeaderboardScope(s)).toBe(true);
    // `weekly_` là tiền tố của scope thật — một tham số gõ thiếu KHÔNG được lọt qua.
    for (const x of ["weekly_", "weekly_territor", "WEEKLY_WINS", "", null, 7, {}])
      expect(isLeaderboardScope(x)).toBe(false);
  });
});

describe("kỳ của scope", () => {
  it("mọi scope `weekly_` là kỳ tuần, còn lại là 'all'", () => {
    expect(leaderboardPeriod("weekly_territory")).toBe("weekly");
    expect(leaderboardPeriod("weekly_wins")).toBe("weekly");
    expect(leaderboardPeriod("campaign_stars_total")).toBe("all");
  });

  it("mọi scope trong danh sách đều có kỳ hợp lệ — không sót cái nào", () => {
    // Thêm một scope mới mà quên phân loại kỳ thì bài này đỏ, thay vì client lặng lẽ
    // hiển thị một đồng hồ đếm ngược sai.
    for (const s of LEADERBOARD_SCOPES) {
      expect(["weekly", "all"]).toContain(leaderboardPeriod(s));
    }
  });

  it("bảng tuần đếm ngược bằng CHÍNH hàm mà nhiệm vụ tuần dùng", () => {
    const t = Date.parse("2026-09-10T05:00:00Z");
    const ky = leaderboardPeriod("weekly_territory");
    expect(ky).toBe("weekly");
    expect(msToPeriodEnd("weekly", t)).toBeGreaterThan(0);
  });

  it("quy tắc tiền tố khớp với `scope like 'weekly\_%'` của SQL", () => {
    // SQL dùng `\_` (gạch dưới có thoát) nên `weeklyX...` KHÔNG khớp. TS phải nói cùng điều đó.
    const giaDinh = "weeklyXterritory" as LeaderboardScope;
    expect(leaderboardPeriod(giaDinh)).toBe("all");
  });
});
