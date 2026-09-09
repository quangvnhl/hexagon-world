#!/usr/bin/env node
// Áp seed xác định vào database (doc 36 §R3, lát r3.2).
//
// Vì sao cần: bài E2E tầng 2 (lát r2.2) đi xuyên HTTP thật vào một database thật, nên nó cần một
// người chơi có số dư biết trước. Không có seed thì bài test phải tự dựng dữ liệu qua API — mà
// chính API đó là thứ đang được kiểm, nên test sẽ tự chứng minh chính nó.
//
// ┌─ `--dry-run` Ở ĐÂY LÀM THẬT RỒI HOÀN TÁC ────────────────────────────────────────────────────┐
// │ Chế độ khô KHÔNG in ra dự đoán. Nó mở một giao dịch, chạy TRỌN VẸN seed.sql, đếm số hàng, rồi │
// │ `rollback`.                                                                                   │
// │                                                                                               │
// │ Lý do: một bản xem trước bằng cách "đọc file rồi đoán" chỉ đúng chừng nào người viết đoán      │
// │ đúng — nó không bao giờ phát hiện được SQL sai cú pháp, thiếu cột, hay vướng ràng buộc khoá    │
// │ ngoại. Chạy thật rồi hoàn tác thì con số in ra là con số ĐO ĐƯỢC, và nếu SQL hỏng thì nó hỏng  │
// │ ngay trong lần chạy khô, đúng lúc còn rẻ.                                                     │
// │                                                                                               │
// │ Đánh đổi phải nói rõ: chế độ khô CÓ ghi vào database rồi rút lại. Nó chiếm khoá trong lúc chạy │
// │ và làm sequence nhảy số. Với seed dùng uuid tính sẵn thì không có sequence nào, nên cái giá    │
// │ thực tế chỉ là vài trăm mili-giây giữ khoá.                                                   │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
//
// Cách dùng:
//   node scripts/db-seed.mjs --target staging --dry-run   # chạy thử, hoàn tác, in số hàng
//   node scripts/db-seed.mjs --target staging --yes       # áp thật
//   node scripts/db-seed.mjs --env-file deploy/staging.env --yes

import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Dùng lại cổng an toàn và bộ đọc env của `db-migrate.mjs` thay vì chép sang đây. Hai bản chép tay
// sẽ lệch, và bản lệch là bản cho phép chạy lên production.
import { parseEnvFile, projectRefOf, redactDbUrl, targetGuard } from "./db-migrate.mjs";

export const SEED_FILE = "supabase/seed.sql";

/**
 * Các bảng được đếm trước/sau. Không đếm hết database: chỉ những bảng seed thật sự chạm tới, để
 * một con số nhúc nhích là một con số nói lên điều gì đó.
 */
export const COUNTED_TABLES = [
  "players",
  "player_identities",
  "player_wallets",
  "player_energy",
  "coin_packages",
  "shop_items",
  "shop_prices",
];

// ---- Phần THUẦN (test được, không cần database) ------------------------------------------------

/** Phân tích tham số dòng lệnh. Mặc định `staging` — giống `db-migrate`, để gõ thiếu không nguy hiểm. */
export function parseArgs(argv) {
  const args = { target: "staging", envFile: ".env", dryRun: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--yes") args.yes = true;
    else if (a === "--target") args.target = argv[++i];
    else if (a === "--env-file") args.envFile = argv[++i];
  }
  return args;
}

/**
 * So hai bản đếm, trả mảng `{table, before, after, delta}` theo thứ tự `COUNTED_TABLES`.
 *
 * `delta = 0` KHÔNG có nghĩa là "không làm gì": seed dùng `on conflict do update`, nên chạy lần thứ
 * hai sẽ cập nhật đúng những hàng cũ mà số hàng không đổi. Đó chính là bằng chứng idempotent, và
 * cũng là lý do phần in ra phải nói rõ điều này thay vì để người đọc tự suy.
 */
export function diffCounts(before, after) {
  return COUNTED_TABLES.map((table) => ({
    table,
    before: before[table] ?? 0,
    after: after[table] ?? 0,
    delta: (after[table] ?? 0) - (before[table] ?? 0),
  }));
}

/** Định dạng bảng số hàng cho dễ đọc trên terminal. */
export function formatCounts(rows) {
  const w = Math.max(...rows.map((r) => r.table.length));
  return rows
    .map((r) => {
      const sign = r.delta > 0 ? `+${r.delta}` : String(r.delta);
      return `  ${r.table.padEnd(w)}  ${String(r.before).padStart(5)} → ${String(r.after).padStart(5)}  (${sign})`;
    })
    .join("\n");
}

// ---- Phần chạm DATABASE ------------------------------------------------------------------------

async function countAll(client) {
  const out = {};
  for (const t of COUNTED_TABLES) {
    const r = await client.query(`select count(*)::int as n from public.${t}`);
    out[t] = r.rows[0].n;
  }
  return out;
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

  const seedPath = path.resolve(SEED_FILE);
  if (!existsSync(seedPath)) { console.error(`Không thấy ${SEED_FILE}`); process.exit(1); }
  const sql = await readFile(seedPath, "utf8");

  console.log(`Nguồn      : ${SEED_FILE}`);
  console.log(`Env        : ${args.envFile}`);
  console.log(`Target     : ${args.target}`);
  console.log(`Project ref: ${projectRefOf(env.SUPABASE_URL)}`);
  console.log(`Database   : ${redactDbUrl(dbUrl)}`);

  // Không có `--dry-run` lẫn `--yes` ⇒ không làm gì. Mặc định của một script ghi dữ liệu phải là
  // KHÔNG GHI; muốn ghi thì phải gõ thêm.
  if (!args.dryRun && !args.yes) {
    console.log("\nThêm --dry-run để xem trước, hoặc --yes để áp thật.");
    return;
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const before = await countAll(client);

    await client.query("begin");
    try {
      await client.query(sql);
      const after = await countAll(client);   // đếm TRONG giao dịch: mới thấy được kết quả

      if (args.dryRun) {
        await client.query("rollback");
        console.log("\n--dry-run: đã chạy trọn seed rồi HOÀN TÁC. Số hàng nếu chạy thật:");
      } else {
        await client.query("commit");
        console.log("\nĐã áp seed. Số hàng:");
      }

      console.log(formatCounts(diffCounts(before, after)));
      console.log("\n(delta 0 KHÔNG phải là không làm gì: seed dùng `on conflict do update`, nên");
      console.log(" chạy lại sẽ cập nhật hàng cũ mà số hàng giữ nguyên — đó là idempotent.)");
    } catch (err) {
      await client.query("rollback");
      console.error(`\nSeed lỗi, đã rollback toàn bộ: ${err.message}`);
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

// Chỉ chạy khi gọi TRỰC TIẾP; `import` từ test thì không chạy. Dùng pathToFileURL vì trên Windows
// đường dẫn và file URL khác nhau (ổ đĩa, dấu gạch) nên so chuỗi rất dễ sai.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
