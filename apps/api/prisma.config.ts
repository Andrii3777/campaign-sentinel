import path from "node:path";
import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env"));
} catch {
  // no .env: rely on the process environment (CI, docker)
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // generate needs no connection; migrate commands fail with a clear Prisma error when DATABASE_URL is unset
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
