import { describe, it, expect, vi } from "vitest";
import { REMOTE_CONFIG_DEFAULTS } from "@hexagon/shared";
import { CONFIG_CACHE_KEY, CONFIG_TTL_MS, createRemoteConfig } from "../remoteConfig";

// doc 35 §A2 — client đọc remote config. Ba tình huống được bảo vệ ở đây đều là "mạng không như ý":
// lần đầu không mạng, mở lại không mạng, và có mạng nhưng cấu hình không đổi.

function memStorage(seed: Record<string, string> = {}, broken = false) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => { if (broken) throw new Error("blocked"); return map.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (broken) throw new Error("blocked"); map.set(k, v); },
    removeItem: (k: string) => { if (broken) throw new Error("blocked"); map.delete(k); },
  };
}

/** Đồng hồ giả để test hạn 5 phút mà không phải chờ thật. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

const BASE = { platform: "telegram" as const, buildId: "b1", anonId: "a-1" };

describe("Fallback khi chưa có gì", () => {
  it("lần đầu mở app, KHÔNG mạng ⇒ vẫn đủ khoá, dùng mặc định của shared", async () => {
    const c = createRemoteConfig({ ...BASE, storage: null, fetchConfig: async () => null });
    expect(c.all()).toEqual(REMOTE_CONFIG_DEFAULTS);
    await c.refresh();
    expect(c.all()).toEqual(REMOTE_CONFIG_DEFAULTS);
    expect(c.get("ads.enabled")).toBe(true);
  });

  it("localStorage bị chặn (chế độ riêng tư) ⇒ không ném, vẫn chạy", async () => {
    const c = createRemoteConfig({ ...BASE, storage: memStorage({}, true), fetchConfig: async () => ({ config: { "ads.enabled": false }, etag: '"e1"' }) });
    await c.refresh();
    expect(c.get("ads.enabled")).toBe(false);
  });

  it("bản đệm HỎNG (JSON rác) ⇒ bỏ qua, dùng mặc định", () => {
    const c = createRemoteConfig({ ...BASE, storage: memStorage({ [CONFIG_CACHE_KEY]: "{{{" }), fetchConfig: async () => null });
    expect(c.all()).toEqual(REMOTE_CONFIG_DEFAULTS);
  });
});

describe("Dùng lại bản đã tải", () => {
  it("mở lại app, KHÔNG mạng ⇒ dùng bản đệm chứ không lùi về mặc định", async () => {
    const storage = memStorage({
      [CONFIG_CACHE_KEY]: JSON.stringify({ config: { ...REMOTE_CONFIG_DEFAULTS, "ads.enabled": false }, etag: '"e1"', at: 1 }),
    });
    const c = createRemoteConfig({ ...BASE, storage, fetchConfig: async () => null });
    expect(c.get("ads.enabled")).toBe(false);
    await c.refresh();
    expect(c.get("ads.enabled")).toBe(false);
  });

  it("bản đệm từ app CŨ (thiếu khoá mới, thừa khoá đã bỏ) ⇒ ép về hình dạng hiện tại", () => {
    const storage = memStorage({
      [CONFIG_CACHE_KEY]: JSON.stringify({ config: { "ads.enabled": false, "khoa.da.bo": 1 }, etag: null, at: 1 }),
    });
    const c = createRemoteConfig({ ...BASE, storage, fetchConfig: async () => null });
    const all = c.all() as Record<string, unknown>;
    expect(all["ads.enabled"]).toBe(false);
    expect(all["khoa.da.bo"]).toBeUndefined();
    // Khoá không có trong bản đệm vẫn phải có mặt, lấy từ mặc định.
    expect(all["stars.enabled"]).toBe(REMOTE_CONFIG_DEFAULTS["stars.enabled"]);
  });

  it("giá trị SAI KIỂU trong bản đệm ⇒ dùng mặc định (luật của shared, không lặp lại ở client)", () => {
    const storage = memStorage({
      [CONFIG_CACHE_KEY]: JSON.stringify({ config: { "ads.rewarded_daily_cap": "năm" }, etag: null, at: 1 }),
    });
    const c = createRemoteConfig({ ...BASE, storage, fetchConfig: async () => null });
    expect(c.get("ads.rewarded_daily_cap")).toBe(REMOTE_CONFIG_DEFAULTS["ads.rewarded_daily_cap"]);
  });
});

describe("Hạn 5 phút và ETag", () => {
  it("trong hạn ⇒ KHÔNG gọi mạng lần nữa; quá hạn ⇒ gọi lại", async () => {
    const t = clock();
    const fetchConfig = vi.fn(async () => ({ config: { "ads.enabled": false }, etag: '"e1"' }));
    const c = createRemoteConfig({ ...BASE, storage: memStorage(), now: t.now, fetchConfig });

    await c.refresh();
    expect(fetchConfig).toHaveBeenCalledTimes(1);

    t.advance(CONFIG_TTL_MS - 1);
    await c.refresh();
    expect(fetchConfig).toHaveBeenCalledTimes(1);

    t.advance(2);
    await c.refresh();
    expect(fetchConfig).toHaveBeenCalledTimes(2);
  });

  it("force ⇒ gọi lại ngay dù còn hạn", async () => {
    const fetchConfig = vi.fn(async () => ({ config: {}, etag: '"e1"' }));
    const c = createRemoteConfig({ ...BASE, storage: memStorage(), fetchConfig });
    await c.refresh();
    await c.refresh(true);
    expect(fetchConfig).toHaveBeenCalledTimes(2);
  });

  it("gửi kèm ETag của lần trước để server trả 304 được", async () => {
    const seen: (string | null)[] = [];
    const fetchConfig = vi.fn(async (etag: string | null) => {
      seen.push(etag);
      return { config: { "ads.enabled": false }, etag: '"e1"' };
    });
    const c = createRemoteConfig({ ...BASE, storage: memStorage(), fetchConfig });
    await c.refresh();
    await c.refresh(true);
    expect(seen).toEqual([null, '"e1"']);
  });

  it("304 ⇒ giữ nguyên giá trị đang có và dời hạn (không gọi dồn dập)", async () => {
    const t = clock();
    const fetchConfig = vi.fn(async (etag: string | null) => (etag ? null : { config: { "ads.enabled": false }, etag: '"e1"' }));
    const c = createRemoteConfig({ ...BASE, storage: memStorage(), now: t.now, fetchConfig });

    await c.refresh();
    expect(c.get("ads.enabled")).toBe(false);

    t.advance(CONFIG_TTL_MS + 1);
    await c.refresh();
    expect(c.get("ads.enabled")).toBe(false);
    expect(fetchConfig).toHaveBeenCalledTimes(2);

    // Sau 304, hạn phải được dời — không gọi thêm lần nữa ngay lập tức.
    await c.refresh();
    expect(fetchConfig).toHaveBeenCalledTimes(2);
  });

  it("mạng hỏng KHÔNG xoá bản đang dùng", async () => {
    const t = clock();
    let fail = false;
    const c = createRemoteConfig({
      ...BASE,
      storage: memStorage(),
      now: t.now,
      fetchConfig: async () => (fail ? null : { config: { "ads.enabled": false }, etag: '"e1"' }),
    });
    await c.refresh();
    fail = true;
    t.advance(CONFIG_TTL_MS + 1);
    await c.refresh();
    expect(c.get("ads.enabled")).toBe(false);
  });
});

describe("Gộp lời gọi song song", () => {
  it("nhiều màn hình cùng hỏi lúc khởi động ⇒ chỉ MỘT lượt gọi mạng", async () => {
    let resolveFetch: ((v: { config: unknown; etag: string | null } | null) => void) | null = null;
    const fetchConfig = vi.fn(() => new Promise<{ config: unknown; etag: string | null } | null>((r) => { resolveFetch = r; }));
    const c = createRemoteConfig({ ...BASE, storage: memStorage(), fetchConfig });

    const all = Promise.all([c.refresh(), c.refresh(), c.refresh()]);
    expect(fetchConfig).toHaveBeenCalledTimes(1);
    resolveFetch!({ config: { "ads.enabled": false }, etag: '"e1"' });
    await all;
    expect(c.get("ads.enabled")).toBe(false);
  });
});

describe("Ghi bản đệm", () => {
  it("tải xong ⇒ ghi cả giá trị lẫn etag để lần mở sau dùng được ngay", async () => {
    const storage = memStorage();
    const c = createRemoteConfig({ ...BASE, storage, fetchConfig: async () => ({ config: { "ads.enabled": false }, etag: '"e9"' }) });
    await c.refresh();
    const saved = JSON.parse(storage.map.get(CONFIG_CACHE_KEY)!) as { config: Record<string, unknown>; etag: string };
    expect(saved.config["ads.enabled"]).toBe(false);
    expect(saved.etag).toBe('"e9"');
    expect(c.state().loaded).toBe(true);
  });
});
