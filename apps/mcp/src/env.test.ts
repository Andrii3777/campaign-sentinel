import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveConfig } from "./env";

const dir = mkdtempSync(path.join(os.tmpdir(), "sentinel-env-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const envFile = (content: string) => {
  const file = path.join(dir, `${Math.random().toString(36).slice(2)}.env`);
  writeFileSync(file, content);
  return file;
};
const missing = path.join(dir, "does-not-exist.env");

describe("resolveConfig", () => {
  it("refuses to start without a token and names the variable only", () => {
    expect(() => resolveConfig({}, missing)).toThrow(/SENTINEL_AGENT_TOKEN/);
  });

  it("process environment beats the repository .env", () => {
    const file = envFile("SENTINEL_AGENT_TOKEN=from-file\nSENTINEL_API_URL=http://127.0.0.1:4100\n");
    const config = resolveConfig({ SENTINEL_AGENT_TOKEN: "from-env", SENTINEL_API_URL: "http://localhost:4200" }, file);
    expect(config).toEqual({ token: "from-env", baseUrl: "http://localhost:4200" });
    expect(resolveConfig({}, file)).toEqual({ token: "from-file", baseUrl: "http://127.0.0.1:4100" });
  });

  it("defaults the URL to loopback on API_PORT or 4000", () => {
    expect(resolveConfig({ SENTINEL_AGENT_TOKEN: "t" }, missing).baseUrl).toBe("http://127.0.0.1:4000");
    expect(resolveConfig({ SENTINEL_AGENT_TOKEN: "t", API_PORT: "4010" }, missing).baseUrl).toBe("http://127.0.0.1:4010");
  });

  it.each(["http://localhost:4000", "http://127.0.0.1:4000", "https://127.0.0.1", "http://[::1]:4000", "http://app.localhost:4000"])("accepts loopback %s", (url) => {
    expect(resolveConfig({ SENTINEL_AGENT_TOKEN: "t", SENTINEL_API_URL: url }, missing).baseUrl).toBe(url);
  });

  it.each(["http://evil.example", "https://api.example.com:4000", "http://10.0.0.5:4000", "http://localhost.evil.com", "http://127.0.0.1.evil.com"])(
    "refuses non-loopback %s without the opt-in, naming variables and not the token",
    (url) => {
      let message = "";
      try {
        resolveConfig({ SENTINEL_AGENT_TOKEN: "secret-token-value", SENTINEL_API_URL: url }, missing);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/SENTINEL_ALLOW_REMOTE_API/);
      expect(message).toMatch(/SENTINEL_API_URL/);
      expect(message).not.toContain("secret-token-value");
    },
  );

  it("allows a remote http(s) host only with SENTINEL_ALLOW_REMOTE_API=1", () => {
    const env = { SENTINEL_AGENT_TOKEN: "t", SENTINEL_API_URL: "https://sentinel.example.com", SENTINEL_ALLOW_REMOTE_API: "1" };
    expect(resolveConfig(env, missing).baseUrl).toBe("https://sentinel.example.com");
    expect(() => resolveConfig({ ...env, SENTINEL_ALLOW_REMOTE_API: "0" }, missing)).toThrow(/SENTINEL_ALLOW_REMOTE_API/);
  });

  it("refuses an invalid or non-http URL", () => {
    expect(() => resolveConfig({ SENTINEL_AGENT_TOKEN: "t", SENTINEL_API_URL: "not a url" }, missing)).toThrow(/SENTINEL_API_URL/);
    expect(() => resolveConfig({ SENTINEL_AGENT_TOKEN: "t", SENTINEL_API_URL: "ftp://127.0.0.1" }, missing)).toThrow(/SENTINEL_API_URL/);
  });
});
