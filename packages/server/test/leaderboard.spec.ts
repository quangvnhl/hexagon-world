// doc 35 §A5 (lát a5-leaderboard) — tầng HTTP của bảng xếp hạng.
//
// Phần cộng điểm, khoá kỳ và lệnh cấm nằm trong SQL và đã được đo TRỰC TIẾP trên database:
// hai trận cộng 40+5 và 12+30 ô, mỗi người thắng một trận ⇒ weekly_wins = 1/1; một người khách
// chiếm 77 ô KHÔNG để lại dòng nào; cấm một người thì họ rơi khỏi bảng ngay ở lần đọc kế tiếp;
// và 300 người cùng điểm ⇒ xin 5 dòng trả về đúng 5 (hạng hiển thị vẫn là hạng hoà thật).
//
// ┌─ THỨ BÀI NÀY GIỮ ───────────────────────────────────────────────────────────────────────────┐
// │ 1. Bề mặt HTTP CHỈ có ĐỌC. Một `POST` báo điểm là mở lại lỗ hổng A3 vừa bịt.                 │
// │ 2. `playerId` KHÔNG ĐƯỢC rời server — bảng này xem được khi chưa đăng nhập.                  │
// │ 3. `scope` sai bị chặn TRƯỚC khi chạm database, để lỗi gọi sai không giả dạng "bảng rỗng".   │
// └───────────────────────────────────────────────────────────────────────────────────────────┘
import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { LeaderboardController } from "../src/leaderboard/leaderboard.controller";
import type { SessionService } from "../src/auth/session.service";
import type { SupabaseService } from "../src/database/supabase.service";

const HANG_THO = {
  scope: "weekly_territory",
  periodKey: "2026-W37",
  top: [
    { rank: 1, playerId: "p-9", displayName: "Chín", score: 99 },
    { rank: 2, playerId: "player-1", displayName: "Tôi", score: 40 },
  ],
  me: { rank: 2, score: 40 },
};

function dung(ketQua: unknown, coPhien = true) {
  const goi: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => { goi.push({ fn, args }); return ketQua; },
  } as unknown as SupabaseService;
  const sessions = {
    resolve: async () => {
      if (!coPhien) throw new Error("no_session");
      return { id: "player-1" };
    },
  } as unknown as SessionService;
  return { c: new LeaderboardController(sessions, db), goi };
}

const req = {} as never;

describe("bề mặt HTTP", () => {
  it("controller CHỈ phơi ra đọc — không có đường báo điểm", () => {
    const ten = Object.getOwnPropertyNames(LeaderboardController.prototype)
      .filter((n) => n !== "constructor")
      .sort();
    expect(ten).toEqual(["read"]);
  });
});

describe("kiểm tham số", () => {
  it("scope sai bị chặn TRƯỚC khi chạm database", async () => {
    const { c, goi } = dung(HANG_THO);
    await expect(c.read(req, "weekly_territor")).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.read(req, undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(goi).toHaveLength(0);
  });

  it("limit ngoài 1..100 hoặc không phải số nguyên bị chặn", async () => {
    const { c, goi } = dung(HANG_THO);
    for (const xau of ["0", "101", "-3", "abc", "2.5"]) {
      await expect(c.read(req, "weekly_wins", xau)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(goi).toHaveLength(0);
  });

  it("không truyền limit thì mặc định 20", async () => {
    const { c, goi } = dung(HANG_THO);
    await c.read(req, "weekly_territory");
    expect(goi[0]).toEqual({
      fn: "read_leaderboard",
      args: { p_scope: "weekly_territory", p_limit: 20, p_player_id: "player-1" },
    });
  });
});

describe("kết quả trả ra", () => {
  it("KHÔNG để `playerId` rời server, và đánh dấu dòng của mình bằng isMe", async () => {
    const { c } = dung(HANG_THO);
    const kq = await c.read(req, "weekly_territory");
    expect(kq.top).toEqual([
      { rank: 1, displayName: "Chín", score: 99, isMe: false },
      { rank: 2, displayName: "Tôi", score: 40, isMe: true },
    ]);
    // Khẳng định thẳng vào chuỗi JSON: không uuid nào lọt ra dưới bất kỳ tên khoá nào.
    expect(JSON.stringify(kq)).not.toContain("player-1");
    expect(JSON.stringify(kq)).not.toContain("p-9");
  });

  it("chưa đăng nhập vẫn XEM được bảng, chỉ là không có dòng nào là mình", async () => {
    // "Guest không lên bảng" nói về việc CÓ MẶT trên bảng, không phải về việc được xem.
    const { c, goi } = dung({ ...HANG_THO, me: null }, false);
    const kq = await c.read(req, "weekly_territory");
    expect(goi[0].args.p_player_id).toBeNull();
    expect(kq.me).toBeNull();
    expect(kq.top.every((r) => r.isMe === false)).toBe(true);
    expect(kq.top).toHaveLength(2);
  });

  it("hạng của mình được giữ nguyên kể cả khi nằm NGOÀI top N", async () => {
    // Người hạng 5000 phải thấy 5000, không phải thấy 'không có hạng' — nếu không thì
    // bảng xếp hạng chỉ có ý nghĩa với đúng những người đã đứng đầu.
    const ngoaiTop = {
      scope: "weekly_wins", periodKey: "2026-W37",
      top: [{ rank: 1, playerId: "p-9", displayName: "Chín", score: 99 }],
      me: { rank: 5000, score: 1 },
    };
    const { c } = dung(ngoaiTop);
    expect((await c.read(req, "weekly_wins", "1")).me).toEqual({ rank: 5000, score: 1 });
  });

  it("RPC trả null thì ra bảng rỗng, không để client vỡ vì undefined", async () => {
    const { c } = dung(null);
    expect(await c.read(req, "campaign_stars_total")).toEqual({
      scope: "campaign_stars_total", periodKey: "", top: [], me: null,
    });
  });

  it("nhận cả ba scope của doc 35 §A5", async () => {
    for (const s of ["weekly_territory", "weekly_wins", "campaign_stars_total"]) {
      const { c, goi } = dung(HANG_THO);
      await c.read(req, s);
      expect(goi[0].args.p_scope).toBe(s);
    }
  });
});
