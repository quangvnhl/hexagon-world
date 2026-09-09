// doc 39 §2 — giữ `deploy/docker-compose.yml` và `deploy/Caddyfile` khỏi ba lỗi MẤT TIỀN hoặc
// LỘ ĐƯỜNG. Không chạm mạng, không cần Docker.
//
// ┌─ VÌ SAO KHÔNG DÙNG PARSER YAML ────────────────────────────────────────────────────────────┐
// │ Repo không có sẵn parser YAML, và thêm một phụ thuộc cho một bài test là cái giá không cần  │
// │ trả. Thay vào đó: tách khối service theo thụt lề (file này ta tự viết nên hình dạng của nó  │
// │ là biết trước), rồi MỖI luật đều kèm một phép thử ngược trên bản đột biến — nếu luật không  │
// │ bắt được bản đã phá thì chính bài test đỏ. Một cổng chỉ biết xanh thì vô giá trị.           │
// └──────────────────────────────────────────────────────────────────────────────────────────┘
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const composeText = readFileSync(`${root}deploy/docker-compose.yml`, "utf8");
const caddyText = readFileSync(`${root}deploy/Caddyfile`, "utf8");
const runtimeConfigText = readFileSync(`${root}packages/server/src/runtime-config.ts`, "utf8");

/** Cắt khối `services:` thành { tênService: phần thân }. */
function services(text) {
  const body = text.split(/^services:\s*$/m)[1] ?? "";
  const stop = body.search(/^[a-z]/m); // dòng đầu tiên không thụt lề (vd. `volumes:`)
  const scoped = stop === -1 ? body : body.slice(0, stop);
  const out = {};
  const names = [...scoped.matchAll(/^ {2}([a-z][a-z0-9_-]*):\s*$/gm)];
  for (const [index, match] of names.entries()) {
    const from = match.index + match[0].length;
    const to = index + 1 < names.length ? names[index + 1].index : scoped.length;
    out[match[1]] = scoped.slice(from, to);
  }
  return out;
}

const svc = services(composeText);

test("cắt được đúng bốn service — nếu hỏng, mọi luật dưới đây thành vô nghĩa", () => {
  // Chốt chặn cho chính bộ tách ở trên: một luật chạy trên khối RỖNG sẽ xanh mà không kiểm gì.
  assert.deepEqual(Object.keys(svc).sort(), ["caddy", "client", "control", "game"]);
  for (const [name, block] of Object.entries(svc)) {
    assert.ok(block.trim().length > 20, `khối service ${name} rỗng bất thường`);
  }
});

// ── 1. Spool của node game phải nằm trên volume BỀN ────────────────────────────────────────
//
// Mỗi file trong thư mục đó là kết quả một trận chưa ghi được vào control plane — tức XP và tiền
// của một người chơi. Nằm trong lớp ghi của container thì một lần `docker compose up -d` là xoá
// sạch, IM LẶNG, và `hexworld_spool_pending` tụt về 0 trông y hệt như đã khỏi.
function spoolDefault() {
  const match = /gameResultSpoolDir:\s*text\("GAME_RESULT_SPOOL_DIR",\s*"([^"]+)"\)/.exec(runtimeConfigText);
  assert.ok(match, "không đọc được mặc định GAME_RESULT_SPOOL_DIR từ runtime-config.ts");
  return match[1];
}

/** Đường dẫn tuyệt đối mà mặc định của server sẽ giải ra trong image (WORKDIR=/app). */
function spoolAbsolute() {
  return spoolDefault().replace(/^\.\//, "/app/");
}

function mountsSpoolOnNamedVolume(gameBlock) {
  const target = spoolAbsolute();
  // Volume có TÊN, không phải bind mount: dạng `<tên>:<đường dẫn>` với tên không bắt đầu bằng
  // `/` hay `.`. Bind mount vào thư mục trên host cũng bền, nhưng nó phụ thuộc vào một thư mục
  // mà compose không tạo và không ai kiểm — quên `mkdir` là Docker tự tạo thư mục RỖNG rồi gắn
  // đè, và lại mất sạch y như cũ.
  const pattern = new RegExp(`^\\s*-\\s*([a-z][a-z0-9_-]*):${target}(?::|\\s|$)`, "m");
  const match = pattern.exec(gameBlock);
  if (!match) return null;
  // Tên đó phải được khai ở khối `volumes:` cấp cao nhất, nếu không compose báo lỗi lúc chạy.
  const topLevel = composeText.split(/^volumes:\s*$/m)[1] ?? "";
  return new RegExp(`^\\s{2}${match[1]}:\\s*$`, "m").test(topLevel) ? match[1] : null;
}

test("spool kết quả trận của node game nằm trên volume có tên và đã khai báo", () => {
  assert.ok(
    mountsSpoolOnNamedVolume(svc.game),
    `service game phải gắn volume có tên vào ${spoolAbsolute()} — mỗi file trong đó là tiền của một người chơi`,
  );
});

test("luật spool BẮT ĐƯỢC bản đột biến (bind mount, và thiếu mount)", () => {
  const target = spoolAbsolute();

  const bind = svc.game.replace(`game-spool:${target}`, `./data:${target}`);
  assert.notEqual(bind, svc.game, "phép đột biến không đổi gì — regex ở trên đã lệch khỏi file");
  assert.equal(mountsSpoolOnNamedVolume(bind), null, "bind mount lẽ ra phải bị từ chối");

  const removed = svc.game.split("\n").filter((line) => !line.includes("game-spool:")).join("\n");
  assert.notEqual(removed, svc.game, "phép đột biến không đổi gì");
  assert.equal(mountsSpoolOnNamedVolume(removed), null, "thiếu mount lẽ ra phải bị từ chối");
});

// ── 2. Node game không được nhận secret của control plane ───────────────────────────────────
//
// `release-gate.mjs` đã cấm điều này trong FILE ENV, nhưng compose là một đường cấp env THỨ HAI
// mà cổng đó không nhìn thấy. Một dòng `environment:` hay một `env_file` dùng chung là đủ để
// vòng qua nó hoàn toàn.
const SECRET_CUA_CONTROL = [
  "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL",
  "PLAYER_SESSION_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_STATE_SECRET",
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "REGION_TICKET_PRIVATE_KEY_BASE64",
  "ADMIN_API_KEY_SHA256",
];

function leakedSecrets(block) {
  return SECRET_CUA_CONTROL.filter((name) => new RegExp(`\\b${name}\\b`).test(block));
}

function envFilesOf(block) {
  const match = /env_file:\s*\[([^\]]*)\]/.exec(block);
  if (!match) return [];
  return match[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

test("service game không mang secret của control plane, và dùng env_file RIÊNG", () => {
  assert.deepEqual(leakedSecrets(svc.game), [], "secret của control plane bị cấp cho node game");

  const gameFiles = envFilesOf(svc.game);
  const controlFiles = envFilesOf(svc.control);
  assert.ok(gameFiles.length, "service game phải có env_file");
  assert.ok(controlFiles.length, "service control phải có env_file");
  for (const file of gameFiles) {
    assert.ok(
      !controlFiles.includes(file),
      `game và control dùng chung ${file} — node game sẽ nhận toàn bộ secret`,
    );
  }
});

test("luật secret BẮT ĐƯỢC bản đột biến", () => {
  const leaked = svc.game.replace(
    "env_file: [./game.env]",
    "env_file: [./game.env]\n    environment:\n      TELEGRAM_BOT_TOKEN: abc",
  );
  assert.notEqual(leaked, svc.game, "phép đột biến không đổi gì");
  assert.deepEqual(leakedSecrets(leaked), ["TELEGRAM_BOT_TOKEN"]);

  const shared = svc.game.replace("env_file: [./game.env]", "env_file: [./control.env]");
  assert.notEqual(shared, svc.game, "phép đột biến không đổi gì");
  assert.ok(envFilesOf(shared).includes("./control.env"));
});

// ── 3. Chỉ Caddy được mở cổng ra host ───────────────────────────────────────────────────────
//
// Mở cổng ở control hay game là mở một đường đi VÒNG QUA Caddy — tức vòng qua cả TLS lẫn luật
// chặn /metrics ở dưới. Nó không làm gì hỏng ngay, nên không ai để ý.
function publishesHostPorts(block) {
  return /^\s*ports:/m.test(block);
}

test("chỉ caddy mở cổng ra host", () => {
  assert.ok(publishesHostPorts(svc.caddy), "caddy phải mở 80/443");
  for (const name of ["control", "game", "client"]) {
    assert.ok(
      !publishesHostPorts(svc[name]),
      `service ${name} mở cổng ra host — đó là đường đi vòng qua Caddy`,
    );
  }
});

test("luật cổng BẮT ĐƯỢC bản đột biến", () => {
  const opened = svc.control.replace(/^(\s*)expose:.*$/m, '$1ports:\n$1  - "8910:8910"');
  assert.notEqual(opened, svc.control, "phép đột biến không đổi gì");
  assert.ok(publishesHostPorts(opened));
});

// ── 4. Mọi service phải tự khởi động lại ───────────────────────────────────────────────────
test("mọi service có restart: unless-stopped", () => {
  for (const [name, block] of Object.entries(svc)) {
    assert.match(block, /^\s*restart:\s*unless-stopped\s*$/m, `service ${name} thiếu restart policy`);
  }
});

// ── 5. Caddy chặn số liệu vận hành ra Internet ─────────────────────────────────────────────
//
// health.controller.ts ghi rõ `/health/network` chỉ được lộ sau ACL. `/metrics` cùng loại: nó
// nói ra số phòng, số kết nối, tồn đọng spool — tức nói ra lúc nào hệ đang yếu.
test("Caddyfile chặn /metrics và /health/network trên cả site api lẫn site game", () => {
  const matcher = /path\s+([^\n]*)/.exec(caddyText);
  assert.ok(matcher, "không tìm thấy matcher path nào trong Caddyfile");
  for (const duong of ["/metrics", "/health/network"]) {
    assert.ok(matcher[1].includes(duong), `matcher chặn thiếu ${duong}`);
  }
  assert.match(caddyText, /respond\s+@\w+\s+404/, "matcher không dẫn tới respond 404");

  // Site client KHÔNG cần import, nhưng hai site server thì có. Đếm số lần import để chắc chắn
  // không phải chỉ một site được che.
  const imports = caddyText.match(/^\s*import chan-so-lieu\s*$/gm) ?? [];
  assert.equal(imports.length, 2, "phải có đúng hai site server import luật chặn (api và game)");
});

test("luật Caddy BẮT ĐƯỢC bản đột biến — gỡ một import là đỏ", () => {
  const removed = caddyText.replace(/^\s*import chan-so-lieu\s*$\n/m, "");
  assert.notEqual(removed, caddyText, "phép đột biến không đổi gì");
  assert.equal((removed.match(/^\s*import chan-so-lieu\s*$/gm) ?? []).length, 1);
});
