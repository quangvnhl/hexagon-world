#!/usr/bin/env node
// Cổng review TẤT ĐỊNH (doc 36 R7) — biến luật trong AGENTS.md thành phép kiểm máy chạy được.
//
// Vì sao cần, bên cạnh người duyệt và bên cạnh Claude review:
//   Luật viết trong AGENTS.md chỉ có tác dụng khi ai đó nhớ ra nó đúng lúc. Những luật quan trọng
//   nhất ở đây (không commit `.env`, không sửa migration đã áp, không tắt test đang đỏ) đều là loại
//   vi phạm một lần là hỏng thật, và đều nhận ra được bằng máy. Cái gì máy kiểm được thì đừng bắt
//   người nhớ.
//
// Vì sao KHÔNG dùng AI cho tầng này:
//   Tầng này phải chạy trên MỌI pull request, không cần secret, không tốn tiền, và cho cùng một
//   câu trả lời mỗi lần. Một cổng chặn mà thỉnh thoảng đổi ý là một cổng chặn không ai tin.
//   Phần cần suy xét (thiết kế đúng chưa, có bỏ sót trường hợp nào không) là việc của tầng Claude
//   review và của người duyệt.
//
// Lối thoát hiểm: viết `review-guard: bỏ qua <rule> — <lý do>` ở dòng NGAY TRÊN dòng bị bắt.
//   Một cổng chặn không có lối thoát hợp lệ sẽ bị vô hiệu hoá cả cụm vào ngày nó cản nhầm.
//   Bắt buộc phải có lý do: người đọc sau này cần biết vì sao chỗ này được miễn.
//
// Cách dùng:
//   node scripts/review-guard.mjs                 # so với origin/main
//   node scripts/review-guard.mjs --base <ref>
//   node scripts/review-guard.mjs --json          # xuất JSON cho công cụ khác đọc

import { execFileSync } from "node:child_process";

// ---- Phần THUẦN (test được, không cần git) -----------------------------------------------------

/** Đường dẫn bí mật KHÔNG bao giờ được vào repo (AGENTS.md §1). `.env.example` là ngoại lệ hợp lệ. */
export function isSecretPath(path) {
  if (path.endsWith(".env.example")) return false;
  if (/(^|\/)\.env($|\.)/.test(path)) return true;
  if (/\.env$/.test(path)) return true;
  if (/(^|\/)client_secret_[^/]*\.json$/.test(path)) return true;
  return false;
}

/** Migration đã áp thì chỉ được THÊM file mới, không sửa/xoá file cũ (AGENTS.md §1). */
export function isAppliedMigrationEdit(file) {
  if (!/^supabase\/migrations\/.+\.sql$/.test(file.path)) return false;
  return file.status !== "A";
}

/**
 * Chuỗi trông như bí mật thật bị dán vào code. Cố ý hẹp: chỉ bắt các dạng có tiền tố/hình dạng đặc
 * trưng, để không kêu ầm lên vì mọi chuỗi dài. Báo động giả lặp lại là cách nhanh nhất giết một
 * cổng chặn.
 */
export const SECRET_PATTERNS = [
  { name: "khoá service_role Supabase", re: /\bsb_secret_[A-Za-z0-9_-]{10,}/ },
  { name: "chuỗi kết nối Postgres có mật khẩu", re: /postgres(?:ql)?:\/\/[^\s:@]+:[^\s:@/]{3,}@/ },
  { name: "token bot Telegram", re: /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/ },
  { name: "khoá riêng tư", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "khoá API Anthropic", re: /\bsk-ant-[A-Za-z0-9-]{20,}/ },
];

/** Đường nóng gameplay: chạy 24 Hz cho mọi phòng, chỉ được ĐẾM chứ không được log (doc 35 §A4). */
export function isHotPath(path) {
  if (/^packages\/server\/src\/net\//.test(path) && !/\.spec\.ts$/.test(path)) return true;
  if (/^packages\/server\/src\/game\/(game-room|bot)/.test(path)) return true;
  return false;
}

function isTestPath(path) {
  return /(\.spec\.ts|\.test\.ts|__tests__\/|\/test\/)/.test(path);
}

/** Trường có GIÁ TRỊ mà client tuyệt đối không được tự khai (AGENTS.md §2, doc 35 §A3). */
const VALUABLE_FIELDS = ["stars", "score", "coin", "xp", "energy", "reward", "balance", "amount", "price"];

/**
 * Mỗi luật nhận `{ files, added }` và trả danh sách phát hiện.
 *  - `files`: [{ status: "A"|"M"|"D"|"R", path }]
 *  - `added`: [{ path, line, text, prevText }] — chỉ các dòng THÊM MỚI, kèm dòng ngay trước để
 *    đọc chú thích miễn trừ.
 */
export const RULES = [
  {
    id: "secret-file",
    severity: "error",
    why: "AGENTS.md §1: không bao giờ commit .env hay client_secret_*.json. Lộ một lần là phải xoay vòng toàn bộ khoá.",
    run: ({ files }) =>
      files.filter((f) => isSecretPath(f.path)).map((f) => ({
        path: f.path,
        message: `file bí mật bị đưa vào commit (${f.status})`,
      })),
  },
  {
    id: "applied-migration-edited",
    severity: "error",
    why: "AGENTS.md §1: migration đã áp lên database thì sửa file không làm database đổi theo — hai bên trôi khỏi nhau trong im lặng. Chỉ được thêm migration mới.",
    run: ({ files }) =>
      files.filter(isAppliedMigrationEdit).map((f) => ({
        path: f.path,
        message: `migration bị ${f.status === "D" ? "xoá" : "sửa"} thay vì thêm file mới`,
      })),
  },
  {
    id: "secret-literal",
    severity: "error",
    why: "Bí mật dán thẳng vào code sẽ nằm lại trong lịch sử git vĩnh viễn, kể cả sau khi xoá dòng đó.",
    run: ({ added }) => {
      const out = [];
      for (const l of added) {
        for (const p of SECRET_PATTERNS) {
          if (p.re.test(l.text)) out.push({ path: l.path, line: l.line, message: `nghi là ${p.name} dán thẳng vào code` });
        }
      }
      return out;
    },
  },
  {
    id: "disabled-test",
    severity: "error",
    why: "AGENTS.md §1: không được tắt/bỏ qua test đang đỏ để CI xanh. `.only` còn tệ hơn — nó lặng lẽ bỏ chạy mọi test còn lại trong file.",
    run: ({ added }) =>
      added
        .filter((l) => isTestPath(l.path) && /\b(?:it|test|describe)\s*\.\s*(?:skip|only|todo)\s*\(/.test(l.text))
        .map((l) => ({ path: l.path, line: l.line, message: "test bị skip/only/todo" })),
  },
  {
    id: "hot-path-log",
    severity: "error",
    why: "doc 35 §A4: vòng lặp 24 Hz chạy cho mọi phòng. Log mỗi tick tạo bão I/O đúng lúc server bận nhất — công cụ chẩn đoán góp phần gây ra chính sự cố nó phải chẩn đoán. Đường nóng chỉ ĐẾM qua net/telemetry.ts.",
    run: ({ added }) =>
      added
        .filter((l) => isHotPath(l.path) && /\b(?:console\.(?:log|info|warn|error|debug)|logger\.(?:log|info|warn|debug))\s*\(/.test(l.text))
        .map((l) => ({ path: l.path, line: l.line, message: "log trong đường nóng gameplay" })),
  },
  {
    id: "trust-client-value",
    severity: "warn",
    why: "AGENTS.md §2: mọi thứ có giá trị phải do server tự tính hoặc tự xác minh. Đây đúng là lỗ hổng lát a3.1 phải vá — client tự khai stars/score.",
    run: ({ added }) => {
      const re = new RegExp(String.raw`\bbody\s*(?:\.|\[["'])\s*(${VALUABLE_FIELDS.join("|")})\b`, "i");
      return added
        .filter((l) => /^packages\/server\/src\//.test(l.path) && !isTestPath(l.path) && re.test(l.text))
        .map((l) => ({ path: l.path, line: l.line, message: `đọc thẳng giá trị có giá từ body: ${re.exec(l.text)?.[1]}` }));
    },
  },
  {
    id: "nondeterministic-shared",
    severity: "warn",
    why: "AGENTS.md §2: logic dùng chung phải tất định, nếu không test và replay đều vô nghĩa. Còn nợ lát t1 (ghim seed vào GameState.rng).",
    run: ({ added }) =>
      added
        .filter((l) => /^packages\/shared\/src\//.test(l.path) && !isTestPath(l.path) && /\bMath\.random\s*\(/.test(l.text))
        .map((l) => ({ path: l.path, line: l.line, message: "Math.random trong shared" })),
  },
  {
    id: "write-endpoint-idempotency",
    severity: "warn",
    why: "AGENTS.md §2: endpoint ghi phải có khoá chống lặp. Mạng di động sẽ gửi lại request, và người chơi sẽ bị trừ tiền hai lần.",
    run: ({ added, files }) => {
      const touched = new Set(files.map((f) => f.path));
      const diffText = added.map((l) => l.text.toLowerCase()).join("\n");
      const mentionsIdempotency = /idempotenc|on conflict|upsert|ignoreduplicates|unique \(/.test(diffText);
      if (mentionsIdempotency) return [];
      return added
        .filter((l) => touched.has(l.path) && /\.controller\.ts$/.test(l.path) && /@(?:Post|Put|Patch)\s*\(/.test(l.text))
        .map((l) => ({ path: l.path, line: l.line, message: "endpoint ghi mới nhưng cả diff không nhắc tới chống lặp" }));
    },
  },
];

/** Chú thích miễn trừ nằm ở dòng NGAY TRÊN dòng bị bắt và phải kèm lý do sau dấu gạch. */
export function exemptionFor(prevText, ruleId) {
  if (typeof prevText !== "string") return null;
  const m = new RegExp(String.raw`review-guard:\s*bỏ qua\s+${ruleId}\s*[—-]\s*(.+)$`).exec(prevText);
  const reason = m?.[1]?.trim();
  return reason && reason.length >= 8 ? reason : null;
}

/** Chạy toàn bộ luật. Trả `{ findings, exempted }`. */
export function runRules(input, rules = RULES) {
  const findings = [];
  const exempted = [];
  const byPathLine = new Map(input.added.map((l) => [`${l.path}:${l.line}`, l]));
  for (const rule of rules) {
    for (const hit of rule.run(input)) {
      const source = hit.line ? byPathLine.get(`${hit.path}:${hit.line}`) : null;
      const reason = exemptionFor(source?.prevText, rule.id);
      const entry = { rule: rule.id, severity: rule.severity, why: rule.why, ...hit };
      if (reason) exempted.push({ ...entry, reason });
      else findings.push(entry);
    }
  }
  return { findings, exempted };
}

/** Phân tích `git diff --name-status`. Đổi tên (R100 cũ mới) tính theo đường dẫn MỚI. */
export function parseNameStatus(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const status = parts[0][0];
    const path = status === "R" || status === "C" ? parts[2] : parts[1];
    if (path) out.push({ status, path });
  }
  return out;
}

/**
 * Phân tích `git diff -U1` để lấy các dòng THÊM MỚI kèm số dòng thật và dòng ngay trước nó
 * (cần cho chú thích miễn trừ). Dùng -U1 chứ không -U0 chính vì cần dòng ngữ cảnh đó.
 */
export function parseAddedLines(diffText) {
  const out = [];
  let path = null;
  let newLine = 0;
  let prevText = null;
  for (const raw of diffText.split(/\r?\n/)) {
    if (raw.startsWith("+++ ")) {
      path = raw === "+++ /dev/null" ? null : raw.slice(6);
      continue;
    }
    if (raw.startsWith("@@")) {
      const m = /@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
      newLine = m ? Number(m[1]) : 0;
      prevText = null;
      continue;
    }
    if (!path) continue;
    if (raw.startsWith("+")) {
      const text = raw.slice(1);
      out.push({ path, line: newLine, text, prevText });
      prevText = text;
      newLine++;
    } else if (raw.startsWith("-")) {
      // Dòng bị xoá không chiếm số dòng ở bản mới, nhưng vẫn có thể là chú thích miễn trừ đứng trước.
      prevText = raw.slice(1);
    } else if (raw.startsWith(" ")) {
      prevText = raw.slice(1);
      newLine++;
    }
  }
  return out;
}

export function parseArgs(argv) {
  const args = { base: "origin/main", json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") args.base = argv[++i];
    else if (argv[i] === "--json") args.json = true;
  }
  return args;
}

/** Xếp hạng: có lỗi ⇒ 1 (chặn), chỉ cảnh báo ⇒ 0 (không chặn). */
export function exitCodeFor(findings) {
  return findings.some((f) => f.severity === "error") ? 1 : 0;
}

// ---- Phần chạy thật ----------------------------------------------------------------------------

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let mergeBase;
  try {
    mergeBase = git(["merge-base", args.base, "HEAD"]).trim();
  } catch {
    console.error(`Không tìm được điểm rẽ nhánh với ${args.base}. Thử: git fetch origin main`);
    process.exit(2);
  }

  const files = parseNameStatus(git(["diff", "--name-status", `${mergeBase}...HEAD`]));
  const added = parseAddedLines(git(["diff", "-U1", `${mergeBase}...HEAD`]));
  const { findings, exempted } = runRules({ files, added });

  if (args.json) {
    console.log(JSON.stringify({ base: args.base, mergeBase, files: files.length, findings, exempted }, null, 2));
    process.exit(exitCodeFor(findings));
  }

  console.log(`Cổng review tất định — ${files.length} file thay đổi so với ${args.base}`);
  const errors = findings.filter((f) => f.severity === "error");
  const warns = findings.filter((f) => f.severity === "warn");

  for (const group of [
    { title: "CHẶN", items: errors },
    { title: "Cảnh báo (không chặn)", items: warns },
  ]) {
    if (group.items.length === 0) continue;
    console.log(`\n${group.title}: ${group.items.length}`);
    for (const f of group.items) {
      console.log(`  [${f.rule}] ${f.path}${f.line ? `:${f.line}` : ""} — ${f.message}`);
      console.log(`      vì sao: ${f.why}`);
      // In ra chú thích GitHub Actions để hiện ngay trên dòng code trong tab Files changed.
      if (process.env.GITHUB_ACTIONS === "true") {
        const kind = f.severity === "error" ? "error" : "warning";
        console.log(`::${kind} file=${f.path}${f.line ? `,line=${f.line}` : ""},title=${f.rule}::${f.message}`);
      }
    }
  }

  if (exempted.length > 0) {
    console.log(`\nĐược miễn trừ có ghi lý do: ${exempted.length}`);
    for (const f of exempted) console.log(`  [${f.rule}] ${f.path}${f.line ? `:${f.line}` : ""} — ${f.reason}`);
  }

  if (errors.length === 0 && warns.length === 0) console.log("\nKhông có vi phạm.");
  process.exit(exitCodeFor(findings));
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("scripts/review-guard.mjs")) {
  main();
}
