import { describe, expect, it, vi } from "vitest";
import { GameRoom } from "../src/game/game-room";
import { ONLINE_BOT_CAPACITY_MAX, ONLINE_BOT_CAPACITY_MIN, onlineBotCapacityForRoom } from "../src/config";

describe("online room lifecycle", () => {
  it("selects a stable and distributed default bot capacity in 12..16", () => {
    const firstPass = Array.from({ length: 50 }, (_, index) => onlineBotCapacityForRoom(index + 1));
    const secondPass = Array.from({ length: 50 }, (_, index) => onlineBotCapacityForRoom(index + 1));
    expect(secondPass).toEqual(firstPass);
    expect(firstPass.every((count) => count >= ONLINE_BOT_CAPACITY_MIN && count <= ONLINE_BOT_CAPACITY_MAX)).toBe(true);
    expect(new Set(firstPass).size).toBeGreaterThan(1);
  });

  it("parks bot capacity and activates at most one bot per request", () => {
    const room = new GameRoom(8, 3, 180);
    expect(room.botCapacity).toBe(3);
    expect(room.activeBotCount).toBe(0);
    expect(room.activateNextBot()).toBe(8);
    expect(room.activeBotCount).toBe(1);
    expect(room.activateNextBot()).toBe(9);
    room.trimBots(1);
    expect(room.activeBotCount).toBe(1);
  });

  it("keeps the deadline across King A -> B and resets on King -> none", () => {
    const room = new GameRoom(2, 1, 3);
    room.join("A"); room.join("B"); room.startMatch();
    const king = vi.spyOn(room.gameState, "kingId");
    king.mockReturnValue(0); room.stepTick(1);
    expect(room.kingRemaining).toBeCloseTo(2);
    expect(room.kingAdmissionLocked).toBe(true);
    king.mockReturnValue(1); room.stepTick(1);
    expect(room.kingRemaining).toBeCloseTo(1);
    expect(room.gameState.won).toBe(false);
    king.mockReturnValue(-1); room.stepTick(0.25);
    expect(room.kingCountdownActive).toBe(false);
    expect(room.kingRemaining).toBe(3);
    expect(room.kingAdmissionLocked).toBe(false);
  });

  it("ends only when the current King completes the room countdown", () => {
    const room = new GameRoom(2, 0, 2);
    room.join("A"); room.join("B"); room.startMatch();
    vi.spyOn(room.gameState, "kingId").mockReturnValue(1);
    room.stepTick(1);
    expect(room.gameState.won).toBe(false);
    room.stepTick(1);
    expect(room.gameState.won).toBe(true);
    expect(room.gameState.winnerId).toBe(1);
  });

  it("awards an immediate win when King is the only surviving participant", () => {
    const room = new GameRoom(2, 1, 180);
    const kingId = room.join("King")!;
    const opponentId = room.join("Opponent")!;
    room.startMatch();
    room.activateNextBot();
    room.gameState.players[opponentId].phase = "dead";
    room.gameState.players[2].phase = "dead";
    vi.spyOn(room.gameState, "kingId").mockReturnValue(kingId);

    room.stepTick(1 / 24);

    expect(room.gameState.won).toBe(true);
    expect(room.gameState.winnerId).toBe(kingId);
    expect(room.kingRemaining).toBe(0);
  });

  it("blocks bot activation and human revive while countdown is active", () => {
    const room = new GameRoom(2, 2, 10);
    const human = room.join("A")!;
    room.startMatch();
    const bot = room.activateNextBot()!;
    const king = vi.spyOn(room.gameState, "kingId").mockReturnValue(human);
    room.stepTick(1);
    room.gameState.park(human);
    room.gameState.players[bot].phase = "dead";
    room.gameState.players[bot].respawnTimer = 0.1;
    room.stepTick(0.2);
    expect(room.activateNextBot()).toBeNull();
    expect(room.reviveSeat(human)).toBe(false);
    expect(room.gameState.players[bot].phase).toBe("dead");
    king.mockReturnValue(-1);
    room.stepTick(0.2);
    expect(room.gameState.players[bot].phase).toBe("prep");
  });
});

describe("doc 35 §C3 — tên hiển thị không được tới roster nguyên trạng", () => {
  // Chốt chặn đặt ở `GameRoom.join` chứ không chỉ ở tầng xác thực, vì hai trong ba đường vào KHÔNG
  // qua xác thực: WS `join` không ticket lấy thẳng `msg.name`, và `game-tickets/guest` lấy
  // `body.displayName`. Bài này giữ đúng chốt đó — nó đọc `roster()`, tức thứ người khác THẬT SỰ thấy.
  const room = () => new GameRoom(4, 0);

  it("tên có từ cấm bị THAY, không lọt vào roster", () => {
    const r = room();
    const id = r.join("fuck")!;
    expect(r.roster().find((p) => p.id === id)!.name).not.toBe("fuck");
  });

  it("bắt được cả bản đã lách bằng ký tự vô hình và chữ nhìn giống nhau", () => {
    const r = room();
    for (const bad of ["f\u200Buck", "\u0455h\u0456t", "5h1t"]) {
      const id = r.join(bad)!;
      const shown = r.roster().find((p) => p.id === id)!.name;
      expect(shown, bad).not.toBe(bad);
    }
  });

  it("tên tiếng Việt bình thường đi qua nguyên vẹn", () => {
    const r = room();
    const id = r.join("Nguyễn Bảo Ngọc")!;
    expect(r.roster().find((p) => p.id === id)!.name).toBe("Nguyễn Bảo Ngọc");
  });

  it("tên rỗng vẫn ra một tên dùng được, và tên quá dài bị cắt", () => {
    const r = room();
    const a = r.join("")!;
    expect(r.roster().find((p) => p.id === a)!.name.length).toBeGreaterThan(0);
    const b = r.join("x".repeat(200))!;
    expect(r.roster().find((p) => p.id === b)!.name.length).toBeLessThanOrEqual(32);
  });
});
