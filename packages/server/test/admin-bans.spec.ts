// doc 35 §C3 (lát c3) — đường CẤM người chơi của Ops API.
//
// File này giữ hai thứ, và cả hai đều thuộc loại "sai thì không ai thấy cho tới lúc cần":
//
//  1. **Xem trước phải kiểm ĐÚNG những gì lời gọi thật kiểm.** Một `dry_run` luôn trả "ổn" còn tệ
//     hơn không có dry_run — nó dạy người dùng tin nó, rồi lời gọi thật đỏ.
//  2. **`until` trong quá khứ phải bị TỪ CHỐI.** Một lệnh cấm hết hiệu lực ngay lúc tạo trông y hệt
//     một lệnh cấm đang chạy, trong mọi bảng và mọi log. Người trực sẽ tưởng đã xử lý xong.
import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { AdminController } from "../src/admin/admin.controller";
import type { OpsRequest } from "../src/admin/ops-auth.guard";
import type { OpsKeysService } from "../src/admin/ops-keys.service";
import type { SupabaseService } from "../src/database/supabase.service";

/** DB giả: một hàng `players`, một lệnh cấm đang hiệu lực (hoặc không), và ghi lại mọi rpc. */
function db(player: { status?: string } | null, activeBan: Record<string, unknown> | null) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const service = {
    from: (table: string) => {
      const api: Record<string, unknown> = {};
      Object.assign(api, {
        select: () => api,
        eq: () => api,
        is: () => api,
        order: () => api,
        limit: () => api,
        maybeSingle: async () => ({
          data: table === "players" ? (player ? { id: "p1", display_name: "Ai Đó", ...player } : null) : activeBan,
          error: null,
        }),
        then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({ data: activeBan ? [activeBan] : [], error: null }).then(resolve),
      });
      return api;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { ok: true }; },
  } as unknown as SupabaseService;
  return { service, calls };
}

const KEYS = {} as OpsKeysService;
const req = (dryRun = false) => ({ opsDryRun: dryRun, opsActor: { actorKind: "human", name: "nguoi-truc" } }) as unknown as OpsRequest;
const make = (player: Parameters<typeof db>[0], ban: Parameters<typeof db>[1] = null) => {
  const d = db(player, ban);
  return { c: new AdminController(d.service, KEYS), calls: d.calls };
};

describe("POST players/:id/ban", () => {
  it("thiếu reason ⇒ 400, và KHÔNG gọi RPC nào", async () => {
    // Một lệnh cấm không có lý do là một lệnh cấm không bảo vệ được khi bị khiếu nại.
    const { c, calls } = make({ status: "active" });
    await expect(c.ban(req(), "p1", {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.ban(req(), "p1", { reason: "   " })).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toHaveLength(0);
  });

  it("until trong QUÁ KHỨ ⇒ 400", async () => {
    const { c, calls } = make({ status: "active" });
    await expect(c.ban(req(), "p1", { reason: "spam", until: "2020-01-01T00:00:00Z" }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toHaveLength(0);
  });

  it("until không phải mốc thời gian ⇒ 400", async () => {
    const { c } = make({ status: "active" });
    await expect(c.ban(req(), "p1", { reason: "spam", until: "ngày mai" }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it("until vắng / null / chuỗi rỗng ⇒ cấm VĨNH VIỄN, không phải lỗi", async () => {
    // Agent hay gửi "" thay cho null. Coi đó là lỗi thì nó không cấm vĩnh viễn được bao giờ.
    for (const until of [undefined, null, ""]) {
      const { c, calls } = make({ status: "active" });
      await c.ban(req(), "p1", { reason: "spam", until });
      expect(calls[0].args.p_until, `until=${JSON.stringify(until)}`).toBeNull();
    }
  });

  it("hợp lệ ⇒ gọi ban_player kèm nhãn tác nhân", async () => {
    const { c, calls } = make({ status: "active" });
    const until = new Date(Date.now() + 86_400_000).toISOString();
    await c.ban(req(), "p1", { reason: "  quấy rối  ", until });
    expect(calls[0].fn).toBe("ban_player");
    expect(calls[0].args).toMatchObject({ p_player_id: "p1", p_reason: "quấy rối", p_actor: "human:nguoi-truc" });
    expect(calls[0].args.p_until).toBe(until);
  });

  it("dry_run KHÔNG ghi, và báo trước ca sẽ HỎNG", async () => {
    // Đây là bài đắt nhất của nhóm dry_run: `deleted` không cấm được, và người trực phải biết điều
    // đó TRƯỚC khi bấm, chứ không phải qua một lỗi 500 sau đó.
    const a = make({ status: "deleted" });
    await expect(a.c.ban(req(true), "p1", { reason: "spam" })).resolves.toMatchObject({ dryRun: true, wouldFail: "player_deleted" });
    expect(a.calls).toHaveLength(0);

    const b = make(null);
    await expect(b.c.ban(req(true), "p1", { reason: "spam" })).resolves.toMatchObject({ playerFound: false, wouldFail: "player_not_found" });

    const c = make({ status: "active" });
    await expect(c.c.ban(req(true), "p1", { reason: "spam" })).resolves.toMatchObject({ wouldFail: null, permanent: true });
  });

  it("dry_run kiểm ĐÚNG những gì lời gọi thật kiểm", async () => {
    // Nếu bài này đỏ, dry_run đang trả "ổn" cho thứ lời gọi thật sẽ từ chối.
    const { c } = make({ status: "active" });
    await expect(c.ban(req(true), "p1", { reason: "" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.ban(req(true), "p1", { reason: "spam", until: "2020-01-01T00:00:00Z" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("dry_run nói rõ sẽ THAY một lệnh cấm đang chạy", async () => {
    const { c } = make({ status: "suspended" }, { id: "b1", reason: "cũ", until: null });
    await expect(c.ban(req(true), "p1", { reason: "mới" }))
      .resolves.toMatchObject({ replacesActiveBan: { id: "b1", reason: "cũ" } });
  });
});

describe("DELETE players/:id/ban", () => {
  it("gọi unban_player kèm nhãn tác nhân", async () => {
    const { c, calls } = make({ status: "suspended" }, { id: "b1" });
    await c.unban(req(), "p1");
    expect(calls[0]).toMatchObject({ fn: "unban_player", args: { p_player_id: "p1", p_actor: "human:nguoi-truc" } });
  });

  it("dry_run phân biệt 'có gì để gỡ' với 'không có gì'", async () => {
    // Trả "ổn" cho cả hai làm agent tưởng đã gỡ, rồi bỏ qua một người vẫn đang bị cấm.
    const co = make({ status: "suspended" }, { id: "b1", reason: "spam" });
    await expect(co.c.unban(req(true), "p1")).resolves.toMatchObject({ noop: false, activeBan: { id: "b1" } });
    expect(co.calls).toHaveLength(0);

    const khong = make({ status: "active" }, null);
    await expect(khong.c.unban(req(true), "p1")).resolves.toMatchObject({ noop: true, activeBan: null });
  });
});
