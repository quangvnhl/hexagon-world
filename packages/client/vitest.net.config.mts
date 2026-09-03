import { defineConfig } from "vitest/config";

// Cấu hình vitest RIÊNG cho lớp net (thuần logic). Môi trường node, globals bật, và
// CHỈ include các test net → vitest không nạp component R3F/DOM.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: [
      "src/net/__tests__/**/*.test.ts",
      "src/components/__tests__/**/*.test.ts",
      // `src/lib` là logic thuần (analytics, cổng nền tảng, adsgram…) — chạy được ở môi trường
      // node như hai thư mục trên. Thiếu dòng này thì test đặt ở lib/__tests__ im lặng KHÔNG chạy.
      "src/lib/__tests__/**/*.test.ts",
    ],
  },
});
