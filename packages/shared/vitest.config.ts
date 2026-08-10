import { defineConfig } from "vitest/config";

// Cấu hình tối giản cho unit test logic thuần (không render, môi trường node).
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/__tests__/**/*.test.ts"],
  },
});
