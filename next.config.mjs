import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["three"],
  // Cố định root để Next không nhầm sang lockfile ở D:\dev.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
