// Test phần THUẦN của db-seed (doc 36 §R3, lát r3.2). Không chạm database — chạy được ở CI không secret.
//
// Ba thứ đáng giữ ở đây, mỗi thứ vì một cách hỏng thật:
//  1. Cổng target: gõ nhầm `--target production` phải bị TỪ CHỐI, và phải từ chối kể cả khi người
//     gõ thêm `--yes`.
//  2. Mặc định KHÔNG ghi: chạy trần `node scripts/db-seed.mjs` phải là không-làm-gì.
//  3. Bản đếm: `delta 0` là kết quả HỢP LỆ và phải hiện ra được, vì đó chính là bằng chứng
//     idempotent — một bản in nuốt mất số 0 sẽ làm người ta tưởng seed không chạy.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COUNTED_TABLES, diffCounts, formatCounts, parseArgs } from "./db-seed.mjs";
import { targetGuard } from "./db-migrate.mjs";

test("parseArgs: mặc định staging, không ghi gì", () => {
  const a = parseArgs([]);
  assert.equal(a.target, "staging");
  assert.equal(a.dryRun, false);
  assert.equal(a.yes, false);
  assert.equal(a.envFile, ".env");
});

test("parseArgs: đọc đủ cờ", () => {
  const a = parseArgs(["--target", "staging", "--env-file", "deploy/staging.env", "--dry-run", "--yes"]);
  assert.deepEqual(a, { target: "staging", envFile: "deploy/staging.env", dryRun: true, yes: true });
});

test("cổng target: production bị từ chối, --yes KHÔNG mở được", () => {
  // Bài đắt nhất trong file. db-seed dùng lại `targetGuard` của db-migrate thay vì chép sang —
  // bài này giữ đúng cái ràng buộc đó: nếu ai đó gỡ import và tự viết lại, nó đỏ.
  assert.equal(targetGuard("staging", {}), null);
  assert.match(targetGuard("production", {}), /TỪ CHỐI/);
  assert.match(targetGuard("prod", {}), /không hợp lệ/);
  // `--yes` là cờ của script, không phải biến môi trường — nó không có đường nào chạm tới cổng này.
  assert.match(targetGuard("production", { yes: true }), /TỪ CHỐI/);
});

test("diffCounts: delta 0 vẫn là một hàng trong báo cáo", () => {
  // Chạy seed lần thứ hai ra đúng cảnh này: mọi bảng delta 0. Nếu bản in bỏ qua chúng, người đọc
  // sẽ tưởng seed không chạy — mà thật ra nó chạy và cập nhật đúng những hàng cũ.
  const same = Object.fromEntries(COUNTED_TABLES.map((t) => [t, 7]));
  const rows = diffCounts(same, same);
  assert.equal(rows.length, COUNTED_TABLES.length);
  assert.ok(rows.every((r) => r.delta === 0));
  assert.match(formatCounts(rows), /\(0\)/);
});

test("diffCounts: bảng chưa có trong bản đếm coi như 0, không phải NaN", () => {
  const rows = diffCounts({}, { players: 2 });
  const players = rows.find((r) => r.table === "players");
  assert.deepEqual({ before: players.before, after: players.after, delta: players.delta }, { before: 0, after: 2, delta: 2 });
  assert.ok(rows.every((r) => Number.isFinite(r.delta)));
});

test("seed.sql: không có câu xoá nào", () => {
  // AGENTS.md §1 cấm xoá dữ liệu người chơi. Một seed "dọn trước rồi ghi" là seed sẽ có ngày xoá
  // nhầm người thật, nên luật đó được giữ bằng test chứ không chỉ bằng lời hứa trong chú thích.
  const sql = readFileSync(new URL("../supabase/seed.sql", import.meta.url), "utf8");
  const code = sql.split(/\r?\n/).filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(!/\bdelete\s+from\b/i.test(code), "seed.sql chứa DELETE FROM");
  assert.ok(!/\btruncate\b/i.test(code), "seed.sql chứa TRUNCATE");
  assert.ok(!/\bdrop\s+(table|schema)\b/i.test(code), "seed.sql chứa DROP");
});

test("seed.sql: mọi insert đều có on conflict", () => {
  // Idempotent theo khoá tự nhiên là yêu cầu của lát này. Một `insert` quên `on conflict` sẽ chạy
  // được lần đầu rồi vỡ ở lần thứ hai — tức hỏng đúng lúc không ai đang nhìn.
  const sql = readFileSync(new URL("../supabase/seed.sql", import.meta.url), "utf8");
  const code = sql.split(/\r?\n/).filter((l) => !l.trim().startsWith("--")).join("\n");
  const statements = code.split(";").filter((s) => /\binsert\s+into\b/i.test(s));
  assert.ok(statements.length >= 6, `mong đợi ít nhất 6 câu insert, thấy ${statements.length}`);
  for (const s of statements) {
    const table = /insert\s+into\s+(\S+)/i.exec(s)?.[1];
    assert.ok(/\bon\s+conflict\b/i.test(s), `insert vào ${table} thiếu ON CONFLICT`);
  }
});
