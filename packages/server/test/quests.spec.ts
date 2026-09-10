// doc 35 §B3 (lát b3-nhiem-vu) — tầng HTTP của nhiệm vụ.
//
// Phần chu kỳ, cộng dồn và idempotent nằm trong SQL và đã được đo trực tiếp trên database:
// 3 trận cộng cả `daily_play_3` (3/3) lẫn `weekly_play_20` (3/20); nhận rồi thì `already_claimed`;
// ledger đúng một dòng `daily_play_3:2026-09-10`; `bump` với số 0 hoặc âm không tạo hàng rác.
//
// ┌─ THỨ BÀI NÀY GIỮ ───────────────────────────────────────────────────────────────────────────┐
// │ Bề mặt HTTP CHỈ có đọc và nhận. Không có đường nào cho client báo tiến độ — thêm một         │
// │ `POST quests/progress` là mở lại đúng lỗ hổng mà A3 vừa bịt.                                 │
// │ Và: "chưa đủ tiến độ" / "đã nhận rồi" là kết quả NGHIỆP VỤ, không phải lỗi HTTP.             │
// └───────────────────────────────────────────────────────────────────────────────────────────┘
import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { QuestsController } from "../src/quests/quests.controller";
import type { SessionService } from "../src/auth/session.service";
import type { SupabaseService } from "../src/database/supabase.service";

function dung(ketQua: unknown) {
  const goi: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => { goi.push({ fn, args }); return ketQua; },
  } as unknown as SupabaseService;
  const sessions = { resolve: async () => ({ id: "player-1" }) } as unknown as SessionService;
  return { c: new QuestsController(sessions, db), goi };
}

const req = {} as never;

describe("bề mặt HTTP", () => {
  it("controller CHỈ phơi ra đọc và nhận — không có đường báo tiến độ", () => {
    // Nếu ai đó thêm một phương thức nhận tiến độ từ client, bài này đỏ và buộc phải giải thích.
    const ten = Object.getOwnPropertyNames(QuestsController.prototype)
      .filter((n) => n !== "constructor")
      .sort();
    expect(ten).toEqual(["claim", "list"]);
  });
});

describe("GET quests", () => {
  it("trả mảng rỗng khi RPC trả null, không để client vỡ vì undefined", async () => {
    const { c } = dung(null);
    expect(await c.list(req)).toEqual({ quests: [] });
  });

  it("bọc kết quả trong { quests }", async () => {
    const hang = [{ id: "daily_play_3", progress: 3, completed: true }];
    const { c, goi } = dung(hang);
    expect(await c.list(req)).toEqual({ quests: hang });
    expect(goi[0].fn).toBe("read_quests");
  });
});

describe("POST quests/:id/claim", () => {
  it("truyền đúng player_id của phiên và quest id của URL", async () => {
    const { c, goi } = dung({ ok: true, coin: 60 });
    await c.claim(req, "daily_play_3");
    expect(goi[0]).toEqual({
      fn: "claim_quest_reward",
      args: { p_player_id: "player-1", p_quest_id: "daily_play_3" },
    });
  });

  it("id rỗng bị chặn TRƯỚC khi chạm database", async () => {
    const { c, goi } = dung({ ok: false });
    await expect(c.claim(req, "  ")).rejects.toBeInstanceOf(BadRequestException);
    expect(goi).toHaveLength(0);
  });

  it("chưa đủ tiến độ trả ok:false, KHÔNG ném lỗi", async () => {
    // Người chơi bấm sớm là chuyện thường. Một màn hình lỗi đỏ cho hành động hợp lệ làm mất tin.
    const kq = { ok: false, reason: "not_completed", progress: 1, goal_value: 3 };
    const { c } = dung(kq);
    expect(await c.claim(req, "daily_play_3")).toEqual(kq);
  });

  it("đã nhận rồi cũng trả ok:false, không ném lỗi", async () => {
    const kq = { ok: false, reason: "already_claimed", progress: 3, goal_value: 3 };
    const { c } = dung(kq);
    expect(await c.claim(req, "daily_play_3")).toEqual(kq);
  });

  it("KHÔNG nhận số tiền hay tiến độ từ lời gọi — chỉ id", async () => {
    const { c, goi } = dung({ ok: true });
    await c.claim(req, "weekly_win_3");
    expect(Object.keys(goi[0].args).sort()).toEqual(["p_player_id", "p_quest_id"]);
  });
});
