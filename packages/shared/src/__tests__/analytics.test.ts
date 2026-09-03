import { describe, it, expect } from "vitest";
import {
  ANALYTICS_EVENT_NAMES,
  ANALYTICS_SCHEMA_VERSION,
  FORBIDDEN_PROP_KEYS,
  MAX_PROPS,
  MAX_PROP_STRING_LENGTH,
  makeEvent,
  sanitizeProps,
  validateEvent,
  type AnalyticsContext,
} from "../analytics";

const CTX: AnalyticsContext = {
  sessionId: "sess-1",
  anonId: "anon-1",
  platform: "telegram",
  buildId: "abc1234",
};

describe("Hợp đồng tên sự kiện", () => {
  it("danh sách chạy được KHÔNG trùng lặp", () => {
    expect(new Set(ANALYTICS_EVENT_NAMES).size).toBe(ANALYTICS_EVENT_NAMES.length);
  });

  it("phủ đủ funnel tối thiểu của doc 35 §A1", () => {
    for (const required of [
      "app_open", "ftue_step", "login_success", "mode_select",
      "match_start", "match_end",
      "campaign_level_start", "campaign_level_complete", "campaign_level_fail",
      "energy_empty", "energy_purchase",
      "shop_open", "purchase_start", "purchase_success", "purchase_fail",
      "ad_request", "ad_impression", "ad_reward", "ad_error",
      "invite_sent", "invite_accepted", "session_end",
    ]) {
      expect(ANALYTICS_EVENT_NAMES).toContain(required);
    }
  });
});

describe("sanitizeProps — chặn PII và giữ bảng truy vấn được", () => {
  it("bỏ mọi khoá nghi PII, không phân biệt hoa thường / kiểu đặt tên", () => {
    const out = sanitizeProps({
      email: "a@b.com",
      userEmail: "a@b.com",
      user_email: "a@b.com",
      initData: "query_id=...",
      displayName: "Tèo",
      authToken: "xyz",
      levelId: "c1", // hợp lệ, phải giữ
    });
    expect(out).toEqual({ levelId: "c1" });
    // và không lọt khoá cấm nào
    for (const k of Object.keys(out)) {
      for (const bad of FORBIDDEN_PROP_KEYS) expect(k.toLowerCase()).not.toContain(bad);
    }
  });

  it("chỉ giữ giá trị nguyên thuỷ; bỏ object/array/undefined/hàm", () => {
    const out = sanitizeProps({
      ok_string: "x",
      ok_number: 3,
      ok_bool: true,
      ok_null: null,
      nested: { a: 1 },
      list: [1, 2],
      missing: undefined,
      fn: () => 1,
    });
    expect(out).toEqual({ ok_string: "x", ok_number: 3, ok_bool: true, ok_null: null });
  });

  it("bỏ số không hữu hạn (NaN/Infinity làm hỏng phép tổng hợp)", () => {
    expect(sanitizeProps({ a: Number.NaN, b: Number.POSITIVE_INFINITY, c: 1 })).toEqual({ c: 1 });
  });

  it("cắt chuỗi quá dài và giới hạn số thuộc tính", () => {
    const long = "x".repeat(MAX_PROP_STRING_LENGTH + 50);
    expect((sanitizeProps({ s: long }).s as string).length).toBe(MAX_PROP_STRING_LENGTH);

    const many: Record<string, number> = {};
    for (let i = 0; i < MAX_PROPS + 10; i++) many[`k${i}`] = i;
    expect(Object.keys(sanitizeProps(many)).length).toBe(MAX_PROPS);
  });

  it("props rỗng/undefined ⇒ object rỗng, không ném lỗi", () => {
    expect(sanitizeProps(undefined)).toEqual({});
    expect(sanitizeProps({})).toEqual({});
  });
});

describe("makeEvent", () => {
  it("gắn đủ bối cảnh: schema, platform, buildId, session, anon", () => {
    const e = makeEvent("app_open", { source: "direct" }, CTX, 1_700_000_000_000);
    expect(e.name).toBe("app_open");
    expect(e.ts).toBe(1_700_000_000_000);
    expect(e.schema).toBe(ANALYTICS_SCHEMA_VERSION);
    expect(e.platform).toBe("telegram");
    expect(e.buildId).toBe("abc1234");
    expect(e.sessionId).toBe("sess-1");
    expect(e.anonId).toBe("anon-1");
    expect(e.props).toEqual({ source: "direct" });
  });

  it("mỗi sự kiện có eventId RIÊNG (server khử trùng theo trường này)", () => {
    const ids = new Set(Array.from({ length: 50 }, () => makeEvent("app_open", {}, CTX).eventId));
    expect(ids.size).toBe(50);
  });

  it("PII lọt vào lúc gọi cũng bị chặn ngay tại makeEvent", () => {
    const e = makeEvent("login_success", { email: "a@b.com", provider: "telegram" }, CTX);
    expect(e.props).toEqual({ provider: "telegram" });
  });
});

describe("validateEvent — server kiểm lại, không tin client", () => {
  const good = makeEvent("match_end", { mode: "campaign", won: true }, CTX);

  it("sự kiện dựng đúng ⇒ không lỗi", () => {
    expect(validateEvent(good)).toEqual([]);
  });

  it("tên sự kiện lạ bị từ chối (chống rác tên tự chế)", () => {
    expect(validateEvent({ ...good, name: "match_ended" }).some((e) => e.includes("name"))).toBe(true);
  });

  it("thiếu bối cảnh hoặc platform lạ bị từ chối", () => {
    expect(validateEvent({ ...good, sessionId: "" }).some((e) => e.includes("sessionId"))).toBe(true);
    expect(validateEvent({ ...good, platform: "ios" }).some((e) => e.includes("platform"))).toBe(true);
    expect(validateEvent({ ...good, buildId: "" }).some((e) => e.includes("buildId"))).toBe(true);
  });

  it("ts/eventId/props sai kiểu bị từ chối", () => {
    expect(validateEvent({ ...good, ts: Number.NaN }).some((e) => e.includes("ts"))).toBe(true);
    expect(validateEvent({ ...good, eventId: "" }).some((e) => e.includes("eventId"))).toBe(true);
    expect(validateEvent({ ...good, props: [1, 2] }).some((e) => e.includes("props"))).toBe(true);
  });

  it("đầu vào không phải object ⇒ báo lỗi, không ném", () => {
    expect(validateEvent(null).length).toBeGreaterThan(0);
    expect(validateEvent("chuỗi").length).toBeGreaterThan(0);
  });
});
