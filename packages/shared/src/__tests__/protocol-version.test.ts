import { describe, expect, it } from "vitest";
import {
  GAME_PROTOCOL_VERSION,
  MIN_SUPPORTED_GAME_PROTOCOL,
  isProtocolSupported,
} from "../protocol-version";

/**
 * doc 35 §C5 — cửa sổ tương thích protocol.
 *
 * Bài đắt nhất ở đây là bài CUỐI: nó giữ cho `MIN` không bao giờ vượt lên trên `CURRENT`. Một cửa
 * sổ đảo ngược thì `isProtocolSupported` trả false với MỌI giá trị — tức server từ chối cả chính
 * client cùng bản với nó, và triệu chứng là "không ai vào được phòng" chứ không phải một lỗi rõ.
 */
describe("isProtocolSupported", () => {
  it("nhận đúng phiên bản hiện tại", () => {
    expect(isProtocolSupported(GAME_PROTOCOL_VERSION)).toBe(true);
  });

  it("nhận mọi phiên bản TRONG cửa sổ", () => {
    for (let v = MIN_SUPPORTED_GAME_PROTOCOL; v <= GAME_PROTOCOL_VERSION; v++) {
      expect(isProtocolSupported(v), `v${v}`).toBe(true);
    }
  });

  it("từ chối bản CŨ hơn cửa sổ và bản MỚI hơn server", () => {
    expect(isProtocolSupported(MIN_SUPPORTED_GAME_PROTOCOL - 1)).toBe(false);
    // Client mới hơn server là chuyện có thật khi rollback server mà client đã phát hành.
    expect(isProtocolSupported(GAME_PROTOCOL_VERSION + 1)).toBe(false);
  });

  it("giá trị rác ⇒ từ chối, không ném", () => {
    for (const bad of [undefined, null, NaN, "6", 6.5, Infinity, {}]) {
      expect(isProtocolSupported(bad as unknown), String(bad)).toBe(false);
    }
  });

  it("cửa sổ tuỳ ý: nhận [min..current], loại phần ngoài", () => {
    expect(isProtocolSupported(4, 6, 4)).toBe(true);
    expect(isProtocolSupported(5, 6, 4)).toBe(true);
    expect(isProtocolSupported(3, 6, 4)).toBe(false);
  });

  it("MIN không bao giờ được vượt CURRENT", () => {
    expect(MIN_SUPPORTED_GAME_PROTOCOL).toBeLessThanOrEqual(GAME_PROTOCOL_VERSION);
  });
});
