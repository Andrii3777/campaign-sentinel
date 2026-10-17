import { execSync } from "node:child_process";
import path from "node:path";

/** Applies migrations to the test database (DATABASE_URL_TEST) once per integration run. */
export default function setup(): void {
  execSync("pnpm exec prisma migrate deploy", {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL_TEST },
    stdio: "pipe",
  });
  // runs left QUEUED by an earlier (aborted) run would be re-enqueued by recovery at boot and disturb the tests
  execSync("pnpm exec prisma db execute --stdin", {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL_TEST },
    input: `UPDATE "Investigation" SET status = 'CANCELLED' WHERE status = 'QUEUED';`,
    stdio: ["pipe", "pipe", "pipe"],
  });
}
