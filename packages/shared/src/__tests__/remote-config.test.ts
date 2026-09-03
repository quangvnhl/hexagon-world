import { describe, expect, it } from "vitest";
import {
  REMOTE_CONFIG_DEFAULTS,
  REMOTE_CONFIG_KEYS,
  audienceMatches,
  coerceToTypeOf,
  remoteConfigEtag,
  resolveRemoteConfig,
  rolloutBucket,
  stableHash32,
  type RemoteConfigRequest,
} from "../remote-config";

// doc 35 §A2 — luật giải quyết cấu hình. Client và server đều dùng file này, nên mọi tính chất ở
// đây là hợp đồng giữa hai bên chứ không phải chi tiết nội bộ.

const REQ: RemoteConfigRequest = { platform: "telegram", buildId: "2026.09.03", unitId: "u-1" };

describe("Fallback", () => {
  it("không có dòng nào ⇒ đúng bộ mặc định", () => {
    expect(resolveRemoteConfig([], REQ)).toEqual(REMOTE_CONFIG_DEFAULTS);
  });

  it("khoá LẠ (còn sót sau khi đổi tên) bị bỏ qua, không làm hỏng bundle", () => {
    expect(resolveRemoteConfig([{ key: "khoa.khong.ton.tai", value: 1 }], REQ)).toEqual(REMOTE_CONFIG_DEFAULTS);
  });

  it("mọi khoá trong union đều CÓ mặc định — không khoá nào ra undefined", () => {
    for (const k of REMOTE_CONFIG_KEYS) expect(REMOTE_CONFIG_DEFAULTS[k]).toBeDefined();
  });
});

describe("Ép kiểu", () => {
  it("sai kiểu ⇒ undefined, KHÔNG tự đổi kiểu", () => {
    expect(coerceToTypeOf(true, "true")).toBeUndefined();
    expect(coerceToTypeOf(5, "5")).toBeUndefined();
    expect(coerceToTypeOf("normal", 5)).toBeUndefined();
  });

  it("số không hữu hạn bị loại (NaN/Infinity làm hỏng mọi phép tính sau đó)", () => {
    expect(coerceToTypeOf(5, Number.NaN)).toBeUndefined();
    expect(coerceToTypeOf(5, Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it("đúng kiểu thì giữ nguyên, kể cả 0 và chuỗi rỗng", () => {
    expect(coerceToTypeOf(5, 0)).toBe(0);
    expect(coerceToTypeOf("normal", "")).toBe("");
    expect(coerceToTypeOf(true, false)).toBe(false);
  });
});

describe("Đối tượng áp dụng", () => {
  it("audience rỗng ⇒ áp cho tất cả", () => {
    expect(audienceMatches("k", null, REQ)).toBe(true);
    expect(audienceMatches("k", {}, REQ)).toBe(true);
  });

  it("minBuild: build cũ hơn thì KHÔNG áp", () => {
    expect(audienceMatches("k", { minBuild: "2026.09.10" }, REQ)).toBe(false);
    expect(audienceMatches("k", { minBuild: "2026.01.01" }, REQ)).toBe(true);
  });

  it("rollout vô lý (âm, >100, không phải số) ⇒ KHÔNG áp — thà giữ mặc định", () => {
    for (const bad of [-1, 101, Number.NaN, "50" as unknown as number]) {
      expect(audienceMatches("k", { rollout: bad }, REQ)).toBe(false);
    }
  });

  it("rollout 100 ⇒ mọi người; rollout 0 ⇒ không ai", () => {
    expect(audienceMatches("k", { rollout: 100 }, REQ)).toBe(true);
    expect(audienceMatches("k", { rollout: 0 }, REQ)).toBe(false);
  });

  it("rollout 50% chia gần đúng nửa trên 1000 người", () => {
    let hit = 0;
    for (let i = 0; i < 1000; i++) {
      if (audienceMatches("ads.enabled", { rollout: 50 }, { ...REQ, unitId: `u-${i}` })) hit++;
    }
    expect(hit).toBeGreaterThan(400);
    expect(hit).toBeLessThan(600);
  });

  it("TẤT ĐỊNH: cùng người + cùng khoá ⇒ luôn cùng kết quả", () => {
    const a = audienceMatches("ads.enabled", { rollout: 37 }, REQ);
    for (let i = 0; i < 20; i++) {
      expect(audienceMatches("ads.enabled", { rollout: 37 }, REQ)).toBe(a);
    }
  });

  it("hai khoá chia nhóm ĐỘC LẬP — không dồn mọi thí nghiệm vào cùng nhóm người xui", () => {
    let differ = 0;
    for (let i = 0; i < 200; i++) {
      const u = `u-${i}`;
      if (rolloutBucket("ads.enabled", u) !== rolloutBucket("stars.enabled", u)) differ++;
    }
    expect(differ).toBeGreaterThan(150);
  });
});

describe("ETag", () => {
  it("cùng nội dung ⇒ cùng ETag dù THỨ TỰ DÒNG khác nhau", () => {
    const rows = [
      { key: "ads.enabled", value: false },
      { key: "stars.enabled", value: false },
    ];
    const a = remoteConfigEtag(resolveRemoteConfig(rows, REQ));
    const b = remoteConfigEtag(resolveRemoteConfig([...rows].reverse(), REQ));
    expect(a).toBe(b);
  });

  it("đổi một giá trị ⇒ đổi ETag", () => {
    const a = remoteConfigEtag(resolveRemoteConfig([], REQ));
    const b = remoteConfigEtag(resolveRemoteConfig([{ key: "ads.rewarded_daily_cap", value: 3 }], REQ));
    expect(a).not.toBe(b);
  });

  it("có dạng ETag hợp lệ (bọc trong dấu nháy kép)", () => {
    expect(remoteConfigEtag(resolveRemoteConfig([], REQ))).toMatch(/^"rc1-[0-9a-z]+"$/);
  });
});

describe("stableHash32", () => {
  it("thuần và ổn định giữa các lần chạy (client và server phải khớp nhau)", () => {
    expect(stableHash32("ads.enabled:u-1")).toBe(stableHash32("ads.enabled:u-1"));
    expect(stableHash32("a")).not.toBe(stableHash32("b"));
    expect(stableHash32("")).toBeGreaterThanOrEqual(0);
  });
});
