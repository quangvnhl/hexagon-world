// doc 35 §C5 — giữ cho `Dockerfile` không lệch khỏi workspace. Không chạm mạng, không cần Docker.
//
// ┌─ VÌ SAO CẦN BÀI NÀY ────────────────────────────────────────────────────────────────────────┐
// │ Trước lát này Dockerfile COPY 3 manifest trong khi `pnpm-lock.yaml` có 4 importer            │
// │ (`packages/admin` thiếu). `pnpm install --frozen-lockfile` đối chiếu lockfile với các manifest│
// │ THẤY ĐƯỢC, nên build chết ngay ở bước cài đặt với ERR_PNPM_OUTDATED_LOCKFILE.                 │
// │                                                                                              │
// │ Lỗi đó KHÔNG lộ ra ở bất kỳ cổng nào đang có: typecheck, test, build đều xanh vì chúng chạy   │
// │ trên máy, không qua Docker. Nó chỉ lộ ra ở lần deploy đầu tiên — đúng lúc đắt nhất. Thêm một  │
// │ package mới vào workspace là lặp lại đúng lỗi này, nên nó phải được giữ bằng test.            │
// └─────────────────────────────────────────────────────────────────────────────────────────────┘
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dockerfile = readFileSync(`${root}Dockerfile`, "utf8");
const lockfile = readFileSync(`${root}pnpm-lock.yaml`, "utf8");

/** Các workspace package mà lockfile biết tới. */
function lockfileImporters() {
  return [...lockfile.matchAll(/^ {2}(packages\/[a-zA-Z0-9._-]+):$/gm)].map((m) => m[1]);
}

test("mọi importer trong lockfile đều có manifest được COPY vào image", () => {
  const importers = lockfileImporters();
  assert.ok(importers.length >= 3, `lockfile chỉ có ${importers.length} importer — regex có còn đúng không?`);
  for (const pkg of importers) {
    assert.ok(
      dockerfile.includes(`COPY ${pkg}/package.json`),
      `Dockerfile thiếu manifest của ${pkg} ⇒ pnpm install --frozen-lockfile sẽ chết với ERR_PNPM_OUTDATED_LOCKFILE`,
    );
  }
});

test("manifest được COPY TRƯỚC pnpm install — thứ tự này là cả điểm của lớp cache", () => {
  // Copy sau khi cài thì lớp phụ thuộc không cache được, và mỗi lần sửa một dòng code là cài lại
  // toàn bộ node_modules.
  // Tìm dòng LỆNH `RUN`, không phải chuỗi bất kỳ: bản đầu của bài này dùng `indexOf` trần và nó
  // khớp phải một CHÚ THÍCH nhắc tới lệnh, nằm trước mọi dòng COPY ⇒ đỏ giả.
  const install = dockerfile.search(/^RUN pnpm install --frozen-lockfile/m);
  assert.ok(install > 0, "không tìm thấy dòng RUN pnpm install --frozen-lockfile");
  for (const pkg of lockfileImporters()) {
    const copy = dockerfile.indexOf(`COPY ${pkg}/package.json`);
    assert.ok(copy > 0 && copy < install, `COPY của ${pkg} phải nằm TRƯỚC pnpm install`);
  }
});

test("--frozen-lockfile không bị gỡ", () => {
  // Gỡ cờ này làm image build được với một cây phụ thuộc KHÁC với thứ đã test — tức thứ chạy trên
  // production không còn là thứ CI đã kiểm.
  assert.match(dockerfile, /^RUN pnpm install --frozen-lockfile/m);
});
