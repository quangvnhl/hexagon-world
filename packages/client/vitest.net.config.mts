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
    ],
  },
});
