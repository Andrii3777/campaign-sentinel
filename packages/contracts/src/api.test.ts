import { describe, expect, it } from "vitest";
import { AgentCreateInvestigationDtoSchema, CreateInvestigationDtoSchema, ToolResultSchema, eventPayloadSchemas } from "./index";

describe("API DTOs", () => {
  it("accepts demo and url investigation requests with a runtime", () => {
    expect(
      CreateInvestigationDtoSchema.safeParse({
        mode: "demo",
        campaignId: "home-insurance",
        runtime: "ai",
        baseline: { start: "2026-09-19", end: "2026-10-02" },
      }).success,
    ).toBe(true);
    expect(
      CreateInvestigationDtoSchema.safeParse({ mode: "url", url: "https://example.com", runtime: "openclaw" }).success,
    ).toBe(true);
  });

  it.each([
    ["unknown runtime", { mode: "demo", campaignId: "c", runtime: "claude" }],
    ["url mode without url", { mode: "url", runtime: "deterministic" }],
    ["non-http url", { mode: "url", url: "file:///etc/passwd", runtime: "deterministic" }],
    ["demo fields in url mode", { mode: "url", url: "https://example.com", campaignId: "c", runtime: "ai" }],
  ])("rejects %s", (_label, body) => {
    expect(CreateInvestigationDtoSchema.safeParse(body).success).toBe(false);
  });

  it("requires the declared client on Agent API creation", () => {
    expect(AgentCreateInvestigationDtoSchema.safeParse({ mode: "demo", campaignId: "c" }).success).toBe(false);
    expect(
      AgentCreateInvestigationDtoSchema.safeParse({ mode: "demo", campaignId: "c", client: { name: "codex" } }).success,
    ).toBe(true);
  });

  it("models the ToolResult envelope and event payloads", () => {
    expect(ToolResultSchema.safeParse({ ok: false, error: { code: "TIMEOUT", message: "t", retryable: true } }).success).toBe(true);
    expect(ToolResultSchema.safeParse({ ok: true, data: {}, evidence: [{ ref: "X1", statement: "s", strength: "direct" }] }).success).toBe(false);
    expect(eventPayloadSchemas["tool.call_rejected"].safeParse({ toolExecutionId: "t", code: "NOPE", issues: [] }).success).toBe(false);
  });
});
