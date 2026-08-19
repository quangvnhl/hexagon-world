import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// App admin RIÊNG (doc 30 L6): SPA thuần Vite, KHÔNG SSR, tách khỏi domain người chơi.
// Cổng dev 3899 (khác client 3890). API trỏ qua VITE_API_URL (mặc định server local 8910).
//
// @hexagon/shared build ra CommonJS (dist/index.js dùng `export *`). Là workspace link
// nằm NGOÀI node_modules nên Rollup/esbuild bỏ qua transform mặc định → không thấy named
// export. Ép pre-bundle (dev) + đưa vào commonjs transform (build) để đọc được các export.
export default defineConfig({
  plugins: [react()],
  server: { port: 3899, strictPort: true },
  preview: { port: 3899, strictPort: true },
  optimizeDeps: { include: ["@hexagon/shared"] },
  build: {
    commonjsOptions: { include: [/shared[\\/]dist/, /node_modules/] },
  },
});
