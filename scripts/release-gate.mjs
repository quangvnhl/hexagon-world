#!/usr/bin/env node

import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = /(?:^|[_-])(YOUR|REPLACE|CHANGEME)(?:[_-]|$)|example\.(?:com|org|net)/i;
const SECRET_NAMES = new Set([
  "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL",
  "PLAYER_SESSION_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_STATE_SECRET",
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "REGION_TICKET_PRIVATE_KEY_BASE64",
  "ADMIN_API_KEY_SHA256", "GAME_RESULT_SECRET",
]);
const GAME_FORBIDDEN_SECRETS = [
  "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL",
  "PLAYER_SESSION_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_STATE_SECRET",
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "REGION_TICKET_PRIVATE_KEY_BASE64",
  "ADMIN_API_KEY_SHA256",
];

export function parseEnv(source, label = "env") {
  const values = {};
  const duplicates = [];
  for (const [index, rawLine] of source.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) throw new Error(`${label}:${index + 1}: dòng env không hợp lệ`);
    const [, name, rawValue] = match;
    if (Object.hasOwn(values, name)) duplicates.push(name);
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[name] = value;
  }
  return { values, duplicates: [...new Set(duplicates)] };
}

function add(errors, label, variable, message) {
  errors.push(`${label}: ${variable} ${message}`);
}

function required(errors, env, label, names) {
  for (const name of names) {
    const value = env[name]?.trim();
    if (!value) add(errors, label, name, "bị thiếu hoặc rỗng");
    else if (PLACEHOLDER.test(value)) add(errors, label, name, "vẫn chứa placeholder");
  }
}

function publicUrl(errors, env, label, name, protocol, expectedPath) {
  const raw = env[name]?.trim();
  if (!raw || PLACEHOLDER.test(raw)) return;
  try {
    const url = new URL(raw);
    if (url.protocol !== protocol) add(errors, label, name, `phải dùng ${protocol}`);
    if (url.username || url.password) add(errors, label, name, "không được chứa credentials");
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "0.0.0.0" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".local")) {
      add(errors, label, name, "không được trỏ tới localhost/private development host");
    }
    if (expectedPath && url.pathname !== expectedPath) add(errors, label, name, `phải có path chính xác ${expectedPath}`);
  } catch {
    add(errors, label, name, "không phải URL hợp lệ");
  }
}

function validateSecretShape(errors, env, label) {
  for (const name of SECRET_NAMES) {
    const value = env[name]?.trim();
    if (value && PLACEHOLDER.test(value)) add(errors, label, name, "vẫn chứa placeholder");
  }
  for (const name of ["PLAYER_SESSION_SECRET", "GOOGLE_OAUTH_STATE_SECRET", "GAME_RESULT_SECRET"]) {
    const value = env[name]?.trim();
    if (value && Buffer.byteLength(value, "utf8") < 32) add(errors, label, name, "phải dài tối thiểu 32 byte");
  }
  const hash = env.ADMIN_API_KEY_SHA256?.trim();
  if (hash && !PLACEHOLDER.test(hash) && !/^[a-f0-9]{64}$/.test(hash)) {
    add(errors, label, "ADMIN_API_KEY_SHA256", "phải là SHA-256 lowercase gồm 64 ký tự hex");
  }
}

function readProtocolVersion(projectRoot) {
  const source = readFileSync(resolve(projectRoot, "packages/shared/src/protocol-version.ts"), "utf8");
  const match = /GAME_PROTOCOL_VERSION\s*=\s*(\d+)/.exec(source);
  if (!match) throw new Error("Không đọc được GAME_PROTOCOL_VERSION từ shared source");
  return Number(match[1]);
}

function keyFingerprint(base64, kind) {
  const key = kind === "private"
    ? createPrivateKey(Buffer.from(base64, "base64"))
    : createPublicKey(Buffer.from(base64, "base64"));
  const publicKey = kind === "private" ? createPublicKey(key) : key;
  return publicKey.export({ type: "spki", format: "der" }).toString("base64");
}

export function auditRelease({ target, control, games, expectedProtocolVersion }) {
  const errors = [];
  const warnings = [];
  if (target !== "staging" && target !== "production") errors.push(`target: chỉ chấp nhận staging hoặc production`);
  const configs = [control, ...games];
  for (const config of configs) {
    if (config.duplicates?.length) errors.push(`${config.label}: biến bị khai báo lặp: ${config.duplicates.join(", ")}`);
    if (config.env.NODE_ENV !== "production") add(errors, config.label, "NODE_ENV", "phải là production");
    if (config.env.SERVER_ROLE === "all") add(errors, config.label, "SERVER_ROLE", "không được dùng all ngoài local/test");
    validateSecretShape(errors, config.env, config.label);
  }

  if (control.env.SERVER_ROLE !== "control") add(errors, control.label, "SERVER_ROLE", "phải là control");
  required(errors, control.env, control.label, [
    "SUPABASE_URL", "SUPABASE_SECRET_KEY", "PLAYER_SESSION_SECRET",
    "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI",
    "GOOGLE_OAUTH_POST_LOGIN_REDIRECT_URI", "GOOGLE_OAUTH_STATE_SECRET", "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET", "REGION_TICKET_PRIVATE_KEY_BASE64", "GAME_RESULT_SECRET",
    "ADMIN_API_KEY_SHA256", "GAME_REGIONS_JSON", "CORS_ALLOWED_ORIGINS",
  ]);
  publicUrl(errors, control.env, control.label, "SUPABASE_URL", "https:");
  publicUrl(errors, control.env, control.label, "GOOGLE_OAUTH_REDIRECT_URI", "https:", "/v1/auth/web/google/callback");
  publicUrl(errors, control.env, control.label, "GOOGLE_OAUTH_POST_LOGIN_REDIRECT_URI", "https:");

  for (const origin of (control.env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean)) {
    try {
      const url = new URL(origin);
      if (url.protocol !== "https:" || url.origin !== origin || url.pathname !== "/") {
        add(errors, control.label, "CORS_ALLOWED_ORIGINS", `chỉ được chứa HTTPS origin không có path (${origin})`);
      }
    } catch { add(errors, control.label, "CORS_ALLOWED_ORIGINS", "chứa origin không hợp lệ"); }
  }

  let regions = [];
  if (control.env.GAME_REGIONS_JSON && !PLACEHOLDER.test(control.env.GAME_REGIONS_JSON)) {
    try {
      regions = JSON.parse(control.env.GAME_REGIONS_JSON);
      if (!Array.isArray(regions) || !regions.length) throw new Error();
      const ids = new Set();
      for (const [index, region] of regions.entries()) {
        const prefix = `GAME_REGIONS_JSON[${index}]`;
        if (!region || typeof region !== "object" || !region.id || !region.name) add(errors, control.label, prefix, "phải có id và name");
        if (!region?.wsUrl) add(errors, control.label, `${prefix}.wsUrl`, "bị thiếu hoặc rỗng");
        if (!region?.pingUrl) add(errors, control.label, `${prefix}.pingUrl`, "bị thiếu hoặc rỗng");
        if (ids.has(region?.id)) add(errors, control.label, prefix, "có region id trùng");
        ids.add(region?.id);
        publicUrl(errors, { WS: region?.wsUrl }, control.label, "WS", "wss:", "/game");
        publicUrl(errors, { PING: region?.pingUrl }, control.label, "PING", "https:", "/health/ping");
      }
    } catch { add(errors, control.label, "GAME_REGIONS_JSON", "phải là JSON array không rỗng"); }
  }

  let privateFingerprint = "";
  const privateKey = control.env.REGION_TICKET_PRIVATE_KEY_BASE64;
  if (privateKey && !PLACEHOLDER.test(privateKey)) {
    try { privateFingerprint = keyFingerprint(privateKey, "private"); }
    catch { add(errors, control.label, "REGION_TICKET_PRIVATE_KEY_BASE64", "không phải private key PKCS8 Base64 hợp lệ"); }
  }

  const seenGameRegions = new Set();
  for (const game of games) {
    if (game.env.SERVER_ROLE !== "game") add(errors, game.label, "SERVER_ROLE", "phải là game");
    required(errors, game.env, game.label, [
      "GAME_REGION", "CONTROL_PLANE_URL", "REGION_TICKET_PUBLIC_KEY_BASE64",
      "GAME_RESULT_SECRET", "GAME_RESULT_SPOOL_DIR", "GAME_PROTOCOL_VERSION",
    ]);
    for (const name of GAME_FORBIDDEN_SECRETS) {
      if (game.env[name]?.trim()) add(errors, game.label, name, "không được cấp cho game node");
    }
    publicUrl(errors, game.env, game.label, "CONTROL_PLANE_URL", "https:");
    const region = game.env.GAME_REGION?.trim();
    if (region && seenGameRegions.has(region)) add(errors, game.label, "GAME_REGION", "bị trùng trong release set");
    seenGameRegions.add(region);
    if (region && regions.length && !regions.some((item) => item?.id === region)) add(errors, game.label, "GAME_REGION", "không có trong control GAME_REGIONS_JSON");
    if (Number(game.env.GAME_PROTOCOL_VERSION) !== expectedProtocolVersion) {
      add(errors, game.label, "GAME_PROTOCOL_VERSION", `phải khớp shared/client version ${expectedProtocolVersion}`);
    }
    if (game.env.GAME_RESULT_SECRET && control.env.GAME_RESULT_SECRET && game.env.GAME_RESULT_SECRET !== control.env.GAME_RESULT_SECRET) {
      add(errors, game.label, "GAME_RESULT_SECRET", "không khớp control plane");
    }
    const publicKey = game.env.REGION_TICKET_PUBLIC_KEY_BASE64;
    if (publicKey && !PLACEHOLDER.test(publicKey)) {
      try {
        const fingerprint = keyFingerprint(publicKey, "public");
        if (privateFingerprint && fingerprint !== privateFingerprint) add(errors, game.label, "REGION_TICKET_PUBLIC_KEY_BASE64", "không khớp private key của control plane");
      } catch { add(errors, game.label, "REGION_TICKET_PUBLIC_KEY_BASE64", "không phải public key SPKI Base64 hợp lệ"); }
    }
  }
  if (!games.length) errors.push("release set: cần ít nhất một game node");
  for (const region of regions) {
    if (region?.id && !seenGameRegions.has(region.id)) warnings.push(`control: region ${region.id} chưa có file game env trong lần kiểm tra này`);
  }
  return { ok: errors.length === 0, errors, warnings, expectedProtocolVersion };
}

function usage() {
  return "node scripts/release-gate.mjs --target <staging|production> --control <control.env> --game <game.env> [--game <game-2.env>]";
}

function parseArgs(argv) {
  const result = { games: [] };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]; const value = argv[index + 1];
    if (!value) throw new Error(`Thiếu giá trị cho ${flag}\n${usage()}`);
    if (flag === "--target") result.target = value;
    else if (flag === "--control") result.control = value;
    else if (flag === "--game") result.games.push(value);
    else throw new Error(`Tham số không hỗ trợ: ${flag}\n${usage()}`);
  }
  if (!result.target || !result.control || !result.games.length) throw new Error(usage());
  return result;
}

export function runCli(argv, projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)))) {
  const args = parseArgs(argv);
  const load = (path) => {
    const absolute = resolve(projectRoot, path);
    const parsed = parseEnv(readFileSync(absolute, "utf8"), path);
    return { label: path, env: parsed.values, duplicates: parsed.duplicates };
  };
  const result = auditRelease({
    target: args.target,
    control: load(args.control),
    games: args.games.map(load),
    expectedProtocolVersion: readProtocolVersion(projectRoot),
  });
  for (const warning of result.warnings) console.warn(`WARN ${warning}`);
  for (const error of result.errors) console.error(`FAIL ${error}`);
  if (!result.ok) return 1;
  console.log(`PASS release gate ${args.target}: control + ${args.games.length} game node(s), protocol v${result.expectedProtocolVersion}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = runCli(process.argv.slice(2)); }
  catch (error) { console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
}
