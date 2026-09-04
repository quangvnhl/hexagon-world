// Test cổng review tất định (doc 36 R7). Không chạm git, không chạm mạng.
import test from "node:test";
import assert from "node:assert/strict";
import {
  RULES,
  exemptionFor,
  exitCodeFor,
  isAppliedMigrationEdit,
  isHotPath,
  isSecretPath,
  parseAddedLines,
  parseArgs,
  parseNameStatus,
  runRules,
} from "./review-guard.mjs";

/** Dựng input tối thiểu cho runRules. */
function input({ files = [], added = [] } = {}) {
  return { files, added };
}
function line(path, text, n = 1, prevText = null) {
  return { path, line: n, text, prevText };
}

test("isSecretPath: bắt mọi biến thể .env nhưng THA .env.example", () => {
  assert.equal(isSecretPath(".env"), true);
  assert.equal(isSecretPath("deploy/staging.env"), true);
  assert.equal(isSecretPath("packages/server/.env"), true);
  assert.equal(isSecretPath(".env.local"), true);
  assert.equal(isSecretPath("client_secret_123.apps.googleusercontent.com.json"), true);
  assert.equal(isSecretPath(".env.example"), false);
  assert.equal(isSecretPath("packages/client/src/lib/environment.ts"), false);
});

test("isAppliedMigrationEdit: thêm file mới thì được, sửa/xoá thì không", () => {
  assert.equal(isAppliedMigrationEdit({ status: "A", path: "supabase/migrations/202609030003_x.sql" }), false);
  assert.equal(isAppliedMigrationEdit({ status: "M", path: "supabase/migrations/202608120001_player_backend.sql" }), true);
  assert.equal(isAppliedMigrationEdit({ status: "D", path: "supabase/migrations/202608120001_player_backend.sql" }), true);
  assert.equal(isAppliedMigrationEdit({ status: "M", path: "supabase/seed.sql" }), false);
});

test("isHotPath: net/ và game-room là đường nóng; test thì không", () => {
  assert.equal(isHotPath("packages/server/src/net/net-server.ts"), true);
  assert.equal(isHotPath("packages/server/src/game/game-room.ts"), true);
  assert.equal(isHotPath("packages/server/src/net/territory-aoi.spec.ts"), false);
  assert.equal(isHotPath("packages/server/src/campaign/campaign.controller.ts"), false);
});

test("luật secret-file CHẶN khi .env lọt vào commit", () => {
  const { findings } = runRules(input({ files: [{ status: "A", path: "deploy/staging.env" }] }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "secret-file");
  assert.equal(findings[0].severity, "error");
});

test("luật applied-migration-edited CHẶN khi sửa migration cũ", () => {
  const { findings } = runRules(input({ files: [{ status: "M", path: "supabase/migrations/202608120001_player_backend.sql" }] }));
  assert.equal(findings[0].rule, "applied-migration-edited");
});

test("luật secret-literal bắt khoá service_role và chuỗi kết nối có mật khẩu", () => {
  const { findings } = runRules(input({
    added: [
      line("packages/server/src/x.ts", 'const key = "sb_secret_abcdefghijklmnop";'),
      line("scripts/y.mjs", 'const url = "postgresql://postgres:matkhauthat@db.abc.supabase.co:5432/postgres";', 2),
    ],
  }));
  assert.equal(findings.length, 2);
  assert.ok(findings.every((f) => f.rule === "secret-literal"));
});

test("secret-literal KHÔNG kêu với placeholder trong .env.example", () => {
  const { findings } = runRules(input({
    added: [line(".env.example", "SUPABASE_DB_URL=postgresql://postgres:[YOUR-PASSWORD]@db.YOUR_REF.supabase.co:5432/postgres")],
  }));
  // `[YOUR-PASSWORD]` vẫn khớp hình dạng mật khẩu — đây là lý do lối thoát hiểm phải tồn tại.
  assert.equal(findings.length, 1);
  const { findings: after } = runRules(input({
    added: [line(".env.example", "SUPABASE_DB_URL=postgresql://postgres:[YOUR-PASSWORD]@db.YOUR_REF.supabase.co:5432/postgres", 1,
      "# review-guard: bỏ qua secret-literal — placeholder trong file mẫu, không phải bí mật thật")],
  }));
  assert.equal(after.length, 0);
});

test("luật disabled-test CHẶN skip/only/todo trong file test", () => {
  const { findings } = runRules(input({
    added: [
      line("packages/server/test/a.spec.ts", '  it.skip("tạm bỏ", () => {});'),
      line("packages/shared/src/__tests__/b.test.ts", '  describe.only("chỉ chạy cái này", () => {});', 2),
    ],
  }));
  assert.equal(findings.length, 2);
  assert.ok(findings.every((f) => f.rule === "disabled-test" && f.severity === "error"));
});

test("disabled-test KHÔNG kêu ngoài file test", () => {
  const { findings } = runRules(input({ added: [line("packages/client/src/x.ts", "queue.skip(1);")] }));
  assert.equal(findings.length, 0);
});

test("luật hot-path-log CHẶN log thêm vào vòng lặp 24 Hz", () => {
  const { findings } = runRules(input({
    added: [line("packages/server/src/net/net-server.ts", '    console.log("tick", n);')],
  }));
  assert.equal(findings[0].rule, "hot-path-log");
});

test("hot-path-log THA log ở control plane", () => {
  const { findings } = runRules(input({
    added: [line("packages/server/src/main.ts", '  logger.info({ port }, "server đã sẵn sàng");')],
  }));
  assert.equal(findings.length, 0);
});

test("luật trust-client-value cảnh báo khi server đọc thẳng giá trị có giá từ body", () => {
  const { findings } = runRules(input({
    added: [line("packages/server/src/campaign/campaign.controller.ts", "    const stars = body.stars ?? 0;")],
  }));
  assert.equal(findings[0].rule, "trust-client-value");
  assert.equal(findings[0].severity, "warn");
});

test("trust-client-value KHÔNG kêu trong file test (test có quyền dựng payload giả)", () => {
  const { findings } = runRules(input({
    added: [line("packages/server/test/campaign.spec.ts", "    await c.complete({}, { body: { stars: 3 } });")],
  }));
  assert.equal(findings.length, 0);
});

test("luật nondeterministic-shared cảnh báo Math.random trong shared", () => {
  const { findings } = runRules(input({
    added: [line("packages/shared/src/state.ts", "    const a = Math.random() * 10;")],
  }));
  assert.equal(findings[0].rule, "nondeterministic-shared");
});

test("luật write-endpoint-idempotency: có nhắc chống lặp ở bất kỳ đâu trong diff thì im", () => {
  const withKey = runRules(input({
    files: [{ status: "M", path: "packages/server/src/shop/shop.controller.ts" }],
    added: [
      line("packages/server/src/shop/shop.controller.ts", '  @Post("purchases")'),
      line("packages/server/src/shop/shop.controller.ts", "    idempotencyKey: body.idempotencyKey,", 2),
    ],
  }));
  assert.equal(withKey.findings.length, 0);

  const without = runRules(input({
    files: [{ status: "M", path: "packages/server/src/shop/shop.controller.ts" }],
    added: [line("packages/server/src/shop/shop.controller.ts", '  @Post("purchases")')],
  }));
  assert.equal(without.findings[0].rule, "write-endpoint-idempotency");
  assert.equal(without.findings[0].severity, "warn");
});

test("miễn trừ: phải có lý do đủ dài, không thì không tính", () => {
  assert.equal(exemptionFor("// review-guard: bỏ qua secret-literal — placeholder file mẫu", "secret-literal"),
    "placeholder file mẫu");
  assert.equal(exemptionFor("// review-guard: bỏ qua secret-literal — ok", "secret-literal"), null);
  assert.equal(exemptionFor("// review-guard: bỏ qua rule-khac — lý do đầy đủ ở đây", "secret-literal"), null);
  assert.equal(exemptionFor(null, "secret-literal"), null);
});

test("parseNameStatus: đọc đúng trạng thái, đổi tên tính theo đường dẫn MỚI", () => {
  const files = parseNameStatus("A\tsrc/a.ts\nM\tsrc/b.ts\nD\tsrc/c.ts\nR100\tsrc/cu.ts\tsrc/moi.ts\n");
  assert.deepEqual(files, [
    { status: "A", path: "src/a.ts" },
    { status: "M", path: "src/b.ts" },
    { status: "D", path: "src/c.ts" },
    { status: "R", path: "src/moi.ts" },
  ]);
});

test("parseAddedLines: số dòng đúng và giữ được dòng ngay trước để đọc chú thích miễn trừ", () => {
  const diff = [
    "diff --git a/src/x.ts b/src/x.ts",
    "--- a/src/x.ts",
    "+++ b/src/x.ts",
    "@@ -10,2 +10,3 @@",
    " const truoc = 1;",
    "+const them = 2;",
    " const sau = 3;",
  ].join("\n");
  const added = parseAddedLines(diff);
  assert.equal(added.length, 1);
  assert.equal(added[0].path, "src/x.ts");
  assert.equal(added[0].line, 11);
  assert.equal(added[0].text, "const them = 2;");
  assert.equal(added[0].prevText, "const truoc = 1;");
});

test("parseAddedLines: bỏ qua file bị xoá hoàn toàn", () => {
  const diff = ["--- a/src/x.ts", "+++ /dev/null", "@@ -1,1 +0,0 @@", "-const a = 1;"].join("\n");
  assert.deepEqual(parseAddedLines(diff), []);
});

test("exitCodeFor: chỉ CHẶN khi có lỗi, cảnh báo thì cho qua", () => {
  assert.equal(exitCodeFor([]), 0);
  assert.equal(exitCodeFor([{ severity: "warn" }]), 0);
  assert.equal(exitCodeFor([{ severity: "warn" }, { severity: "error" }]), 1);
});

test("parseArgs: mặc định so với origin/main", () => {
  assert.deepEqual(parseArgs([]), { base: "origin/main", json: false });
  assert.deepEqual(parseArgs(["--base", "main", "--json"]), { base: "main", json: true });
});

test("mọi luật đều có lời giải thích VÌ SAO — người bị chặn phải hiểu được lý do", () => {
  for (const rule of RULES) {
    assert.ok(rule.why && rule.why.length > 40, `luật ${rule.id} thiếu giải thích`);
    assert.ok(["error", "warn"].includes(rule.severity), `luật ${rule.id} sai mức`);
  }
});

test("diff sạch ⇒ không phát hiện gì", () => {
  const { findings } = runRules(input({
    files: [{ status: "M", path: "packages/client/src/lib/analytics.ts" }],
    added: [line("packages/client/src/lib/analytics.ts", "  const x = 1;")],
  }));
  assert.deepEqual(findings, []);
});
