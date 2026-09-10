// doc 35 §D4 (lát d4-nhip-noi-dung) — lịch phát hành cấp qua Ops API.
//
// Phần luật "cấp nào đang sống" nằm trong SQL và đã được đo TRỰC TIẾP trên database:
// hẹn c2 ra sau 2 ngày ⇒ số cấp đang sống tụt 9→8 và c2 biến mất; hẹn ở quá khứ ⇒ hiện ngay;
// gỡ publish khi đang có lịch ⇒ lịch bị XOÁ (không có cấp nào tự bật lại khi tới ngày);
// publish không kèm lịch ⇒ đúng hành vi cũ.
//
// ┌─ THỨ BÀI NÀY GIỮ ───────────────────────────────────────────────────────────────────────────┐
// │ 1. Một `publishedAt` gõ sai KHÔNG được lặng lẽ thành "ra ngay" — đó đúng là điều ngược lại   │
// │    với ý định của người đang đặt lịch, và không có gì báo cho họ biết.                       │
// │ 2. Gỡ publish luôn gửi lịch = null, kể cả khi bên gọi có truyền ngày.                        │
// │ 3. `dry_run` phải trả lời đúng câu người đặt lịch hỏi: sau lời gọi này người chơi CÓ THẤY?   │
// └───────────────────────────────────────────────────────────────────────────────────────────┘
import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { AdminController } from "../src/admin/admin.controller";
import type { OpsRequest } from "../src/admin/ops-auth.guard";
import type { OpsKeysService } from "../src/admin/ops-keys.service";
import type { SupabaseService } from "../src/database/supabase.service";

function db(hang: Record<string, unknown> | null) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const service = {
    from: () => {
      const api: Record<string, unknown> = {};
      Object.assign(api, {
        select: () => api, eq: () => api, order: () => api,
        maybeSingle: async () => ({ data: hang, error: null }),
      });
      return api;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { id: args.p_id, published: args.p_published, publishedAt: args.p_published_at, live: false };
    },
  } as unknown as SupabaseService;
  return { service, calls };
}

const KEYS = {} as OpsKeysService;
const req = (dryRun = false) => ({ opsDryRun: dryRun, opsActor: { actorKind: "human", name: "nguoi-soan" } }) as unknown as OpsRequest;
const make = (hang: Record<string, unknown> | null = { id: "c9", published: false, published_at: null, name: "Cấp 9" }) => {
  const d = db(hang);
  return { c: new AdminController(d.service, KEYS), calls: d.calls };
};

const MAI = new Date(Date.now() + 86_400_000).toISOString();

describe("đặt lịch", () => {
  it("truyền publishedAt xuống RPC nguyên vẹn", async () => {
    const { c, calls } = make();
    await c.publishLevel(req(), "c9", { published: true, publishedAt: MAI });
    expect(calls[0]).toEqual({
      fn: "publish_campaign_level",
      args: { p_id: "c9", p_published: true, p_published_at: MAI },
    });
  });

  it("không truyền publishedAt ⇒ null ⇒ hành vi cũ, ra ngay", async () => {
    const { c, calls } = make();
    await c.publishLevel(req(), "c9", { published: true });
    expect(calls[0].args.p_published_at).toBeNull();
  });

  it("publishedAt gõ sai bị chặn TRƯỚC khi chạm database", async () => {
    const { c, calls } = make();
    for (const xau of ["hôm nay", "2026-13-45", "", "15/09/2026"]) {
      await expect(c.publishLevel(req(), "c9", { published: true, publishedAt: xau }))
        .rejects.toBeInstanceOf(BadRequestException);
    }
    expect(calls).toHaveLength(0);
  });

  it("GỠ publish luôn xoá lịch, kể cả khi bên gọi vẫn truyền ngày", async () => {
    // Một cấp bị gỡ mà còn giữ ngày hẹn sẽ tự bật lại khi tới ngày — và người gỡ nó
    // sẽ không có mặt ở đó để hiểu vì sao.
    const { c, calls } = make();
    await c.publishLevel(req(), "c9", { published: false, publishedAt: MAI });
    expect(calls[0].args).toEqual({ p_id: "c9", p_published: false, p_published_at: null });
  });
});

describe("xem trước (dry_run)", () => {
  it("nói rõ sau lời gọi người chơi CÓ thấy hay không", async () => {
    const { c, calls } = make();
    const hen = await c.publishLevel(req(true), "c9", { published: true, publishedAt: MAI });
    expect(hen).toMatchObject({ dryRun: true, to: true, publishedAtTo: MAI, liveAfter: false });

    const ngay = await c.publishLevel(req(true), "c9", { published: true });
    expect(ngay).toMatchObject({ liveAfter: true, publishedAtTo: null });

    // Xem trước KHÔNG được chạm database.
    expect(calls).toHaveLength(0);
  });

  it("mốc trong QUÁ KHỨ vẫn là live ngay — đặt lịch lùi là cách publish ngay", async () => {
    const { c } = make();
    const hom_qua = new Date(Date.now() - 3_600_000).toISOString();
    expect(await c.publishLevel(req(true), "c9", { published: true, publishedAt: hom_qua }))
      .toMatchObject({ liveAfter: true });
  });

  it("đổi NGÀY HẸN của một cấp đã publish KHÔNG phải là noop", async () => {
    // `noop` chỉ xét cờ `published` thì agent sẽ bỏ qua một lời gọi thực sự đổi ngày ra mắt.
    const { c } = make({ id: "c9", published: true, published_at: MAI, name: "Cấp 9" });
    const doiNgay = new Date(Date.now() + 3 * 86_400_000).toISOString();
    expect(await c.publishLevel(req(true), "c9", { published: true, publishedAt: doiNgay }))
      .toMatchObject({ noop: false, publishedAtFrom: MAI, publishedAtTo: doiNgay });

    // Còn gọi lại y hệt thì đúng là không đổi gì.
    expect(await c.publishLevel(req(true), "c9", { published: true, publishedAt: MAI }))
      .toMatchObject({ noop: true });
  });
});
