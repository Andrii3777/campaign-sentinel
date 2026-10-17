import type { NextConfig } from "next";

// The repo keeps one .env at the root (`pnpm run setup`); Next only reads its own folder.
try {
  process.loadEnvFile("../../.env");
} catch {
  // no root .env yet: the API client falls back to http://localhost:4000
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
};

export default nextConfig;
