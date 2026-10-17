import path from "node:path";
import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../.env"));
} catch {
  // CI: DATABASE_URL_TEST comes from the environment
}
if (!process.env.DATABASE_URL_TEST) throw new Error("DATABASE_URL_TEST is required for integration tests (run `pnpm run setup`)");

export default defineConfig({
  test: {
    include: ["src/**/*.int.test.ts", "test/**/*.int.test.ts"],
    // the provider choice, models, keys, base URLs and the gateway are pinned so results never depend on the
    // developer's .env or shell (empty = unset for the app config)
    env: {
      DATABASE_URL: process.env.DATABASE_URL_TEST,
      NODE_ENV: "test",
      API_HOST: "",
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_MODEL: "",
      ANTHROPIC_EFFORT: "",
      ANTHROPIC_BASE_URL: "",
      OPENAI_API_KEY: "",
      OPENAI_MODEL: "",
      OPENAI_BASE_URL: "",
      GEMINI_API_KEY: "",
      GEMINI_MODEL: "",
      OPENCLAW_GATEWAY_URL: "",
      OPENCLAW_GATEWAY_TOKEN: "",
      OPENCLAW_AGENT_ID: "",
      BROWSER_CHECKS: "",
      SENTINEL_AGENT_TOKEN: "",
    },
    globalSetup: ["test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
