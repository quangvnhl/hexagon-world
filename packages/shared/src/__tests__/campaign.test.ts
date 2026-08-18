import { describe, it, expect } from "vitest";
import {
  CAMPAIGN_LEVELS,
  levelById,
  isUnlocked,
  validateCampaignCatalog,
  campaignStars,
  isUnlockedIn,
} from "../campaign";
import { resolveMatchConfig } from "../match-config";

// E1 — catalog Campaign là dữ liệu thuần (doc 28 §E1).

describe("Campaign catalog — tính nhất quán", () => {
  it("catalog mẫu hợp lệ (không ném)", () => {
    expect(() => validateCampaignCatalog()).not.toThrow();
  });

  it("id duy nhất, order duy nhất và tăng dần theo thứ tự mảng", () => {
    const ids = CAMPAIGN_LEVELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    const orders = CAMPAIGN_LEVELS.map((l) => l.order);
    for (let i = 1; i < orders.length; i++) expect(orders[i]).toBeGreaterThan(orders[i - 1]);
  });

  it("mọi config qua resolveMatchConfig không ném + giữ đúng objective", () => {
    for (const l of CAMPAIGN_LEVELS) {
      const cfg = resolveMatchConfig(l.config);
      expect(cfg.win.kind).toBe(l.config.win?.kind);
    }
  });

  it("chuỗi unlock không trỏ id lạ, không tự tham chiếu", () => {
    const ids = new Set(CAMPAIGN_LEVELS.map((l) => l.id));
    for (const l of CAMPAIGN_LEVELS) {
      const req = l.unlock.requires;
      if (req !== null) {
        expect(ids.has(req)).toBe(true);
        expect(req).not.toBe(l.id);
      }
    }
  });

  it("phát hiện catalog hỏng: id lạ ⇒ ném", () => {
    expect(() =>
      validateCampaignCatalog([
        { id: "x", order: 1, name: "x", config: {}, powerups: [], unlock: { requires: "khong-ton-tai" }, rewards: { coin: 0, xp: 0, energy: 0 } },
      ]),
    ).toThrow();
  });

  it("phát hiện catalog hỏng: trùng order ⇒ ném", () => {
    expect(() =>
      validateCampaignCatalog([
        { id: "a", order: 1, name: "a", config: {}, powerups: [], unlock: { requires: null }, rewards: { coin: 0, xp: 0, energy: 0 } },
        { id: "b", order: 1, name: "b", config: {}, powerups: [], unlock: { requires: null }, rewards: { coin: 0, xp: 0, energy: 0 } },
      ]),
    ).toThrow();
  });
});

describe("Campaign helpers", () => {
  it("levelById tra đúng / trả undefined khi không có", () => {
    expect(levelById("c1")?.order).toBe(1);
    expect(levelById("khong-co")).toBeUndefined();
  });

  it("isUnlocked: cấp requires=null luôn mở; cấp kế cần cấp trước trong cleared", () => {
    const first = CAMPAIGN_LEVELS[0];
    const second = CAMPAIGN_LEVELS[1];
    expect(first.unlock.requires).toBeNull();
    expect(isUnlocked(first.id, new Set())).toBe(true);
    expect(isUnlocked(second.id, new Set())).toBe(false);
    expect(isUnlocked(second.id, new Set([first.id]))).toBe(true);
  });

  it("isUnlocked: id không tồn tại ⇒ false", () => {
    expect(isUnlocked("khong-co", new Set())).toBe(false);
  });

  it("isUnlockedIn tra trong danh sách truyền vào (nguồn DB)", () => {
    const list = [
      { id: "a", order: 1, name: "a", config: {}, powerups: [], unlock: { requires: null }, rewards: { coin: 0, xp: 0, energy: 0 } },
      { id: "b", order: 2, name: "b", config: {}, powerups: [], unlock: { requires: "a" }, rewards: { coin: 0, xp: 0, energy: 0 } },
    ];
    expect(isUnlockedIn(list, "a", new Set())).toBe(true);
    expect(isUnlockedIn(list, "b", new Set())).toBe(false);
    expect(isUnlockedIn(list, "b", new Set(["a"]))).toBe(true);
    expect(isUnlockedIn(list, "khong-co", new Set())).toBe(false);
  });

  it("campaignStars theo số lần chết: 0→3, 1→2, ≥2→1", () => {
    expect(campaignStars(0)).toBe(3);
    expect(campaignStars(1)).toBe(2);
    expect(campaignStars(2)).toBe(1);
    expect(campaignStars(9)).toBe(1);
  });
});
