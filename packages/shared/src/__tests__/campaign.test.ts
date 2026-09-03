import { describe, it, expect } from "vitest";
import {
  CAMPAIGN_LEVELS,
  levelById,
  isUnlocked,
  validateCampaignCatalog,
  campaignStars,
  evaluateCampaignOutcome,
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

// ---- evaluateCampaignOutcome (doc 35 §A3 lớp 1) ---------------------------------------------
// Trọng tâm: server KHÔNG nhận "đã thắng"/"mấy sao" từ client, và dữ kiện thô bị KẸP theo cấu
// hình cấp trước khi chấm.
describe("evaluateCampaignOutcome", () => {
  const facts0 = { deaths: 0, territoryPct: 0, totemsCaptured: 0, kingHeldSec: 0 };

  it("territory_pct: targetPct là PHÂN SỐ, territoryPct là thang 0..100", () => {
    const cfg = { rules: { maxLives: 0 }, win: { kind: "territory_pct" as const, targetPct: 0.3 } };
    expect(evaluateCampaignOutcome(cfg, { ...facts0, territoryPct: 29.9 }, 60).objectiveMet).toBe(false);
    const met = evaluateCampaignOutcome(cfg, { ...facts0, territoryPct: 30 }, 60);
    expect(met.objectiveMet).toBe(true);
    expect(met.stars).toBe(3); // 0 lần chết
    expect(met.score).toBe(300); // % × 10
  });

  it("survive: chấm bằng thời gian SERVER đo, không phải dữ kiện client", () => {
    const cfg = { rules: { maxLives: 0 }, win: { kind: "survive" as const, durationSec: 60 } };
    expect(evaluateCampaignOutcome(cfg, facts0, 59).objectiveMet).toBe(false);
    expect(evaluateCampaignOutcome(cfg, facts0, 60).objectiveMet).toBe(true);
  });

  it("capture_totems: khai khống bị KẸP theo số totem cấp đó thực sự có", () => {
    // Cấp chỉ đặt 2 totem nhưng mục tiêu cần 5 ⇒ khai 999 vẫn KHÔNG đạt.
    const cfg = {
      map: { totems: [{ kind: "speed" as const, q: 1, r: 0 }, { kind: "slow" as const, q: 2, r: 0 }] },
      rules: { maxLives: 0 },
      win: { kind: "capture_totems" as const, totemGoal: 5 },
    };
    expect(evaluateCampaignOutcome(cfg, { ...facts0, totemsCaptured: 999 }, 60).objectiveMet).toBe(false);
    // Mục tiêu 2 thì thu đủ 2 là đạt.
    const cfg2 = { ...cfg, win: { kind: "capture_totems" as const, totemGoal: 2 } };
    expect(evaluateCampaignOutcome(cfg2, { ...facts0, totemsCaptured: 999 }, 60).objectiveMet).toBe(true);
  });

  it("king_hold: kingHeldSec bị kẹp theo thời gian đã chơi", () => {
    const cfg = { rules: { maxLives: 0 }, win: { kind: "king_hold" as const, winHoldTime: 180 } };
    // Khai giữ ngôi 999s nhưng ván mới chạy 10s ⇒ kẹp về 10 ⇒ không đạt.
    expect(evaluateCampaignOutcome(cfg, { ...facts0, kingHeldSec: 999 }, 10).objectiveMet).toBe(false);
    expect(evaluateCampaignOutcome(cfg, { ...facts0, kingHeldSec: 999 }, 200).objectiveMet).toBe(true);
  });

  it("hết mạng ⇒ KHÔNG đạt dù mục tiêu có vẻ xong", () => {
    const cfg = { rules: { maxLives: 3 }, win: { kind: "territory_pct" as const, targetPct: 0.1 } };
    const r = evaluateCampaignOutcome(cfg, { ...facts0, territoryPct: 100, deaths: 3 }, 60);
    expect(r.objectiveMet).toBe(false);
    expect(r.reason).toBe("out_of_lives");
  });

  it("objective `none` (Luyện tập endless) không bao giờ qua màn", () => {
    const cfg = { rules: { maxLives: 0 }, win: { kind: "none" as const } };
    expect(evaluateCampaignOutcome(cfg, { ...facts0, territoryPct: 100 }, 9999).reason).toBe("objective_none");
  });

  it("dữ kiện bẩn (NaN/âm/thiếu) chỉ làm KHÔNG ĐẠT, không ném lỗi", () => {
    const cfg = { rules: { maxLives: 0 }, win: { kind: "territory_pct" as const, targetPct: 0.3 } };
    expect(evaluateCampaignOutcome(cfg, {}, 60).objectiveMet).toBe(false);
    expect(evaluateCampaignOutcome(cfg, { territoryPct: Number.NaN }, 60).objectiveMet).toBe(false);
    expect(evaluateCampaignOutcome(cfg, { territoryPct: -5 }, 60).objectiveMet).toBe(false);
    // Vượt trần cũng bị kẹp: 1e9% ⇒ 100% ⇒ điểm tối đa 1000, không phải số khổng lồ.
    expect(evaluateCampaignOutcome(cfg, { ...facts0, territoryPct: 1e9 }, 60).score).toBe(1000);
  });

  it("số SAO do server suy từ số lần chết, không nhận từ client", () => {
    const cfg = { rules: { maxLives: 0 }, win: { kind: "territory_pct" as const, targetPct: 0.1 } };
    const at = (deaths: number) => evaluateCampaignOutcome(cfg, { ...facts0, territoryPct: 50, deaths }, 60).stars;
    expect(at(0)).toBe(3);
    expect(at(1)).toBe(2);
    expect(at(5)).toBe(1);
  });
});
