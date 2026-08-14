import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { auditRelease, parseEnv } from "./release-gate.mjs";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
// TicketService decodes Base64 first, then passes PEM bytes to node:crypto.
const privateKeyBase64 = Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64");
const publicKeyBase64 = Buffer.from(publicKey.export({ type: "spki", format: "pem" })).toString("base64");
const sharedSecret = "g".repeat(32);

function releaseSet(overrides = {}) {
  const controlEnv = {
    NODE_ENV: "production", SERVER_ROLE: "control",
    SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_real",
    PLAYER_SESSION_SECRET: "s".repeat(32), GOOGLE_OAUTH_CLIENT_ID: "id.apps.googleusercontent.com",
    GOOGLE_OAUTH_CLIENT_SECRET: "google-real-secret", GOOGLE_OAUTH_REDIRECT_URI: "https://api.staging.test/v1/auth/web/google/callback",
    GOOGLE_OAUTH_POST_LOGIN_REDIRECT_URI: "https://staging.test", GOOGLE_OAUTH_STATE_SECRET: "o".repeat(32),
    TELEGRAM_BOT_TOKEN: "123:real-token", TELEGRAM_WEBHOOK_SECRET: "telegram-real-secret",
    REGION_TICKET_PRIVATE_KEY_BASE64: privateKeyBase64, GAME_RESULT_SECRET: sharedSecret,
    ADMIN_API_KEY_SHA256: "a".repeat(64), CORS_ALLOWED_ORIGINS: "https://staging.test",
    GAME_REGIONS_JSON: JSON.stringify([{ id: "sg", name: "Singapore", wsUrl: "wss://sg.staging.test/game", pingUrl: "https://sg.staging.test/health/ping" }]),
    ...overrides.control,
  };
  const gameEnv = {
    NODE_ENV: "production", SERVER_ROLE: "game", GAME_REGION: "sg",
    CONTROL_PLANE_URL: "https://api.staging.test", REGION_TICKET_PUBLIC_KEY_BASE64: publicKeyBase64,
    GAME_RESULT_SECRET: sharedSecret, GAME_RESULT_SPOOL_DIR: "/app/data/match-results", GAME_PROTOCOL_VERSION: "4",
    ...overrides.game,
  };
  return {
    target: "staging", expectedProtocolVersion: 4,
    control: { label: "control.env", env: controlEnv, duplicates: [] },
    games: [{ label: "game-sg.env", env: gameEnv, duplicates: [] }],
  };
}

test("parseEnv detects duplicate variables without exposing values", () => {
  const parsed = parseEnv("SERVER_ROLE=control\nSECRET=one\nSECRET=two\n");
  assert.deepEqual(parsed.duplicates, ["SECRET"]);
  assert.equal(parsed.values.SECRET, "two");
});

test("accepts a split-role release set with matching keys and protocol", () => {
  const result = auditRelease(releaseSet());
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("rejects placeholders, localhost URLs and role all", () => {
  const input = releaseSet({ control: {
    SERVER_ROLE: "all", SUPABASE_SECRET_KEY: "REPLACE_ME",
    GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:8910/v1/auth/web/google/callback",
  } });
  const result = auditRelease(input);
  assert.equal(result.ok, false);
  assert(result.errors.some((item) => item.includes("SERVER_ROLE")));
  assert(result.errors.some((item) => item.includes("SUPABASE_SECRET_KEY")));
  assert(result.errors.some((item) => item.includes("GOOGLE_OAUTH_REDIRECT_URI")));
  assert.equal(result.errors.join("\n").includes("REPLACE_ME"), false);
});

test("rejects control secrets on game nodes and protocol drift", () => {
  const result = auditRelease(releaseSet({ game: {
    SUPABASE_SECRET_KEY: "must-not-reach-game", GAME_PROTOCOL_VERSION: "3",
  } }));
  assert.equal(result.ok, false);
  assert(result.errors.some((item) => item.includes("SUPABASE_SECRET_KEY")));
  assert(result.errors.some((item) => item.includes("GAME_PROTOCOL_VERSION")));
});

test("rejects a game public key that does not match control private key", () => {
  const otherPem = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" });
  const other = Buffer.from(otherPem).toString("base64");
  const result = auditRelease(releaseSet({ game: { REGION_TICKET_PUBLIC_KEY_BASE64: other } }));
  assert.equal(result.ok, false);
  assert(result.errors.some((item) => item.includes("không khớp private key")));
});
