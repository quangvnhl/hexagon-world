import { describe, expect, it } from "vitest";
import { serverPingUrl } from "../serverPing";

describe("serverPingUrl", () => {
  it("maps a local WebSocket host to its HTTP health endpoint", () => {
    expect(serverPingUrl("ws://localhost:8910")).toBe("http://localhost:8910/health/ping");
  });

  it("replaces the game path and keeps TLS", () => {
    expect(serverPingUrl("wss://beeking.ws.cukinacha.com/game?ticket=old"))
      .toBe("https://beeking.ws.cukinacha.com/health/ping");
  });

  it("rejects unrelated protocols", () => {
    expect(() => serverPingUrl("ftp://localhost/game")).toThrow("unsupported_server_protocol");
  });
});
