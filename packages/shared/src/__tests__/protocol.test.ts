import { describe, it, expect } from "vitest";
import {
  TAG,
  peekTag,
  encodeInput,
  decodeInput,
  encodeSnapshot,
  decodeSnapshot,
  encodeControl,
  decodeControl,
  encodeTerritory,
  decodeTerritory,
  type Snapshot,
  type S2CControl,
  type C2SControl,
  type TerritoryCell,
} from "../protocol";

describe("protocol INPUT (nhị phân)", () => {
  it("mã hoá ↔ giải mã khứ hồi", () => {
    const buf = encodeInput(12345, 1.2345);
    expect(peekTag(buf)).toBe(TAG.INPUT);
    const m = decodeInput(buf)!;
    expect(m).not.toBeNull();
    expect(m.seq).toBe(12345);
    expect(m.heading).toBeCloseTo(1.2345, 5);
  });

  it("nhận Uint8Array (frame ws) cũng giải mã được", () => {
    const buf = encodeInput(7, -0.5);
    const view = new Uint8Array(buf);
    const m = decodeInput(view)!;
    expect(m.seq).toBe(7);
    expect(m.heading).toBeCloseTo(-0.5, 5);
  });

  it("từ chối buffer sai tag / quá ngắn → null", () => {
    expect(decodeInput(new Uint8Array([99, 0, 0]))).toBeNull();
    expect(
      decodeInput(
        encodeSnapshot({ tick: 1, ackSeq: 0, selfPrep: 0, entities: [] })
      )
    ).toBeNull();
  });
});

describe("lobby control contract", () => {
  it("roundtrips ready and intentional cancel", () => {
    const ready: C2SControl = { t: "lobby_ready", ready: true };
    const cancel: C2SControl = { t: "lobby_cancel" };
    expect(decodeControl<C2SControl>(encodeControl(ready))).toEqual(ready);
    expect(decodeControl<C2SControl>(encodeControl(cancel))).toEqual(cancel);
  });
});

describe("protocol SNAPSHOT (nhị phân)", () => {
  it("mã hoá ↔ giải mã nhiều thực thể (giữ cờ + score)", () => {
    const snap: Snapshot = {
      tick: 999,
      ackSeq: 42,
      selfPrep: 1500,
      entities: [
        { id: 0, alive: true, hasTrail: true, colorIndex: 3, trailPatternIndex: 2, shapeIndex: 4, x: 12.5, y: -7.25, heading: 0.75, score: 1234, effectiveSpeed: 7.25, speedTotemCount: 3, radarActive: true },
        { id: 5, alive: false, hasTrail: false, colorIndex: 1, trailPatternIndex: 3, shapeIndex: 3, x: -60.1, y: 33.3, heading: -2.9, score: 0 },
      ],
    };
    const buf = encodeSnapshot(snap);
    expect(peekTag(buf)).toBe(TAG.SNAPSHOT);
    const d = decodeSnapshot(buf)!;
    expect(d.tick).toBe(999);
    expect(d.ackSeq).toBe(42);
    expect(d.selfPrep).toBe(1500);
    expect(d.entities).toHaveLength(2);

    const a = d.entities[0];
    expect(a.id).toBe(0);
    expect(a.alive).toBe(true);
    expect(a.hasTrail).toBe(true);
    expect(a.colorIndex).toBe(3);
    expect(a.trailPatternIndex).toBe(2);
    expect(a.shapeIndex).toBe(4);
    expect(a.x).toBeCloseTo(12.5, 3);
    expect(a.y).toBeCloseTo(-7.25, 3);
    expect(a.heading).toBeCloseTo(0.75, 4);
    expect(a.score).toBe(1234);
    expect(a.effectiveSpeed).toBe(7.25);
    expect(a.speedTotemCount).toBe(3);
    expect(a.radarActive).toBe(true);

    const b = d.entities[1];
    expect(b.alive).toBe(false);
    expect(b.hasTrail).toBe(false);
    expect(b.trailPatternIndex).toBe(3);
    expect(b.shapeIndex).toBe(3);
    expect(b.x).toBeCloseTo(-60.1, 2);
    expect(b.score).toBe(0);
    expect(b.effectiveSpeed).toBe(0);
    expect(b.speedTotemCount).toBe(0);
    expect(b.radarActive).toBe(false);
  });

  it("snapshot rỗng hợp lệ", () => {
    const d = decodeSnapshot(
      encodeSnapshot({ tick: 1, ackSeq: 0, selfPrep: 0, entities: [] })
    )!;
    expect(d.entities).toHaveLength(0);
    expect(d.tick).toBe(1);
  });

  it("từ chối buffer sai tag → null", () => {
    expect(decodeSnapshot(encodeInput(1, 0))).toBeNull();
  });
});

describe("protocol TERRITORY (nhị phân)", () => {
  it("mã hoá ↔ giải mã keyframe (đất + đuôi, toạ độ âm)", () => {
    const cells: TerritoryCell[] = [
      { q: 3, r: -5, owner: 0, kind: 0 },
      { q: -12, r: 7, owner: 4, kind: 1 },
      { q: 0, r: 0, owner: 27, kind: 0 },
    ];
    const buf = encodeTerritory(555, cells);
    expect(peekTag(buf)).toBe(TAG.TERRITORY);
    const d = decodeTerritory(buf)!;
    expect(d.tick).toBe(555);
    expect(d.cells).toEqual(cells);
  });

  it("keyframe rỗng hợp lệ; sai tag → null", () => {
    expect(decodeTerritory(encodeTerritory(1, []))!.cells).toHaveLength(0);
    expect(decodeTerritory(encodeInput(1, 0))).toBeNull();
  });
});

describe("protocol điều khiển (JSON)", () => {
  it("khứ hồi welcome / event / pong", () => {
    const welcome: S2CControl = {
      t: "welcome",
      playerId: 2,
      arenaRadius: 60,
      hexSize: 0.75,
      tickRate: 24,
      seed: 123,
      maxPlayers: 8,
      botCount: 20,
    };
    expect(decodeControl<S2CControl>(encodeControl(welcome))).toEqual(welcome);

    const ev: S2CControl = { t: "event", kind: "death", id: 3, cause: "cut", killerId: 1 };
    expect(decodeControl<S2CControl>(encodeControl(ev))).toEqual(ev);

    const pong: S2CControl = { t: "pong", time: 555 };
    expect(decodeControl<S2CControl>(encodeControl(pong))).toEqual(pong);

    const lobby: S2CControl = {
      t: "lobby",
      present: 3,
      needed: 2,
      started: false,
      readyCount: 1,
      selfReady: false,
    };
    expect(decodeControl<S2CControl>(encodeControl(lobby))).toEqual(lobby);

    const minimap: S2CControl = {
      t: "minimap_ui",
      radarActive: true,
      entities: [{ id: 2, x: 4.5, y: -3, alive: true }],
    };
    expect(decodeControl<S2CControl>(encodeControl(minimap))).toEqual(minimap);

    const totems: S2CControl = {
      t: "totems",
      revision: 4,
      items: [{ id: 1, kind: "slow", q: 3, r: -2, ownerId: -1 }],
    };
    expect(decodeControl<S2CControl>(encodeControl(totems))).toEqual(totems);

    const ended: S2CControl = {
      t: "event",
      kind: "match_end",
      winnerId: 2,
      reason: "king_countdown",
      finalScores: [{ id: 2, score: 99, placement: 1 }],
    };
    expect(decodeControl<S2CControl>(encodeControl(ended))).toEqual(ended);
  });

  it("chuỗi JSON hỏng → null", () => {
    expect(decodeControl("{not json")).toBeNull();
  });
});
