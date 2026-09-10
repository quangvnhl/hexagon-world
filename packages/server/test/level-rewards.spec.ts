// doc 35 §B4 (lát b4-thuong-theo-cap) — tầng HTTP của thưởng theo cấp.
//
// Phần chọn mốc, gộp nhiều cấp và tính idempotent nằm trong SQL và đã được đo trực tiếp trên
// database: người cấp 7 nhận gộp [2,3,4,5] = 550 coin trong ĐÚNG MỘT dòng ledger; gọi lại trả
// mảng rỗng; lên cấp 10 thì chỉ mốc 10 là mới.
//
// Bài này giữ thứ SQL không giữ được: client KHÔNG được nói mình đang ở cấp nào, và cũng không
// được chọn mốc nào để nhận.
import { describe, expect, it } from "vitest";
import { LevelRewardsController } from "../src/progression/level-rewards.controller";
import type { SessionService } from "../src/auth/session.service";
import type { SupabaseService } from "../src/database/supabase.service";

function dung(ketQua: unknown) {
  const goi: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => { goi.push({ fn, args }); return ketQua; },
  } as unknown as SupabaseService;
  const daResolve: string[] = [];
  const sessions = {
    resolve: async () => { daResolve.push("resolve"); return { id: "player-1" }; },
  } as unknown as SessionService;
  return { c: new LevelRewardsController(sessions, db), goi, daResolve };
}

const req = {} as never;

describe("GET level-rewards", () => {
  it("đọc bằng read_level_rewards — hàm không cấp gì", async () => {
    const { c, goi } = dung({ level: 7, pending: [] });
    await c.status(req);
    expect(goi).toEqual([{ fn: "read_level_rewards", args: { p_player_id: "player-1" } }]);
  });

  it("gọi nhiều lần vẫn chỉ chạm đường ĐỌC", async () => {
    const { c, goi } = dung({ level: 7, pending: [] });
    await c.status(req); await c.status(req);
    expect(new Set(goi.map((g) => g.fn))).toEqual(new Set(["read_level_rewards"]));
  });
});

describe("POST level-rewards/claim", () => {
  it("KHÔNG gửi level — server tự đọc cấp, client không chọn mốc", async () => {
    // Đây là bất biến đắt nhất của lát này. Một tham số `p_level` do client chọn biến bảng mốc
    // thành thực đơn tự phục vụ.
    const { c, goi } = dung({ claimed_levels: [2, 3], coin: 200, energy: 0, level: 7 });
    await c.claim(req);
    expect(goi[0].fn).toBe("claim_level_rewards");
    expect(Object.keys(goi[0].args)).toEqual(["p_player_id"]);
    expect(goi[0].args.p_player_id).toBe("player-1");
  });

  it("xác thực trước khi cấp", async () => {
    const { c, daResolve } = dung({ claimed_levels: [], coin: 0 });
    await c.claim(req);
    expect(daResolve).toEqual(["resolve"]);
  });

  it("không còn mốc nào ⇒ mảng rỗng, KHÔNG phải lỗi", async () => {
    // Client gọi lại sau khi đã nhận hết là chuyện bình thường (bấm hai lần, mạng chậm).
    // Ném lỗi ở đây sẽ hiện một thông báo đỏ cho một hành động hoàn toàn đúng.
    const rong = { claimed_levels: [], coin: 0, energy: 0, level: 7 };
    const { c } = dung(rong);
    expect(await c.claim(req)).toEqual(rong);
  });

  it("trả nguyên hình dạng RPC, kể cả danh sách nhiều cấp", async () => {
    const nhieu = { claimed_levels: [2, 3, 4, 5], coin: 550, energy: 1, level: 7 };
    const { c } = dung(nhieu);
    expect(await c.claim(req)).toEqual(nhieu);
  });
});
