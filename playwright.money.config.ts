import { existsSync, readFileSync } from "node:fs";
import { defineConfig } from "@playwright/test";

/**
 * doc 36 §R2 tầng 2 — luồng TIỀN xuyên HTTP thật, vào một database thật.
 *
 * ┌─ VÌ SAO TÁCH KHỎI `playwright.config.ts` ────────────────────────────────────────────────────┐
 * │ Tầng 1 (smoke) dựng **client Next** và không cần database. Tầng này dựng **server Nest** và   │
 * │ bắt buộc phải có database. Hai `webServer` khác nhau, hai bộ biến môi trường khác nhau, và    │
 * │ hai lý do chạy khác nhau: smoke chạy mỗi PR, tầng này chạy THỦ CÔNG vì nó ghi vào database.   │
 * │ Nhét chung một file thì mỗi lần chạy smoke lại phải có secret của database — và một bài kiểm  │
 * │ đòi secret để chạy là bài kiểm sẽ bị tắt.                                                     │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * KHÔNG có trình duyệt nào ở đây. Luồng tiền là hợp đồng HTTP giữa client và server; dựng một
 * canvas WebGL để kiểm nó chỉ thêm một nguồn đỏ giả. Bài test dùng `request` của Playwright
 * (APIRequestContext) — vẫn là HTTP thật, cookie thật, server thật.
 */

// Nạp `.env` vào process.env cho tiến trình Playwright (server con thừa hưởng). `dotenv` không có
// ở workspace gốc nên dùng lại bộ đọc của `db-migrate` thay vì thêm một phụ thuộc cho 6 dòng.
// KHÔNG in giá trị nào ra — AGENTS.md §1 cấm đọc-in `.env`.
const ENV_FILE = process.env.ENV_FILE ?? ".env";
if (existsSync(ENV_FILE)) {
  for (const rawLine of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    // Biến có sẵn trong môi trường THẮNG file — để CI truyền secret mà không phải sửa file.
    if (process.env[key] === undefined) process.env[key] = line.slice(eq + 1).trim();
  }
}

// CỔNG RIÊNG, không dùng 8910 của dev server. Cùng bài học đã ghi ở `playwright.config.ts`: bám
// vào một tiến trình có sẵn nghĩa là đo nhầm bản build, và một bài kiểm đo nhầm mục tiêu còn tệ
// hơn không có bài kiểm.
const PORT = 8977;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /money-flow\.spec\.ts$/,
  // 180s. Bài test PHẢI chờ thật: `checkElapsed` của server từ chối kết quả nộp sớm hơn cận vật lý
  // của cấp (c1 hiện là 13,04 giây). Chờ là một phần của thứ đang được kiểm, không phải độ trễ
  // thừa — rút ngắn nó đi là kiểm một hệ thống khác với hệ thống đang chạy.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // KHÔNG retry. Một bài kiểm TIỀN mà chập chờn thì không dùng được: retry sẽ che đúng loại lỗi
  // nguy hiểm nhất ở đây — cấp thưởng hai lần, trừ tiền hai lần.
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    // Build rồi chạy bản production. `start:dev` có watch — nó khởi động lại giữa chừng bài test.
    command: "pnpm --filter @hexagon/server build && pnpm --filter @hexagon/server start:prod",
    url: `http://127.0.0.1:${PORT}/health/ping`,
    env: {
      PORT: String(PORT),
      // Đường đăng nhập bài test dùng. Nó tự chặn khi `cookieSecure` bật, và `cookieSecure` bật khi
      // NODE_ENV=production — nên hai biến này phải đi cùng nhau.
      DEV_LOGIN: "true",
      NODE_ENV: "development",
      // KHÔNG đặt `SERVER_ROLE`. Mặc định `all` phục vụ HTTP và tự suy `gameResultSecret` từ
      // `sessionSecret`; đặt `control` bật nhánh deployment tách riêng và đòi thêm
      // `GAME_RESULT_SECRET` (runtime-config.ts:147) — bản đầu của file này đặt nó và server
      // không khởi động được.
    },
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
