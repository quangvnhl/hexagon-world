// Test phần THUẦN của db-migrate (doc 36 R3). Không chạm database — chạy được ở CI không secret.
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseEnvFile,
  checksumOf,
  versionOf,
  planMigrations,
  redactDbUrl,
  projectRefOf,
  parseArgs,
  targetGuard,
} from "./db-migrate.mjs";

test("parseEnvFile: bỏ chú thích/dòng trống, giữ nguyên giá trị có dấu =", () => {
  const env = parseEnvFile([
    "# chú thích",
    "",
    "SUPABASE_URL=https://abc.supabase.co",
    "SUPABASE_DB_URL=postgresql://postgres:p@ss=word@host:5432/postgres",
    "  SPACED  =  value  ",
    "KHONG_CO_DAU_BANG",
  ].join("\n"));
  assert.equal(env.SUPABASE_URL, "https://abc.supabase.co");
  // Mật khẩu có dấu '=' vẫn phải nguyên vẹn — chỉ cắt ở dấu '=' ĐẦU TIÊN.
  assert.equal(env.SUPABASE_DB_URL, "postgresql://postgres:p@ss=word@host:5432/postgres");
  assert.equal(env.SPACED, "value");
  assert.equal(env.KHONG_CO_DAU_BANG, undefined);
});

test("checksumOf: đổi một ký tự là đổi checksum", () => {
  assert.notEqual(checksumOf("create table a();"), checksumOf("create table b();"));
  assert.equal(checksumOf("x"), checksumOf("x"));
});

test("versionOf: bỏ đuôi .sql", () => {
  assert.equal(versionOf("202608120001_player_backend.sql"), "202608120001_player_backend");
});

test("planMigrations: chỉ lấy phần CHƯA áp, giữ đúng thứ tự", () => {
  const files = [
    { version: "001", checksum: "a" },
    { version: "002", checksum: "b" },
    { version: "003", checksum: "c" },
  ];
  const { pending, drifted } = planMigrations(files, new Map([["001", "a"]]));
  assert.deepEqual(pending.map((f) => f.version), ["002", "003"]);
  assert.deepEqual(drifted, []);
});

test("planMigrations: migration ĐÃ ÁP bị sửa nội dung ⇒ báo drifted", () => {
  const files = [{ version: "001", checksum: "MỚI" }];
  const { pending, drifted } = planMigrations(files, new Map([["001", "CŨ"]]));
  assert.deepEqual(pending, []);
  assert.equal(drifted.length, 1);
  assert.equal(drifted[0].version, "001");
});

test("planMigrations: database trống ⇒ áp tất cả", () => {
  const files = [{ version: "001", checksum: "a" }, { version: "002", checksum: "b" }];
  assert.equal(planMigrations(files, new Map()).pending.length, 2);
});

test("redactDbUrl: che mật khẩu, giữ host để biết đang nối tới đâu", () => {
  const out = redactDbUrl("postgresql://postgres:sieubimat@db.abc.supabase.co:5432/postgres");
  assert.ok(!out.includes("sieubimat"), "mật khẩu KHÔNG được lọt ra log");
  assert.ok(out.includes("db.abc.supabase.co"), "vẫn phải thấy host");
  assert.equal(redactDbUrl(undefined), "(trống)");
});

test("projectRefOf: rút ref từ URL Supabase", () => {
  assert.equal(projectRefOf("https://abcdefg.supabase.co"), "abcdefg");
  assert.equal(projectRefOf("http://localhost:54321"), "(không xác định)");
  assert.equal(projectRefOf(undefined), "(không xác định)");
});

test("parseArgs: mặc định an toàn (staging, không ghi)", () => {
  const a = parseArgs([]);
  assert.equal(a.target, "staging");
  assert.equal(a.envFile, ".env");
  assert.equal(a.dryRun, false);
  assert.equal(a.yes, false, "KHÔNG được mặc định ghi — phải có --yes");
  assert.equal(a.baseline, null);
});

test("parseArgs: đọc đủ cờ", () => {
  const a = parseArgs(["--target", "production", "--env-file", "deploy/x.env", "--dry-run", "--yes", "--baseline", "001_x"]);
  assert.deepEqual(a, { target: "production", envFile: "deploy/x.env", dryRun: true, yes: true, baseline: "001_x" });
});

test("targetGuard: staging luôn cho, production TỪ CHỐI khi thiếu biến xác nhận", () => {
  assert.equal(targetGuard("staging", {}), null);
  assert.match(targetGuard("production", {}), /TỪ CHỐI/);
  assert.match(targetGuard("production", { ALLOW_PRODUCTION_MIGRATE: "true" }), /TỪ CHỐI/);
  assert.equal(targetGuard("production", { ALLOW_PRODUCTION_MIGRATE: "yes-i-know" }), null);
});

test("targetGuard: target lạ bị từ chối", () => {
  assert.match(targetGuard("prod", {}), /không hợp lệ/);
  assert.match(targetGuard("", {}), /không hợp lệ/);
});
