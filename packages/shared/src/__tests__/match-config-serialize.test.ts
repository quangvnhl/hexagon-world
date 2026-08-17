import { describe, it, expect } from "vitest";
import { encodeMatchConfig, decodeMatchConfig } from "../protocol";
import { resolveMatchConfig, type MatchConfigInput } from "../match-config";

// S5 — MatchConfig serialize qua welcome (JSON generic). Bất biến cần chứng minh:
// decode(encode(resolveMatchConfig(x))) DEEP-EQUAL resolveMatchConfig(x). Nhờ đó server
// gửi config đang chạy xuống, client dựng lại GameState-view KHỚP luật/sân server.

const cases: Array<{ name: string; input: MatchConfigInput }> = [
  { name: "mặc định (không override) — online king_hold hiện tại", input: {} },
  { name: "override số bot", input: { bots: { count: 3 } } },
  { name: "override điều kiện thắng none (Practice)", input: { win: { kind: "none" } } },
  {
    name: "override rules (tốc rẽ / kill radius)",
    input: { rules: { turnRate: 5, killRadius: 0.9 } },
  },
  {
    name: "override win đầy đủ + seed",
    input: {
      win: { kind: "territory_pct", targetPct: 62, kingPct: 40, winHoldTime: 12 },
      seed: 12345,
    },
  },
  {
    name: "override map + bots.difficultyMix",
    input: {
      map: { radius: 30, hexSize: 1.5 },
      bots: { count: 2, difficultyMix: [0, 1] },
    },
  },
];

describe("MatchConfig serialize (welcome) — round-trip", () => {
  for (const { name, input } of cases) {
    it(name, () => {
      const resolved = resolveMatchConfig(input);
      const round = decodeMatchConfig(encodeMatchConfig(resolved));
      expect(round).not.toBeNull();
      // toEqual: undefined-valued optional fields (cells/obstacles/targetPct…) coi như bằng
      // (JSON.stringify bỏ undefined) → chứng minh không mất dữ liệu có nghĩa.
      expect(round).toEqual(resolved);
    });
  }

  it("chuỗi hỏng → null (không ném)", () => {
    expect(decodeMatchConfig("{not json")).toBeNull();
    expect(decodeMatchConfig("null")).toBeNull();
    expect(decodeMatchConfig("42")).toBeNull();
  });

  it("nền online mặc định: config serialize giữ nguyên bots.count + win.kind king_hold", () => {
    const serverDefault = resolveMatchConfig({ bots: { count: 8 }, seed: 7 });
    const clientRebuilt = decodeMatchConfig(encodeMatchConfig(serverDefault));
    expect(clientRebuilt?.bots.count).toBe(8);
    expect(clientRebuilt?.win.kind).toBe("king_hold");
    expect(clientRebuilt?.seed).toBe(7);
    // Client dựng lại GameState từ config này ⇒ resolveMatchConfig(config) === config (idempotent).
    expect(resolveMatchConfig(clientRebuilt!)).toEqual(serverDefault);
  });
});
