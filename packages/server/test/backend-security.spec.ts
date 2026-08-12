import { afterEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { TicketService } from "../src/regions/ticket.service";
import { resetRuntimeConfigForTests } from "../src/runtime-config";
import { verifyTelegramInitData } from "../src/auth/telegram-auth.controller";

const ENV_KEYS = ["SERVER_ROLE","PORT","SUPABASE_URL","SUPABASE_SECRET_KEY","PLAYER_SESSION_SECRET","GOOGLE_OAUTH_CLIENT_ID","GOOGLE_OAUTH_CLIENT_SECRET","GOOGLE_OAUTH_STATE_SECRET","TELEGRAM_BOT_TOKEN","TELEGRAM_WEBHOOK_SECRET","GAME_REGION"];
const previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

function localEnv() {
  Object.assign(process.env, { SERVER_ROLE: "all", PORT: "8910", SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "test-secret-key", PLAYER_SESSION_SECRET: "01234567890123456789012345678901", GOOGLE_OAUTH_CLIENT_ID: "test.apps.googleusercontent.com", GOOGLE_OAUTH_CLIENT_SECRET: "google-secret", GOOGLE_OAUTH_STATE_SECRET: "01234567890123456789012345678901", TELEGRAM_BOT_TOKEN: "bot-token", TELEGRAM_WEBHOOK_SECRET: "webhook-secret", GAME_REGION: "local" });
  resetRuntimeConfigForTests();
}

afterEach(() => {
  for (const [key, value] of previous) value === undefined ? delete process.env[key] : process.env[key] = value;
  resetRuntimeConfigForTests();
});

describe("backend security contracts", () => {
  it("ký và xác minh regional ticket, từ chối sai vùng", () => {
    localEnv();
    const service = new TicketService();
    const token = service.issue({ playerId: null, guestId: "guest_1234567890123456", isGuest: true, platform: "web", displayName: "Guest", region: "local", appearance: { colorIndex: 0, shape: "cube", trailPattern: "solid" } });
    expect(service.verify(token, "local").guestId).toBe("guest_1234567890123456");
    expect(() => service.verify(token, "sg")).toThrow();
  });

  it("xác minh Telegram initData bằng chữ ký và auth_date", () => {
    const botToken = "123:test-token";
    const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: "query", user: JSON.stringify({ id: 42, first_name: "An" }) });
    const check = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join("\n");
    const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
    params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
    expect(verifyTelegramInitData(params.toString(), botToken, 60).id).toBe(42);
    params.set("hash", "00".repeat(32));
    expect(() => verifyTelegramInitData(params.toString(), botToken, 60)).toThrow();
  });
});
