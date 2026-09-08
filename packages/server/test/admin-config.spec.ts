// doc 35 §A2 (lát a2.3) — đường GHI cấu hình từ xa cho trang admin.
//
// File này kiểm đúng một thứ mà không có nó thì cả trang admin trở nên nguy hiểm hơn SQL Editor:
// **khoá lạc quan theo `version`**.
//
// Hai người cùng mở trang trong một sự cố là chuyện thường. "Ai ghi sau thắng" làm mất một thay
// đổi kill-switch mà không ai truy ra được — người bấm thấy nút xanh, giá trị thì là của người
// kia. Cột `version` có từ lát a2.1 với đúng ghi chú "để trang admin phát hiện ghi đè lẫn nhau";
// đây là chỗ nó được dùng, và đây là bài giữ nó.
import { describe, expect, it } from "vitest";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { AdminController } from "../src/admin/admin.controller";
import type { OpsRequest } from "../src/admin/ops-auth.guard";
import type { OpsKeysService } from "../src/admin/ops-keys.service";
import type { SupabaseService } from "../src/database/supabase.service";

/** DB giả: một hàng `remote_config` duy nhất, ghi lại mọi upsert. */
function db(current: { value?: unknown; audience?: unknown; version?: number } | null) {
  const upserts: Record<string, unknown>[] = [];
  const service = {
    from: () => {
      const api: Record<string, unknown> = {};
      Object.assign(api, {
        select: () => api,
        eq: () => api,
        order: () => api,
        limit: () => api,
        maybeSingle: async () => ({ data: current, error: null }),
        upsert: (patch: Record<string, unknown>) => {
          upserts.push(patch);
          return Promise.resolve({ data: [patch], error: null });
        },
        then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      });
      return api;
    },
  } as unknown as SupabaseService;
  return { service, upserts };
}

const KEYS = {} as OpsKeysService;
const req = (dryRun = false) => ({ opsDryRun: dryRun, opsActor: { name: "nguoi-truc" } }) as unknown as OpsRequest;

const controller = (current: Parameters<typeof db>[0]) => {
  const d = db(current);
  return { c: new AdminController(d.service, KEYS), upserts: d.upserts };
};

describe("PUT config/:key — khoá lạc quan", () => {
  it("version khớp ⇒ ghi, và version tăng đúng 1", async () => {
    const { c, upserts } = controller({ value: 1, audience: null, version: 3 });
    const res = await c.setConfig(req(), "ftue.bot_count", { value: 2, version: 3 });
    expect(res).toMatchObject({ ok: true, version: 4 });
    expect(upserts[0]).toMatchObject({ key: "ftue.bot_count", version: 4, updated_by: "nguoi-truc" });
  });

  it("version LỆCH ⇒ 409, và KHÔNG ghi gì", async () => {
    // Đây là bài đắt nhất trong file. Nếu nó đỏ, một thay đổi kill-switch có thể biến mất im lặng.
    const { c, upserts } = controller({ value: 1, audience: null, version: 5 });
    await expect(c.setConfig(req(), "k", { value: 2, version: 3 })).rejects.toBeInstanceOf(ConflictException);
    expect(upserts).toHaveLength(0);
  });

  it("khoá CHƯA có ⇒ đòi version 0, để tạo mới là hành động cố ý", async () => {
    const a = controller(null);
    await expect(a.c.setConfig(req(), "k.moi", { value: 1, version: 1 })).rejects.toBeInstanceOf(ConflictException);

    const b = controller(null);
    await expect(b.c.setConfig(req(), "k.moi", { value: 1, version: 0 })).resolves.toMatchObject({ version: 1 });
  });

  it("thiếu `value` ⇒ 400 — `undefined` không được lặng lẽ thành null", async () => {
    const { c } = controller({ version: 1 });
    await expect(c.setConfig(req(), "k", { version: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("khoá rỗng hoặc quá dài ⇒ 400", async () => {
    const { c } = controller(null);
    await expect(c.setConfig(req(), "", { value: 1, version: 0 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.setConfig(req(), "x".repeat(129), { value: 1, version: 0 })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("PUT config/:key?dry_run=true — xem trước KHÔNG ghi", () => {
  it("trả giá trị hiện tại và không upsert", async () => {
    const { c, upserts } = controller({ value: 7, audience: null, version: 2 });
    const out = await c.setConfig(req(true), "ftue.bot_count", { value: 9, version: 2 });
    expect(out).toMatchObject({ dryRun: true, exists: true, currentVersion: 2, currentValue: 7, nextValue: 9 });
    expect(upserts).toHaveLength(0);
  });

  it("nói rõ khoá có nằm trong REMOTE_CONFIG_DEFAULTS không", async () => {
    // Khoá lạ KHÔNG bị chặn — thêm cấu hình trước khi phát hành client dùng nó là việc hợp lệ.
    // Nhưng gõ nhầm tên khoá thì im lặng và không bao giờ có tác dụng gì, nên phải nói ra.
    const known = await controller(null).c.setConfig(req(true), "ftue.bot_count", { value: 1, version: 0 });
    const typo = await controller(null).c.setConfig(req(true), "ftue.bot_cout", { value: 1, version: 0 });
    expect(known).toMatchObject({ knownKey: true });
    expect(typo).toMatchObject({ knownKey: false });
  });

  it("xem trước KHÔNG kiểm version — người ta xem trước để BIẾT version hiện tại", async () => {
    const { c, upserts } = controller({ value: 1, audience: null, version: 9 });
    await expect(c.setConfig(req(true), "k", { value: 2, version: 1 })).resolves.toMatchObject({ currentVersion: 9 });
    expect(upserts).toHaveLength(0);
  });
});
