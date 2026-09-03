import { describe, expect, it, vi } from "vitest";
import { REMOTE_CONFIG_DEFAULTS, remoteConfigEtag, type RemoteConfigBundle } from "@hexagon/shared";
import {
  CONFIG_CACHE_MS,
  RemoteConfigController,
  parsePlatform,
  parseUnitId,
} from "../src/config-api/remote-config.controller";
import type { SessionService } from "../src/auth/session.service";
import type { SupabaseService } from "../src/database/supabase.service";

// doc 35 §A2 — GET /v1/config. Điều được bảo vệ ở đây: endpoint này KHÔNG BAO GIỜ được là điểm
// chết. Client gọi nó lúc khởi động, nên database hỏng mà trả 500 thì kill-switch biến từ công cụ
// cứu hoả thành nguyên nhân cháy.

function sessions(player: { id: string } | null) {
  return {
    resolve: vi.fn(async () => {
      if (!player) throw new Error("missing_session");
      return { id: player.id, displayName: "x", platform: "telegram" };
    }),
  } as unknown as SessionService;
}

function db(rows: unknown[], error: { message: string } | null = null) {
  const calls = { select: 0 };
  const service = {
    from: () => ({
      select: async () => {
        calls.select++;
        return { data: rows, error };
      },
    }),
  } as unknown as SupabaseService;
  return { service, calls };
}

/** `res` giả: ghi lại status/header/body để soi đúng thứ HTTP thật sự trả ra. */
function res() {
  const headers: Record<string, string> = {};
  const out: { status: number; body: unknown; ended: boolean } = { status: 0, body: null, ended: false };
  return {
    headers,
    out,
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = v; },
    status(code: number) { out.status = code; return this; },
    json(body: unknown) { out.body = body; return this; },
    end() { out.ended = true; return this; },
  };
}

function req(headers: Record<string, string> = {}) {
  return { headers, cookies: {} } as never;
}

/** Đọc bundle trong body cho gọn ở phần assert. */
function bundleOf(r: ReturnType<typeof res>): Record<string, unknown> {
  return (r.out.body as { config: Record<string, unknown> }).config;
}

describe("GET /v1/config", () => {
  it("bảng RỖNG ⇒ trả đúng bộ mặc định trong shared", async () => {
    const r = res();
    const c = new RemoteConfigController(sessions(null), db([]).service);
    await c.config(req(), r as never, "telegram", "b1", "a-1");
    expect(r.out.status).toBe(200);
    expect(bundleOf(r)).toEqual(REMOTE_CONFIG_DEFAULTS);
  });

  it("DATABASE HỎNG ⇒ vẫn 200 với mặc định, KHÔNG ném lỗi", async () => {
    const r = res();
    const c = new RemoteConfigController(sessions(null), db([], { message: "connection refused" }).service);
    await c.config(req(), r as never, "telegram", "b1", "a-1");
    expect(r.out.status).toBe(200);
    expect(bundleOf(r)).toEqual(REMOTE_CONFIG_DEFAULTS);
  });

  it("dòng trong database ghi đè mặc định", async () => {
    const r = res();
    const c = new RemoteConfigController(sessions(null), db([{ key: "ads.enabled", value: false, audience: null }]).service);
    await c.config(req(), r as never, "telegram", "b1", "a-1");
    expect(bundleOf(r)["ads.enabled"]).toBe(false);
  });

  it("giá trị SAI KIỂU ⇒ bỏ, dùng mặc định (gõ nhầm ở admin không được làm hỏng client)", async () => {
    const r = res();
    const c = new RemoteConfigController(sessions(null), db([{ key: "ads.enabled", value: "false", audience: null }]).service);
    await c.config(req(), r as never, "telegram", "b1", "a-1");
    expect(bundleOf(r)["ads.enabled"]).toBe(true);
  });

  it("audience lọc theo nền tảng", async () => {
    const rows = [{ key: "netplay.enabled", value: false, audience: { platforms: ["web"] } }];

    const tg = res();
    await new RemoteConfigController(sessions(null), db(rows).service).config(req(), tg as never, "telegram", "b1", "a-1");
    expect(bundleOf(tg)["netplay.enabled"]).toBe(true);

    const web = res();
    await new RemoteConfigController(sessions(null), db(rows).service).config(req(), web as never, "web", "b1", "a-1");
    expect(bundleOf(web)["netplay.enabled"]).toBe(false);
  });

  it("ETag: gửi lại If-None-Match đúng ⇒ 304, không có body", async () => {
    const c = new RemoteConfigController(sessions(null), db([]).service);
    const first = res();
    await c.config(req(), first as never, "telegram", "b1", "a-1");
    const etag = first.headers["etag"];
    expect(etag).toBe(remoteConfigEtag(REMOTE_CONFIG_DEFAULTS as RemoteConfigBundle));

    const second = res();
    await c.config(req({ "if-none-match": etag }), second as never, "telegram", "b1", "a-1");
    expect(second.out.status).toBe(304);
    expect(second.out.body).toBeNull();
    expect(second.out.ended).toBe(true);
  });

  it("audience rollout 0 ⇒ không ai thấy, kể cả khi có session", async () => {
    const rows = [{ key: "ads.enabled", value: false, audience: { rollout: 0 } }];
    const r = res();
    await new RemoteConfigController(sessions({ id: "player-1" }), db(rows).service).config(req(), r as never, "telegram", "b1", "a-1");
    expect(bundleOf(r)["ads.enabled"]).toBe(true);
  });

  it("cache: hai lần gọi liên tiếp chỉ đọc database MỘT lần", async () => {
    const d = db([]);
    const c = new RemoteConfigController(sessions(null), d.service);
    await c.config(req(), res() as never, "telegram", "b1", "a-1");
    await c.config(req(), res() as never, "telegram", "b1", "a-2");
    expect(d.calls.select).toBe(1);
    expect(CONFIG_CACHE_MS).toBeGreaterThan(0);
  });

  it("Cache-Control cho client 5 phút", async () => {
    const r = res();
    await new RemoteConfigController(sessions(null), db([]).service).config(req(), r as never, "telegram", "b1", "a-1");
    expect(r.headers["cache-control"]).toBe("public, max-age=300");
  });
});

describe("parsePlatform / parseUnitId", () => {
  it("nền tảng lạ ⇒ web, không ném lỗi", () => {
    expect(parsePlatform("telegram")).toBe("telegram");
    expect(parsePlatform("ios")).toBe("web");
    expect(parsePlatform(undefined)).toBe("web");
  });

  it("anonId thiếu ⇒ anonymous; quá dài ⇒ cắt còn 64 ký tự", () => {
    expect(parseUnitId(undefined)).toBe("anonymous");
    expect(parseUnitId("")).toBe("anonymous");
    expect(parseUnitId("x".repeat(200))).toHaveLength(64);
  });
});
