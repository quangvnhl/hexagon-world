// doc 35 §B2 (lát b2-diem-danh-streak) — tầng HTTP của điểm danh.
//
// ┌─ THỨ BÀI NÀY GIỮ ───────────────────────────────────────────────────────────────────────────┐
// │ Phần chuỗi ngày và tính idempotent nằm trong SQL + `packages/shared/src/daily-reward.ts`,   │
// │ và đã được đo trực tiếp trên database (nhận hai lần cùng ngày ⇒ ĐÚNG MỘT dòng ledger; bỏ    │
// │ ngày ⇒ chuỗi về 1). Bài này giữ thứ SQL không giữ được:                                     │
// │                                                                                             │
// │   1. `GET daily` KHÔNG được cấp gì. Nếu ai đó gộp hai đường lại cho tiện thì mỗi lần client │
// │      mở màn hình là một lần phát coin — và client sẽ gọi lại khi quay lại tab, khi mạng      │
// │      chập chờn, khi StrictMode chạy effect hai lần.                                          │
// │   2. Cả hai đường đều đi qua `sessions.resolve`. Một endpoint cấp tiền mà quên xác thực thì  │
// │      ai cũng nhận thưởng cho bất kỳ `player_id` nào.                                         │
// └───────────────────────────────────────────────────────────────────────────────────────────┘
import { describe, expect, it } from "vitest";
import { DailyController } from "../src/daily/daily.controller";
import type { SessionService } from "../src/auth/session.service";
import type { SupabaseService } from "../src/database/supabase.service";

function dung(ketQua: unknown) {
  const goi: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => { goi.push({ fn, args }); return ketQua; },
  } as unknown as SupabaseService;
  const daGoiResolve: string[] = [];
  const sessions = {
    resolve: async () => { daGoiResolve.push("resolve"); return { id: "player-1" }; },
  } as unknown as SessionService;
  return { c: new DailyController(sessions, db), goi, daGoiResolve };
}

const req = {} as never;

describe("GET daily", () => {
  it("gọi read_daily_reward — hàm KHÔNG cấp gì", async () => {
    const { c, goi } = dung({ claimed_today: false, streak: 0 });
    await c.status(req);
    expect(goi).toHaveLength(1);
    expect(goi[0].fn).toBe("read_daily_reward");
  });

  it("KHÔNG bao giờ chạm claim_daily_reward — đọc mà cấp tiền là cái bẫy không ai nhìn thấy", async () => {
    const { c, goi } = dung({ claimed_today: false, streak: 0 });
    await c.status(req);
    await c.status(req);
    await c.status(req);
    expect(goi.map((g) => g.fn)).toEqual(["read_daily_reward", "read_daily_reward", "read_daily_reward"]);
  });

  it("xác thực trước khi đọc", async () => {
    const { c, daGoiResolve } = dung({ claimed_today: false });
    await c.status(req);
    expect(daGoiResolve).toEqual(["resolve"]);
  });
});

describe("POST daily/claim", () => {
  it("gọi claim_daily_reward với player_id lấy từ PHIÊN, không từ body", async () => {
    // Nhận player_id từ client là biến endpoint thưởng thành máy phát coin cho bất kỳ ai.
    const { c, goi } = dung({ already_claimed: false, streak: 1, coin: 50 });
    await c.claim(req);
    expect(goi[0].fn).toBe("claim_daily_reward");
    expect(goi[0].args).toEqual({ p_player_id: "player-1" });
  });

  it("xác thực trước khi cấp", async () => {
    const { c, daGoiResolve } = dung({ already_claimed: false });
    await c.claim(req);
    expect(daGoiResolve).toEqual(["resolve"]);
  });

  it("trả nguyên hình dạng của RPC, kể cả khi đã nhận rồi", async () => {
    // Client vẽ cùng một màn hình cho cả hai trường hợp, nên hai đường phải cùng hình dạng —
    // chỉ khác cờ. Bóp méo ở tầng này là bắt client phân biệt hai kiểu dữ liệu.
    const daNhan = {
      already_claimed: true, streak: 3, cycle_day: 3, coin: 100, energy: 1,
      next_reset_at: "2026-09-11T00:00:00+00:00",
    };
    const { c } = dung(daNhan);
    expect(await c.claim(req)).toEqual(daNhan);
  });

  it("KHÔNG gửi thêm tham số nào ngoài p_player_id", async () => {
    // Một `p_amount` hay `p_cycle_day` do client chọn là đường farm coin. Bảng cấu hình phía
    // server phải là nguồn duy nhất quyết định thưởng bao nhiêu.
    const { c, goi } = dung({ already_claimed: false });
    await c.claim(req);
    expect(Object.keys(goi[0].args)).toEqual(["p_player_id"]);
  });
});
