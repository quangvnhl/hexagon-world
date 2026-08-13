import { createHash } from "node:crypto";

export type ServerRole = "all" | "control" | "game";

function text(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function integer(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} phải là số nguyên dương`);
  return value;
}

function secret(name: string, required: boolean): string {
  const value = text(name);
  if (required && (!value || value.startsWith("YOUR_") || value.startsWith("REPLACE_"))) {
    throw new Error(`Thiếu biến môi trường bí mật ${name}`);
  }
  return value;
}

function optionalSecret(name: string): string {
  const value = text(name);
  return !value || value.startsWith("YOUR_") || value.startsWith("REPLACE_") ? "" : value;
}

export interface RegionConfig {
  id: string;
  name: string;
  wsUrl: string;
  pingUrl: string;
}

export interface RuntimeConfig {
  role: ServerRole;
  port: number;
  region: string;
  controlPlaneUrl: string;
  supabaseUrl: string;
  supabaseKey: string;
  sessionSecret: string;
  sessionTtlSeconds: number;
  cookieSecure: boolean;
  corsAllowedOrigins: string[];
  google: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    postLoginRedirectUri: string;
    scopes: string;
    stateSecret: string;
    stateTtlSeconds: number;
  };
  telegram: {
    botToken: string;
    initDataMaxAgeSeconds: number;
    webhookSecret: string;
    starsEnabled: boolean;
  };
  ticket: {
    privateKeyBase64: string;
    publicKeyBase64: string;
    ttlSeconds: number;
  };
  adminApiKeyHash: string;
  gameResultSecret: string;
  gameResultSpoolDir: string;
  matchRetentionDays: number;
  defaultAssets: { color: string; shape: string; trail: string };
  regions: RegionConfig[];
}

let cached: RuntimeConfig | null = null;

export function runtimeConfig(): RuntimeConfig {
  if (cached) return cached;
  const role = text("SERVER_ROLE", "all") as ServerRole;
  if (!(["all", "control", "game"] as const).includes(role)) throw new Error("SERVER_ROLE không hợp lệ");
  const control = role !== "game";
  const game = role !== "control";
  const supabaseKey = text("SUPABASE_SECRET_KEY") || text("SUPABASE_SERVICE_ROLE_KEY");
  const sessionSecret = secret("PLAYER_SESSION_SECRET", control);
  const gameResultSecret = optionalSecret("GAME_RESULT_SECRET") || (role === "all" ? sessionSecret : "");
  const regionsRaw = text("GAME_REGIONS_JSON");
  let regions: RegionConfig[] = [];
  if (regionsRaw) {
    try { regions = JSON.parse(regionsRaw) as RegionConfig[]; }
    catch { throw new Error("GAME_REGIONS_JSON không phải JSON hợp lệ"); }
  }
  if (!regions.length) {
    regions = [{ id: text("GAME_REGION", "local"), name: "Local", wsUrl: text("GAME_PUBLIC_WS_URL", "ws://localhost:8910/game"), pingUrl: text("GAME_PUBLIC_PING_URL", "http://localhost:8910/health/ping") }];
  }
  cached = {
    role,
    port: integer("PORT", 8910),
    region: text("GAME_REGION", "local"),
    controlPlaneUrl: text("CONTROL_PLANE_URL", "http://localhost:8910"),
    supabaseUrl: control ? secret("SUPABASE_URL", true) : text("SUPABASE_URL"),
    supabaseKey: control ? (supabaseKey || (() => { throw new Error("Thiếu SUPABASE_SECRET_KEY"); })()) : supabaseKey,
    sessionSecret,
    sessionTtlSeconds: integer("PLAYER_SESSION_TTL_SECONDS", 86400),
    cookieSecure: text("NODE_ENV") === "production",
    corsAllowedOrigins: text("CORS_ALLOWED_ORIGINS", new URL(text("GOOGLE_OAUTH_POST_LOGIN_REDIRECT_URI", "http://localhost:3890")).origin)
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    google: {
      clientId: secret("GOOGLE_OAUTH_CLIENT_ID", control),
      clientSecret: secret("GOOGLE_OAUTH_CLIENT_SECRET", control),
      redirectUri: text("GOOGLE_OAUTH_REDIRECT_URI", "http://localhost:8910/v1/auth/web/google/callback"),
      postLoginRedirectUri: text("GOOGLE_OAUTH_POST_LOGIN_REDIRECT_URI", "http://localhost:3890"),
      scopes: text("GOOGLE_OAUTH_SCOPES", "openid email profile"),
      stateSecret: secret("GOOGLE_OAUTH_STATE_SECRET", control),
      stateTtlSeconds: integer("GOOGLE_OAUTH_STATE_TTL_SECONDS", 600),
    },
    telegram: {
      botToken: secret("TELEGRAM_BOT_TOKEN", control),
      initDataMaxAgeSeconds: integer("TELEGRAM_INIT_DATA_MAX_AGE_SECONDS", 86400),
      webhookSecret: secret("TELEGRAM_WEBHOOK_SECRET", control),
      starsEnabled: text("TELEGRAM_STARS_ENABLED", "true") === "true",
    },
    ticket: {
      privateKeyBase64: optionalSecret("REGION_TICKET_PRIVATE_KEY_BASE64"),
      publicKeyBase64: optionalSecret("REGION_TICKET_PUBLIC_KEY_BASE64"),
      ttlSeconds: integer("REGION_TICKET_TTL_SECONDS", 60),
    },
    adminApiKeyHash: optionalSecret("ADMIN_API_KEY_SHA256"),
    gameResultSecret,
    gameResultSpoolDir: text("GAME_RESULT_SPOOL_DIR", "./data/match-results"),
    matchRetentionDays: integer("MATCH_HISTORY_RETENTION_DAYS", 30),
    defaultAssets: {
      color: text("DEFAULT_FREE_COLOR_ASSET_KEY", "color:0"),
      shape: text("DEFAULT_FREE_SHAPE_ASSET_KEY", "shape:cube"),
      trail: text("DEFAULT_FREE_TRAIL_ASSET_KEY", "trail:solid"),
    },
    regions,
  };
  if (game && role === "game" && !cached.ticket.publicKeyBase64) {
    throw new Error("Game server production cần REGION_TICKET_PUBLIC_KEY_BASE64");
  }
  if (role !== "all" && !cached.gameResultSecret) throw new Error("Deployment tách riêng cần GAME_RESULT_SECRET");
  return cached;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function resetRuntimeConfigForTests(): void { cached = null; }
