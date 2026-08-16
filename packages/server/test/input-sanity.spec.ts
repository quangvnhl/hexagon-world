import { describe, expect, it } from "vitest";
import { GameRoom } from "../src/game/game-room";

/** Pha 5 · B1 — applyInput chuẩn hóa heading về [-π, π] (giữ mọi guard hiện có). */
describe("applyInput heading sanity", () => {
  function seatedRoom() {
    const room = new GameRoom(2, 0, 180);
    const id = room.join("A");
    expect(id).not.toBeNull();
    room.startMatch();
    return { room, id: id as number };
  }

  it("gói heading lớn (>π) về đúng dải [-π, π]", () => {
    const { room, id } = seatedRoom();
    room.applyInput(id, 1, 10); // 10 rad ngoài dải
    room.stepTick(1 / 24);
    const applied = room.gameState.players[id].targetHeading;
    expect(applied).toBeGreaterThanOrEqual(-Math.PI);
    expect(applied).toBeLessThanOrEqual(Math.PI);
    expect(applied).toBeCloseTo(Math.atan2(Math.sin(10), Math.cos(10)), 10);
  });

  it("gói heading âm lớn (<-π) về đúng dải", () => {
    const { room, id } = seatedRoom();
    room.applyInput(id, 1, -12.5);
    room.stepTick(1 / 24);
    const applied = room.gameState.players[id].targetHeading;
    expect(applied).toBeGreaterThanOrEqual(-Math.PI);
    expect(applied).toBeLessThanOrEqual(Math.PI);
    expect(applied).toBeCloseTo(Math.atan2(Math.sin(-12.5), Math.cos(-12.5)), 10);
  });

  it("giữ nguyên guard: heading không hữu hạn bị bỏ qua", () => {
    const { room, id } = seatedRoom();
    const before = room.gameState.players[id].targetHeading;
    room.applyInput(id, 1, Number.POSITIVE_INFINITY);
    room.applyInput(id, 2, Number.NaN);
    room.stepTick(1 / 24);
    // Không có input hợp lệ nào được áp → targetHeading không đổi vì input.
    expect(room.gameState.players[id].targetHeading).toBe(before);
  });

  it("heading trong dải giữ nguyên (không đổi hành vi hợp lệ)", () => {
    const { room, id } = seatedRoom();
    room.applyInput(id, 1, 1.25);
    room.stepTick(1 / 24);
    expect(room.gameState.players[id].targetHeading).toBeCloseTo(1.25, 10);
  });
});
