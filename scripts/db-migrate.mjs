#!/usr/bin/env node
// Áp migration Supabase BẰNG MÁY (doc 36 R3, lát r3.1).
//
// Vì sao cần: tới trước lát này, migration được áp bằng tay qua dashboard/psql (runbook doc 11).
// Agent không bấm được dashboard, nên mọi lát chạm schema (analytics, remote config, ops API,
// campaign sanity) đều bị chặn. Đây là mắt xích mở khoá chúng.
//
// Thiết kế bám ba nỗi lo thực tế:
//  1. **Áp nhầm production.** `--target production` bị TỪ CHỐI cứng trừ khi có biến môi trường
//     xác nhận riêng. Trước lần ghi đầu tiên, script IN RA project ref + số người chơi trong
//     database để người chạy nhìn thấy mình đang đứng ở đâu.
//  2. **Database đã có sẵn schema do áp tay.** Migration trong repo dùng `create table` (không
//     `if not exists`), chạy lại sẽ vỡ. Nên có `--baseline` để ĐÁNH DẤU ĐÃ ÁP mà không chạy lại,
//     dùng đúng một lần khi tiếp quản một database dựng tay.
//  3. **Ai đó sửa nội dung migration đã áp.** So checksum; lệch thì DỪNG, không tự đoán.
//
// Cách dùng:
//   node scripts/db-migrate.mjs --dry-run              # xem sẽ áp gì, không ghi
//   node scripts/db-migrate.mjs --yes                  # áp thật
//   node scripts/db-migrate.mjs --baseline <version> --yes   # đánh dấu đã áp tới version này
//   node scripts/db-migrate.mjs --env-file deploy/staging.env --yes

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const MIGRATIONS_DIR = "supabase/migrations";
export const TABLE = "public.schema_migrations";

// ---- Phần THUẦN (test được, không cần database) ------------------------------------------------

/** Đọc file env đơn giản: `KEY=value`, bỏ dòng trống và dòng bắt đầu bằng `#`. Không mở rộng biến. */
export function parseEnvFile(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/** Checksum nội dung migration — dùng để phát hiện file đã áp bị sửa. */
export function checksumOf(sql) {
  return createHash("sha256").update(sql, "utf8").digest("hex").slice(0, 16);
}

/** Version = tên file bỏ đuôi `.sql`. Thứ tự áp = thứ tự tên file (tiền tố ngày giờ). */
export function versionOf(fileName) {
  return fileName.replace(/\.sql$/i, "");
}

/**
 * Lập KẾ HOẠCH áp. `files` = [{version, checksum}] theo thứ tự; `applied` = Map(version→checksum).
 * Trả `{ pending, drifted }`:
 *  - `pending`  : chưa áp, sẽ chạy theo đúng thứ tự.
 *  - `drifted`  : đã áp nhưng checksum lệch ⇒ nội dung file bị sửa sau khi áp. Có phần tử nào
 *                 trong đây thì DỪNG toàn bộ: sửa migration đã áp là chuyện phải người xử lý.
 */
export function planMigrations(files, applied) {
  const pending = [];
  const drifted = [];
  for (const f of files) {
    const seen = applied.get(f.version);
    if (seen === undefined) pending.push(f);
    else if (seen !== f.checksum) drifted.push({ version: f.version, expected: seen, actual: f.checksum });
  }
  return { pending, drifted };
}

/** Che chuỗi kết nối khi in ra log — giữ lại host để biết đang nối tới đâu, bỏ mật khẩu. */
export function redactDbUrl(url) {
  if (typeof url !== "string" || url.length === 0) return "(trống)";
  return url.replace(/\/\/([^:]+):[^@]*@/, "//$1:***@");
}

/** Suy project ref từ SUPABASE_URL (`https://<ref>.supabase.co`). */
export function projectRefOf(supabaseUrl) {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(supabaseUrl ?? "");
  return m ? m[1] : "(không xác định)";
}

/** Phân tích tham số dòng lệnh. */
export function parseArgs(argv) {
  const args = { target: "staging", envFile: ".env", dryRun: false, yes: false, baseline: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--yes") args.yes = true;
    else if (a === "--target") args.target = argv[++i];
    else if (a === "--env-file") args.envFile = argv[++i];
    else if (a === "--baseline") args.baseline = argv[++i];
  }
  return args;
}

/**
 * Cổng an toàn target. Trả chuỗi lỗi nếu KHÔNG được phép chạy, `null` nếu được.
 * `production` chỉ mở khi có biến môi trường xác nhận — agent không bao giờ có biến này.
 */
export function targetGuard(target, env) {
  if (target === "staging") return null;
  if (target === "production") {
    return env.ALLOW_PRODUCTION_MIGRATE === "yes-i-know"
      ? null
      : "TỪ CHỐI: --target production cần biến môi trường ALLOW_PRODUCTION_MIGRATE=yes-i-know. Agent không được phép chạy nhánh này.";
  }
  return `TỪ CHỐI: --target không hợp lệ: ${target} (chỉ nhận staging | production)`;
}

// ---- Phần chạm DATABASE -----------------------------------------------------------------------

async function loadFiles() {
  const dir = path.resolve(MIGRATIONS_DIR);
  const names = (await readdir(dir)).filter((n) => n.toLowerCase().endsWith(".sql")).sort();
  const files = [];
  for (const name of names) {
    const sql = await readFile(path.join(dir, name), "utf8");
    files.push({ name, version: versionOf(name), checksum: checksumOf(sql), sql });
  }
  return files;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const envPath = path.resolve(args.envFile);
  if (!existsSync(envPath)) {
    console.error(`Không thấy file env: ${args.envFile}`);
    process.exit(1);
  }
  const env = { ...parseEnvFile(readFileSync(envPath, "utf8")), ...process.env };

  const guardError = targetGuard(args.target, env);
  if (guardError) { console.error(guardError); process.exit(1); }

  const dbUrl = env.SUPABASE_DB_URL;
  if (!dbUrl) { console.error("Thiếu SUPABASE_DB_URL trong file env."); process.exit(1); }

  const files = await loadFiles();
  console.log(`Nguồn      : ${MIGRATIONS_DIR} (${files.length} migration)`);
  console.log(`Env        : ${args.envFile}`);
  console.log(`Target     : ${args.target}`);
  console.log(`Project ref: ${projectRefOf(env.SUPABASE_URL)}`);
  console.log(`Database   : ${redactDbUrl(dbUrl)}`);

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
  } catch (err) {
    // Bẫy hay gặp: host "Direct connection" của Supabase (db.<ref>.supabase.co) CHỈ có bản ghi
    // IPv6. Mạng IPv4 gọi REST API vẫn được nhưng nối Postgres thì ENOTFOUND. Lời giải là
    // "Session pooler" (cổng 5432, DDL chạy được) — KHÔNG phải "Transaction pooler" (6543, vỡ DDL).
    if (/ENOTFOUND|EAI_AGAIN/i.test(String(err.message)) && /db\.[a-z0-9]+\.supabase\.co/.test(dbUrl)) {
      console.error("");
      console.error(`Không phân giải được host: ${err.message}`);
      console.error("Đây là host 'Direct connection' của Supabase — chỉ có IPv6, mạng IPv4 không nối được.");
      console.error("Đổi SUPABASE_DB_URL sang chuỗi 'Session pooler' (Dashboard → Connect → Session pooler):");
      console.error("  postgresql://postgres.<ref>:<mật khẩu>@aws-0-<region>.pooler.supabase.com:5432/postgres");
      process.exit(1);
    }
    throw err;
  }

  try {
    // `--dry-run` phải KHÔNG ghi gì — kể cả DDL tạo sổ. Nên chế độ khô chỉ DÒ xem sổ có chưa;
    // chưa có thì coi như chưa áp migration nào.
    let applied = new Map();
    if (args.dryRun) {
      const exists = await client.query("select to_regclass($1) as t", [TABLE]);
      if (exists.rows[0].t) {
        const rows = await client.query(`select version, checksum from ${TABLE}`);
        applied = new Map(rows.rows.map((r) => [r.version, r.checksum]));
      } else {
        console.log(`Sổ        : chưa có ${TABLE} (sẽ tạo khi chạy thật)`);
      }
    } else {
      await client.query(`create table if not exists ${TABLE} (
        version    text primary key,
        checksum   text not null,
        applied_at timestamptz not null default now()
      )`);
      const rows = await client.query(`select version, checksum from ${TABLE}`);
      applied = new Map(rows.rows.map((r) => [r.version, r.checksum]));
    }

    // Cho người chạy thấy mình đang đứng ở database nào TRƯỚC khi ghi bất cứ thứ gì.
    let players = "(không đọc được)";
    try {
      const r = await client.query("select count(*)::int as n from public.players");
      players = String(r.rows[0].n);
    } catch { players = "(chưa có bảng players)"; }
    console.log(`Người chơi : ${players}`);
    console.log(`Đã áp      : ${applied.size}/${files.length}`);

    const { pending, drifted } = planMigrations(files, applied);

    if (drifted.length > 0) {
      console.error("\nDỪNG — migration ĐÃ ÁP bị sửa nội dung (checksum lệch):");
      for (const d of drifted) console.error(`  ${d.version}: đã áp ${d.expected} ≠ file hiện tại ${d.actual}`);
      console.error("Không tự sửa. Hoặc khôi phục nội dung file, hoặc thêm migration mới bù thay đổi.");
      process.exit(1);
    }

    // Chế độ TIẾP QUẢN: database đã dựng tay từ trước ⇒ đánh dấu đã áp, KHÔNG chạy lại
    // (migration dùng `create table` nên chạy lại chắc chắn vỡ).
    if (args.baseline) {
      const upTo = files.findIndex((f) => f.version === args.baseline);
      if (upTo < 0) { console.error(`Không thấy migration: ${args.baseline}`); process.exit(1); }
      const mark = files.slice(0, upTo + 1).filter((f) => !applied.has(f.version));
      console.log(`\nBASELINE tới ${args.baseline} — đánh dấu ${mark.length} migration là ĐÃ ÁP (không chạy SQL):`);
      for (const f of mark) console.log(`  ${f.version}`);
      if (args.dryRun) { console.log("\n(--dry-run: không ghi gì)"); return; }
      if (!args.yes) { console.log("\nThêm --yes để ghi."); return; }
      for (const f of mark) {
        await client.query(`insert into ${TABLE}(version, checksum) values ($1,$2) on conflict (version) do nothing`, [f.version, f.checksum]);
      }
      console.log("Xong.");
      return;
    }

    if (pending.length === 0) { console.log("\nKhông có migration nào cần áp."); return; }

    console.log(`\nSẼ ÁP ${pending.length} migration:`);
    for (const f of pending) console.log(`  ${f.version}`);

    if (args.dryRun) { console.log("\n(--dry-run: không ghi gì)"); return; }
    if (!args.yes) { console.log("\nThêm --yes để áp thật."); return; }

    for (const f of pending) {
      process.stdout.write(`áp ${f.version} ... `);
      // Mỗi migration là MỘT giao dịch: hỏng giữa chừng thì không để lại nửa vời.
      await client.query("begin");
      try {
        await client.query(f.sql);
        await client.query(`insert into ${TABLE}(version, checksum) values ($1,$2)`, [f.version, f.checksum]);
        await client.query("commit");
        console.log("xong");
      } catch (err) {
        await client.query("rollback");
        console.log("HỎNG");
        console.error(`\n${f.version} lỗi: ${err.message}`);
        console.error("Đã rollback migration này. Các migration trước đó vẫn giữ nguyên.");
        process.exit(1);
      }
    }
    console.log("\nHoàn tất.");
  } finally {
    await client.end();
  }
}

// Chỉ chạy khi gọi TRỰC TIẾP; `import` từ test thì không chạy.
// Dùng pathToFileURL thay vì so sánh chuỗi đường dẫn — trên Windows đường dẫn và file URL khác
// nhau (ổ đĩa, dấu gạch) nên so tay rất dễ sai.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
