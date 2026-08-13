import { describe, expect, it } from "vitest";
import { hasTelegramMiniAppInitData } from "../../lib/telegram";

describe("Telegram platform gate", () => {
  const valid = new URLSearchParams({
    auth_date: "1786600000",
    user: JSON.stringify({ id: 42, first_name: "Hex" }),
    hash: "a".repeat(64),
  }).toString();

  it("chỉ nhận initData có đủ trường Mini App bắt buộc", () => {
    expect(hasTelegramMiniAppInitData(valid)).toBe(true);
  });

  it.each([
    "",
    "auth_date=1786600000&user=%7B%22id%22%3A42%7D",
    "auth_date=1786600000&hash=abc",
    "user=%7B%22id%22%3A42%7D&hash=abc",
  ])("từ chối browser stub hoặc initData thiếu trường: %s", (initData) => {
    expect(hasTelegramMiniAppInitData(initData)).toBe(false);
  });
});
