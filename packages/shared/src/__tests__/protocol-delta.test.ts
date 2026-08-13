import { describe, expect, it } from "vitest";
import {
  TAG,
  TERRITORY_DELTA_HEADER,
  TERRITORY_DELTA_OPERATION,
  decodeTerritoryDelta,
  encodeTerritory,
  encodeTerritoryDelta,
  encodeTerritoryMinimap,
  decodeTerritoryMinimap,
  peekTag,
  type TerritoryDelta,
} from "../protocol";

describe("protocol TERRITORY_DELTA (binary)", () => {
  it("keeps full-map minimap keyframes on a distinct tag", () => {
    const cells = [{ q: 2, r: -3, owner: 4, kind: 0 as const }];
    const frame = encodeTerritoryMinimap(88, cells);
    expect(peekTag(frame)).toBe(TAG.TERRITORY_MINIMAP);
    expect(decodeTerritoryMinimap(frame)).toEqual({ tick: 88, cells });
  });
  it("roundtrips upserts, removals and revision metadata", () => {
    const delta: TerritoryDelta = {
      tick: 1234,
      baseRevision: 41,
      revision: 42,
      operations: [
        { operation: "upsert", cell: { q: -320, r: 127, owner: 9, kind: 0 } },
        { operation: "upsert", cell: { q: 11, r: -15, owner: 2, kind: 1 } },
        { operation: "remove", q: -7, r: 8 },
      ],
    };

    const buf = encodeTerritoryDelta(delta);
    expect(peekTag(buf)).toBe(TAG.TERRITORY_DELTA);
    expect(buf.byteLength).toBe(
      TERRITORY_DELTA_HEADER + 3 * TERRITORY_DELTA_OPERATION
    );
    expect(decodeTerritoryDelta(buf)).toEqual(delta);
  });

  it("preserves unsigned 32-bit tick and revisions", () => {
    const delta: TerritoryDelta = {
      tick: 0xffffffff,
      baseRevision: 0xfffffffe,
      revision: 0xffffffff,
      operations: [],
    };
    expect(decodeTerritoryDelta(encodeTerritoryDelta(delta))).toEqual(delta);
  });

  it("accepts a Uint8Array slice without reading outside its bounds", () => {
    const encoded = new Uint8Array(
      encodeTerritoryDelta({
        tick: 7,
        baseRevision: 2,
        revision: 3,
        operations: [{ operation: "remove", q: 5, r: -6 }],
      })
    );
    const framed = new Uint8Array(encoded.byteLength + 4);
    framed.set(encoded, 2);
    expect(decodeTerritoryDelta(framed.subarray(2, 2 + encoded.byteLength))).toEqual({
      tick: 7,
      baseRevision: 2,
      revision: 3,
      operations: [{ operation: "remove", q: 5, r: -6 }],
    });
  });

  it("rejects wrong tags, truncated headers and truncated operations", () => {
    expect(decodeTerritoryDelta(encodeTerritory(1, []))).toBeNull();
    expect(
      decodeTerritoryDelta(new Uint8Array(TERRITORY_DELTA_HEADER - 1))
    ).toBeNull();

    const valid = new Uint8Array(
      encodeTerritoryDelta({
        tick: 1,
        baseRevision: 0,
        revision: 1,
        operations: [{ operation: "remove", q: 0, r: 0 }],
      })
    );
    expect(decodeTerritoryDelta(valid.subarray(0, valid.byteLength - 1))).toBeNull();
  });

  it("rejects unknown operation and invalid upsert kind", () => {
    const unknownOperation = new Uint8Array(
      encodeTerritoryDelta({
        tick: 1,
        baseRevision: 1,
        revision: 2,
        operations: [{ operation: "remove", q: 0, r: 0 }],
      })
    );
    unknownOperation[TERRITORY_DELTA_HEADER] = 2;
    expect(decodeTerritoryDelta(unknownOperation)).toBeNull();

    const invalidKind = new Uint8Array(
      encodeTerritoryDelta({
        tick: 1,
        baseRevision: 1,
        revision: 2,
        operations: [
          { operation: "upsert", cell: { q: 0, r: 0, owner: 1, kind: 0 } },
        ],
      })
    );
    invalidKind[TERRITORY_DELTA_HEADER + 6] = 9;
    expect(decodeTerritoryDelta(invalidKind)).toBeNull();
  });
});
