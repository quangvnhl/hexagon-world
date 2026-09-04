// Test phần THUẦN của bộ gom gói review (doc 36 R7, lát r9). Không chạm git, gh hay mạng.
import test from "node:test";
import assert from "node:assert/strict";
import { docRefOf, formatBundle, parseArgs, sliceBlock, sliceIdFromBranch, truncate } from "./review-collect.mjs";

test("sliceIdFromBranch: đọc được id từ nhánh đúng quy ước", () => {
  assert.equal(sliceIdFromBranch("slice/a1.4-server-events"), "a1.4-server-events");
  assert.equal(sliceIdFromBranch("slice/r9-review-agent"), "r9-review-agent");
});

test("sliceIdFromBranch: nhánh KHÔNG theo quy ước ⇒ null, không đoán bừa", () => {
  // Đoán bừa nguy hiểm hơn nói không biết: agent sẽ review theo mô tả của một lát khác.
  assert.equal(sliceIdFromBranch("main"), null);
  assert.equal(sliceIdFromBranch("feature/abc"), null);
  assert.equal(sliceIdFromBranch(undefined), null);
});

test("docRefOf: khớp `35#A1` với đúng file trong .implements", () => {
  const files = ["34-campaign-features-plan.md", "35-product-depth-plan.md", "36-phase-5-5-automation-rails.md"];
  assert.deepEqual(docRefOf("35#A1", files), { file: ".implements/35-product-depth-plan.md", section: "A1" });
  assert.deepEqual(docRefOf("36#R7", files), { file: ".implements/36-phase-5-5-automation-rails.md", section: "R7" });
});

test("docRefOf: không có mục con thì section = null; không thấy file thì trả null", () => {
  const files = ["35-product-depth-plan.md"];
  assert.deepEqual(docRefOf("35", files), { file: ".implements/35-product-depth-plan.md", section: null });
  assert.equal(docRefOf("99#A1", files), null);
  assert.equal(docRefOf("linh tinh", files), null);
});

test("sliceBlock: cắt đúng khối của một lát, không dính lát kế tiếp", () => {
  const yaml = [
    "slices:",
    "  - id: a1.3-events-endpoint",
    "    risk: medium",
    "    status: done",
    "",
    "  - id: a1.4-server-events",
    "    risk: medium",
    "    status: todo",
    "",
    "  - id: a1.5-rollup",
    "    status: todo",
    "",
  ].join("\n");
  const block = sliceBlock(yaml, "a1.4-server-events");
  assert.ok(block.includes("status: todo"));
  assert.ok(!block.includes("a1.3-events-endpoint"));
  assert.ok(!block.includes("a1.5-rollup"));
});

test("sliceBlock: lát cuối file vẫn cắt được; lát không tồn tại ⇒ null", () => {
  const yaml = "slices:\n  - id: cuoi-cung\n    status: todo\n";
  assert.ok(sliceBlock(yaml, "cuoi-cung").includes("status: todo"));
  assert.equal(sliceBlock(yaml, "khong-co"), null);
});

test("truncate: giữ CẢ ĐẦU LẪN CUỐI — giữa diff mới là chỗ ít thông tin nhất", () => {
  const text = "A".repeat(100) + "B".repeat(100);
  const out = truncate(text, 60);
  assert.ok(out.startsWith("A".repeat(30)));
  assert.ok(out.endsWith("B".repeat(30)));
  assert.ok(out.includes("đã cắt 140 ký tự"));
});

test("truncate: ngắn hơn trần thì giữ nguyên", () => {
  assert.equal(truncate("ngắn", 100), "ngắn");
  assert.equal(truncate(undefined, 100), "");
});

test("formatBundle: nhánh không phải slice/* vẫn ra gói, có ghi rõ lý do thiếu lát", () => {
  const out = formatBundle({
    branch: "main", base: "origin/main", sliceId: null, sliceYaml: null, docRef: null,
    prInfo: null, nameStatus: "M\tsrc/a.ts", guard: "Không có vi phạm.", diff: "+x",
  });
  assert.ok(out.includes("không suy được lát nào"));
  assert.ok(out.includes("Không có vi phạm."));
  assert.ok(out.includes("src/a.ts"));
});

test("formatBundle: có lát + doc thì chỉ rõ mục thiết kế phải đọc trước", () => {
  const out = formatBundle({
    branch: "slice/a1.4-server-events", base: "origin/main", sliceId: "a1.4-server-events",
    sliceYaml: "  - id: a1.4-server-events\n    risk: medium\n",
    docRef: { file: ".implements/35-product-depth-plan.md", section: "A1" },
    prInfo: "PR #20 — abc", nameStatus: "A\tsrc/b.ts", guard: "ok", diff: "+y",
  });
  assert.ok(out.includes("Mục thiết kế phải đọc trước khi review"));
  assert.ok(out.includes("35-product-depth-plan.md"));
  assert.ok(out.includes("**A1**"));
  assert.ok(out.includes("PR #20"));
});

test("parseArgs: mặc định so với origin/main, không chỉ định PR", () => {
  assert.deepEqual(parseArgs([]), { base: "origin/main", pr: null, out: null, maxDiff: 120_000 });
  const a = parseArgs(["--pr", "12", "--base", "main", "--out", "r.md", "--max-diff", "500"]);
  assert.deepEqual(a, { base: "main", pr: "12", out: "r.md", maxDiff: 500 });
});
