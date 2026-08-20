import { describe, it, expect } from "vitest";
import {
  CAMPAIGN_LEVELS,
  levelById,
  isUnlocked,
  validateCampaignCatalog,
  campaignStars,
  isUnlockedIn,
  validateLevelDraft,
  type CampaignLevelDraft,
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

describe("validateLevelDraft (admin)", () => {
  const ok: CampaignLevelDraft = {
    id: "lv1", sortOrder: 1, name: "Thử",
    config: { bots: { count: 5 }, win: { kind: "territory_pct", targetPct: 0.3 } },
    powerups: ["speed"], unlockRequires: null, rewards: { coin: 10, xp: 5, energy: 0 }, published: true,
  };

  it("bản nháp hợp lệ ⇒ không lỗi", () => {
    expect(validateLevelDraft(ok)).toEqual([]);
  });

  it("bắt lỗi: id sai ký tự, sortOrder < 1, win.kind lạ, power-up lạ, rewards âm", () => {
    const bad = {
      ...ok, id: "lv 1!", sortOrder: 0,
      config: { win: { kind: "khong-co" } },
      powerups: ["bay"], rewards: { coin: -1, xp: 5, energy: 0 },
    } as unknown as CampaignLevelDraft;
    const errs = validateLevelDraft(bad);
    expect(errs.length).toBeGreaterThanOrEqual(4);
  });

  it("totem tác giả hợp lệ ⇒ không lỗi", () => {
    const d: CampaignLevelDraft = {
      ...ok,
      config: { ...ok.config, map: { totems: [{ kind: "speed", q: 1, r: 0 }, { kind: "slow", q: 0, r: 1 }] } },
    };
    expect(validateLevelDraft(d)).toEqual([]);
  });

  it("bắt lỗi totem: kind lạ, toạ độ không nguyên, trùng ô", () => {
    const d = {
      ...ok,
      config: { ...ok.config, map: { totems: [
        { kind: "xyz", q: 0, r: 0 },
        { kind: "speed", q: 1.5, r: 0 },
        { kind: "slow", q: 2, r: 2 },
        { kind: "radar", q: 2, r: 2 },
      ] } },
    } as unknown as CampaignLevelDraft;
    const errs = validateLevelDraft(d);
    expect(errs.some((e) => e.includes("kind lạ"))).toBe(true);
    expect(errs.some((e) => e.includes("nguyên"))).toBe(true);
    expect(errs.some((e) => e.includes("trùng ô"))).toBe(true);
  });
});
