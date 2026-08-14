import { describe, expect, it } from "vitest";
import { endActionForMode } from "../endAction";

describe("end screen action", () => {
  it("keeps replay for single-player", () => {
    expect(endActionForMode("single")).toEqual({ label: "CHƠI LẠI", kind: "restart" });
  });

  it("offers only lobby return online", () => {
    expect(endActionForMode("online")).toEqual({ label: "QUAY VỀ LOBBY", kind: "lobby" });
  });
});
