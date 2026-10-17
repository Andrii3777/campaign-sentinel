// Seeds the synthetic demo dataset into DATABASE_URL. Run through `pnpm db:seed` (builds dist first).
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));
} catch {
  // no .env: rely on the process environment
}
if (!process.env.DATABASE_URL) {
  console.error("db:seed: DATABASE_URL is not set (run `pnpm run setup`)");
  process.exit(1);
}
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("../dist/generated/prisma/client.js");
const { seedDemoData } = require("../dist/demo-data/seed.js");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  const counts = await seedDemoData(prisma);
  console.log(`db:seed: synthetic-demo-v1 seeded ${JSON.stringify(counts)}`);
} finally {
  await prisma.$disconnect();
}
