import { afterEach, describe, expect, it, vi } from "vitest";
import { RedactingLogger, createRedactor } from "./redacting-logger";

const token = "3f9a1c0d5e7b2a4f6c8e0d1b3a5c7e9f1d3b5a7c9e0f2d4b6a8c0e2f4d6b8a0c";
const env = {
  SENTINEL_AGENT_TOKEN: token,
  ANTHROPIC_API_KEY: "sk-test-not-real-0000",
  DB_PASSWORD: "hunter2-not-real",
  API_PORT: "4000",
};

afterEach(() => vi.restoreAllMocks());

describe("log redaction", () => {
  it("replaces values of KEY/TOKEN/SECRET/PASSWORD variables and leaves others", () => {
    const redact = createRedactor(env);
    const line = redact(`auth Bearer ${token} key=sk-test-not-real-0000 pw=hunter2-not-real port=4000`);
    expect(line).not.toContain(token);
    expect(line).not.toContain("sk-test-not-real-0000");
    expect(line).not.toContain("hunter2-not-real");
    expect(line).toContain("[REDACTED:SENTINEL_AGENT_TOKEN]");
    expect(line).toContain("port=4000");
  });

  it("never writes a token value in a formatted log line", () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => (writes.push(String(chunk)), true));
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => (writes.push(String(chunk)), true));
    const logger = new RedactingLogger(env);
    logger.log(`received Authorization: Bearer ${token}`, "AgentGuard");
    logger.error(new Error(`upstream echoed ${token}`));
    const output = writes.join("");
    expect(output).toContain("AgentGuard");
    expect(output).not.toContain(token);
  });
});
