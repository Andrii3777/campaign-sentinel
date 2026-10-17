import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config";

const base = { DATABASE_URL: "postgresql://postgres@localhost:5433/campaign_sentinel" };

describe("loadConfig", () => {
  it("fails with a clear error naming DATABASE_URL when it is missing", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("applies documented defaults and treats empty values as unset", () => {
    const config = loadConfig({ ...base, ANTHROPIC_API_KEY: "" });
    expect(config.API_PORT).toBe(4000);
    expect(config.API_HOST).toBe("127.0.0.1");
    expect(config.WEB_ORIGIN).toBe("http://localhost:3000");
    expect(config.ANTHROPIC_MODEL).toBe("claude-opus-5-5");
    expect(config.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("refuses URL_FETCH_ALLOW_PRIVATE in production", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production", URL_FETCH_ALLOW_PRIVATE: "true" })).toThrow(
      /URL_FETCH_ALLOW_PRIVATE/,
    );
  });
});
