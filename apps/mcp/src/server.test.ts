import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { toolSpecs } from "@campaign-sentinel/contracts";
import { describe, expect, it } from "vitest";
import type { ApiClient, ApiResponse } from "./api-client";
import { createSentinelServer } from "./server";

interface Seen {
  method: string;
  path: string;
  body?: unknown;
}

async function connect(reply: (seen: Seen) => ApiResponse, clientName = "unit-client") {
  const seen: Seen[] = [];
  const api: ApiClient = {
    async request(method, path, body) {
      const entry = { method, path, body };
      seen.push(entry);
      return reply(entry);
    },
  };
  const server = createSentinelServer(api);
  const client = new Client({ name: clientName, version: "1.2.3" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, seen };
}
const ID = "cm0abcdefghij0123456789xyz";
const text = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content[0]!).text);

describe("MCP tool surface", () => {
  it("exposes the campaign tools, every analysis tool with investigation_id, and marks read-only ones", async () => {
    const { client } = await connect(() => ({ status: 200, body: {} }));
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_demo_campaigns", "start_investigation", "get_investigation", ...toolSpecs.map((s) => s.name)]));
    for (const spec of toolSpecs) {
      const tool = tools.find((t) => t.name === spec.name)!;
      expect(tool.annotations?.readOnlyHint).toBe(spec.readOnly);
      expect(tool.inputSchema.required).toContain("investigation_id");
      expect(Object.keys(tool.inputSchema.properties ?? {})).toContain("investigation_id");
    }
    expect(tools.find((t) => t.name === "list_demo_campaigns")!.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "start_investigation")!.annotations?.readOnlyHint).toBe(false);
    expect(tools.find((t) => t.name === "compare_periods")!.inputSchema.properties).toHaveProperty("baseline");
    // Codex (approval never) blocks non-read-only tools that are also open-world: submit_report only writes our own ledger
    expect(tools.find((t) => t.name === "submit_report")!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
  });
});

describe("MCP tool calls", () => {
  it("start_investigation forwards the clientInfo received in initialize", async () => {
    const { client, seen } = await connect(() => ({ status: 201, body: { investigationId: "abc" } }), "claude-code");
    const result = await client.callTool({ name: "start_investigation", arguments: { mode: "demo", campaign_id: "c1", question: "Why?" } });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toEqual({ investigationId: "abc" });
    expect(seen).toEqual([
      { method: "POST", path: "/api/agent/investigations", body: { mode: "demo", campaignId: "c1", question: "Why?", client: { name: "claude-code", version: "1.2.3" } } },
    ]);
  });

  it("maps an analysis tool to the Agent API with a per-connection call id and without investigation_id in the input", async () => {
    const { client, seen } = await connect(() => ({ status: 200, body: { ok: true, data: {}, evidence: [] } }));
    await client.callTool({ name: "compare_periods", arguments: { investigation_id: ID, reason: "Check the change." } });
    await client.callTool({ name: "compare_periods", arguments: { investigation_id: ID, reason: "Check the change." } });
    expect(seen.map((s) => s.path)).toEqual(Array(2).fill(`/api/agent/investigations/${ID}/tools/compare_periods`));
    expect((seen[0]!.body as { input: unknown }).input).toEqual({ reason: "Check the change." });
    const ids = seen.map((s) => (s.body as { callId: string }).callId);
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("submit_report posts the report to the report endpoint; a 422 comes back as an error result with the errors", async () => {
    const errors = [{ path: "observations.0", rule: "evidence_exists", message: "E42 does not exist" }];
    const { client, seen } = await connect(() => ({ status: 422, body: { accepted: false, errors } }));
    const result = await client.callTool({ name: "submit_report", arguments: { investigation_id: ID, report: { summary: "x" } } });
    expect(result.isError).toBe(true);
    expect(text(result)).toEqual({ accepted: false, errors });
    expect(seen[0]).toEqual({ method: "POST", path: `/api/agent/investigations/${ID}/report`, body: { report: { summary: "x" } } });
  });

  it("returns API errors and failed tool results as isError", async () => {
    const api = await connect(() => ({ status: 401, body: { code: "UNAUTHORIZED", message: "A valid bearer token is required." } }));
    const unauthorized = await api.client.callTool({ name: "list_demo_campaigns", arguments: {} });
    expect(unauthorized.isError).toBe(true);
    expect(text(unauthorized)).toMatchObject({ code: "UNAUTHORIZED" });

    const failed = await connect(() => ({ status: 200, body: { ok: false, error: { code: "INVALID_ARGUMENTS", message: "bad", retryable: false } } }));
    const result = await failed.client.callTool({ name: "get_daily_trend", arguments: { investigation_id: ID, metric: "nope" } });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
  });

  it.each([".", "..", "", "a/b", "../x", "x?y=1", "not-a-cuid"])("rejects investigation_id %j before any request", async (bad) => {
    const { client, seen } = await connect(() => ({ status: 200, body: {} }));
    for (const name of ["compare_periods", "get_investigation", "submit_report"]) {
      const result = await client.callTool({ name, arguments: { investigation_id: bad, reason: "x", report: {} } });
      expect(result.isError).toBe(true);
      expect(text(result)).toMatchObject({ code: "INVALID_ARGUMENTS" });
    }
    expect(seen).toEqual([]);
  });

  it("annotates start_investigation openWorldHint false (true makes Codex block it) and keeps the rest", async () => {
    const { client } = await connect(() => ({ status: 200, body: {} }));
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "start_investigation")!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    expect(tools.find((t) => t.name === "list_demo_campaigns")!.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(tools.find((t) => t.name === "submit_report")!.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: false });
  });

  it("asks for investigation_id instead of calling the API when it is missing", async () => {
    const { client, seen } = await connect(() => ({ status: 200, body: {} }));
    const result = await client.callTool({ name: "compare_periods", arguments: { reason: "x" } });
    expect(result.isError).toBe(true);
    expect(seen).toEqual([]);
  });
});
