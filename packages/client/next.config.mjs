import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["three"],
  // Trong monorepo pnpm, cố định root về gốc workspace để Next truy vết đúng lockfile.
  outputFileTracingRoot: join(__dirname, "..", ".."),
};

export default nextConfig;
