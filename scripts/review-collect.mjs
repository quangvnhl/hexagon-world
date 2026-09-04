#!/usr/bin/env node
// Gom mọi thứ NGƯỜI/AGENT cần để review một PR vào MỘT gói (doc 36 R7, lát r9).
//
// Vì sao cần: agent review mà phải tự đi tìm diff, tìm lát trong BACKLOG, tìm mục thiết kế tương
// ứng thì tốn 5–10 lượt gọi công cụ chỉ để *bắt đầu* — và mỗi lần lại tìm theo một cách khác nhau.
// Gom sẵn ở đây thì phần suy xét bắt đầu ngay từ lượt đầu tiên, và hai lần review khác nhau nhìn
// vào cùng một bộ dữ liệu.
//
// Cách dùng:
//   node scripts/review-collect.mjs                  # nhánh hiện tại so với origin/main
//   node scripts/review-collect.mjs --pr 12
//   node scripts/review-collect.mjs --out review.md

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// ---- Phần THUẦN (test được) --------------------------------------------------------------------

/** Suy `id` lát từ tên nhánh `slice/<id>`. Nhánh không theo quy ước ⇒ null, không đoán bừa. */
export function sliceIdFromBranch(branch) {
  const m = /^slice\/(.+)$/.exec(String(branch ?? "").trim());
  return m ? m[1] : null;
}

/** Đổi `doc:` của lát (vd `35#A1`) thành đường dẫn file + neo mục. */
export function docRefOf(doc, files = []) {
  const m = /^(\d+)(?:#(.+))?$/.exec(String(doc ?? "").trim());
  if (!m) return null;
  const prefix = `${m[1]}-`;
  const file = files.find((f) => f.startsWith(prefix));
  return file ? { file: `.implements/${file}`, section: m[2] ?? null } : null;
}

/** Cắt bớt phần quá dài, giữ đầu và cuối — giữa mới là chỗ ít thông tin nhất của một diff dài. */
export function truncate(text, maxChars, label = "phần giữa") {
  if (typeof text !== "string" || text.length <= maxChars) return text ?? "";
  const half = Math.floor(maxChars / 2);
  const bỏ = text.length - maxChars;
  return `${text.slice(0, half)}\n\n… [đã cắt ${bỏ} ký tự ở ${label}] …\n\n${text.slice(-half)}`;
}

/** Dựng gói review. Tất cả đầu vào là chuỗi ⇒ hàm này thuần, test được. */
export function formatBundle({ branch, base, sliceId, sliceYaml, docRef, prInfo, nameStatus, guard, diff }) {
  const parts = [];
  parts.push(`# Gói review — nhánh \`${branch}\` so với \`${base}\``);
  if (prInfo) parts.push(`\n## Pull request\n\n${prInfo}`);
  parts.push(`\n## Lát trong BACKLOG\n`);
  if (sliceId && sliceYaml) parts.push("```yaml\n" + sliceYaml.trimEnd() + "\n```");
  else if (sliceId) parts.push(`Không tìm thấy lát \`${sliceId}\` trong \`.implements/BACKLOG.yaml\`.`);
  else parts.push("Nhánh không theo quy ước `slice/<id>` — không suy được lát nào.");
  if (docRef) {
    parts.push(`\n## Mục thiết kế phải đọc trước khi review\n`);
    parts.push(`\`${docRef.file}\`${docRef.section ? ` — mục **${docRef.section}**` : ""}`);
  }
  parts.push(`\n## File thay đổi\n\n\`\`\`\n${nameStatus.trim() || "(không có)"}\n\`\`\``);
  parts.push(`\n## Cổng review tất định\n\n\`\`\`\n${guard.trim()}\n\`\`\``);
  parts.push(`\n## Diff\n\n\`\`\`diff\n${diff}\n\`\`\`\n`);
  return parts.join("\n");
}

export function parseArgs(argv) {
  const args = { base: "origin/main", pr: null, out: null, maxDiff: 120_000 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") args.base = argv[++i];
    else if (argv[i] === "--pr") args.pr = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--max-diff") args.maxDiff = Number(argv[++i]);
  }
  return args;
}

/** Cắt đúng khối YAML của một lát ra khỏi BACKLOG, không cần parse cả file. */
export function sliceBlock(yamlText, sliceId) {
  const head = `  - id: ${sliceId}\n`;
  const i = yamlText.indexOf(head);
  if (i < 0) return null;
  const j = yamlText.indexOf("\n  - id: ", i + 1);
  return j < 0 ? yamlText.slice(i) : yamlText.slice(i, j + 1);
}

// ---- Phần chạy thật ----------------------------------------------------------------------------

function run(cmd, args, allowFail = false) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  } catch (err) {
    if (allowFail) return String(err.stdout ?? "") + String(err.stderr ?? "");
    throw err;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.pr) {
    // Đưa working tree về đúng nhánh của PR trước khi đo — review sai nhánh còn tệ hơn không review.
    run("gh", ["pr", "checkout", args.pr]);
  }

  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  run("git", ["fetch", "--no-tags", "origin", args.base.replace(/^origin\//, "")], true);
  const mergeBase = run("git", ["merge-base", args.base, "HEAD"]).trim();

  const sliceId = sliceIdFromBranch(branch);
  const backlogPath = ".implements/BACKLOG.yaml";
  const backlog = existsSync(backlogPath) ? readFileSync(backlogPath, "utf8") : "";
  const sliceYaml = sliceId ? sliceBlock(backlog, sliceId) : null;

  let docRef = null;
  const docMatch = sliceYaml && /doc:\s*"([^"]+)"/.exec(sliceYaml);
  if (docMatch) {
    const files = existsSync(".implements") ? run("git", ["ls-files", ".implements"]).split("\n").map((p) => p.replace(".implements/", "")) : [];
    docRef = docRefOf(docMatch[1], files);
  }

  const prInfo = args.pr ? run("gh", ["pr", "view", args.pr, "--json", "number,title,body,author,additions,deletions",
    "--template", "PR #{{.number}} — {{.title}} (+{{.additions}}/-{{.deletions}})\n\n{{.body}}"], true) : null;

  const nameStatus = run("git", ["diff", "--name-status", `${mergeBase}...HEAD`]);
  const guard = run("node", ["scripts/review-guard.mjs", "--base", args.base], true);
  const diff = truncate(run("git", ["diff", `${mergeBase}...HEAD`]), args.maxDiff, "giữa diff");

  const bundle = formatBundle({ branch, base: args.base, sliceId, sliceYaml, docRef, prInfo, nameStatus, guard, diff });

  if (args.out) {
    writeFileSync(args.out, bundle, "utf8");
    console.log(`Đã ghi gói review: ${args.out} (${bundle.length} ký tự)`);
  } else {
    process.stdout.write(bundle);
  }
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("scripts/review-collect.mjs")) {
  main();
}
