import { defineConfig } from "vitest/config";

/**
 * Cấu hình vitest cho INTEGRATION test.
 *
 * Chạy trong môi trường Node (cần ws + timer thật). Chỉ gồm test tích hợp trong test/.
 * Lưu ý toolchain: esbuild của vitest hỗ trợ experimentalDecorators nhưng KHÔNG hỗ trợ
 * emitDecoratorMetadata → không import module NestJS ở đây; test dựng GameRoom + NetServer
 * trực tiếp (lớp thuần, không DI theo metadata).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.spec.ts"],
    // Cho timer thật + I/O mạng chút thời gian.
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
