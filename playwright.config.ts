import { defineConfig, devices } from "@playwright/test";

/**
 * doc 36 §R2 tầng 1 — smoke UI, KHÔNG cần database.
 *
 * Tầng này bắt đúng loại lỗi hay gặp nhất khi sửa render: trang tải xong, DOM có, nhưng canvas
 * WebGL chết — và mọi unit test vẫn xanh vì chúng không bao giờ dựng một canvas thật.
 *
 * Chạy trên **bản build production** (`next start`) chứ không phải dev server. Hai lý do:
 *   1. CI đã chạy `pnpm build` ở bước trước ⇒ tái dùng `.next`, không tốn thêm một lần biên dịch.
 *   2. Dev server có overlay lỗi và HMR riêng — chúng che mất đúng thứ ta đang muốn đo.
 */
// CỔNG RIÊNG, không dùng lại 3890 của dev server.
//
// Đã thử `reuseExistingServer` trên 3890 và nó dẫn tới một bài kiểm SAI: máy dev thường có sẵn một
// `next dev` ở cổng đó, Playwright bám vào nó, và bài kiểm đo một bản build khác với bản vừa build.
// Ở lần chạy hỏng, thứ nó đo là màn hình lỗi của dev server. Một smoke test đo nhầm mục tiêu còn
// tệ hơn không có smoke test.
const PORT = 3877;

export default defineConfig({
  testDir: "tests/e2e",
  // 120s, và đây là con số ĐO ĐƯỢC chứ không phải chọn cho rộng rãi: trên WebGL phần mềm
  // (SwiftShader — thứ CI bắt buộc phải dùng vì runner không có GPU), `/play` mất 30–45 giây để
  // vẽ được khung hình đầu. Trên GPU thật chỉ vài giây. Đặt 60s như bản đầu là đủ để xanh trên máy
  // dev rồi đỏ chập chờn trong CI — loại đỏ khiến người ta tắt smoke test đi.
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // KHÔNG retry: smoke chập chờn là smoke vô dụng — nó phải hoặc đúng, hoặc chỉ ra một lỗi thật.
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // BẮT BUỘC: `chromium` = bản Chromium ĐẦY ĐỦ. Mặc định của Playwright mới là
        // "chromium-headless-shell" — bản rút gọn KHÔNG có WebGL, nên bài kiểm ngữ cảnh sẽ đỏ vì
        // trình duyệt chứ không phải vì sản phẩm.
        channel: "chromium",
        launchOptions: {
          args: [
            // Runner của CI không có GPU. Không có ba cờ này thì `getContext("webgl2")` trả null
            // và bài kiểm WebGL đỏ vì MÔI TRƯỜNG chứ không phải vì sản phẩm — loại đỏ giả tệ nhất,
            // vì nó dạy người ta bỏ qua smoke test.
            "--use-gl=angle",
            "--use-angle=swiftshader",
            // Chrome >= 128 chặn WebGL trên SwiftShader nếu thiếu cờ này.
            "--enable-unsafe-swiftshader",
          ],
        },
      },
    },
  ],
  webServer: {
    // `next start` trực tiếp thay vì script `start` của gói: script đó ghim cứng `-p 3890`.
    command: `pnpm exec next start -p ${PORT}`,
    cwd: "packages/client",
    url: `http://127.0.0.1:${PORT}`,
    // LUÔN tự dựng server. Cổng bận ⇒ báo lỗi rõ ràng, tốt hơn là lặng lẽ đo nhầm tiến trình khác.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
