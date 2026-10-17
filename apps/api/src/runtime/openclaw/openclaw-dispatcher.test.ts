import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../config/config";
import type { AgentTask } from "../session";
import { OpenClawDispatcher, truncateText } from "./openclaw-dispatcher";

// A fake gateway on loopback stands in for OpenClaw; the token is a made-up test value.
const TOKEN = "fake-gateway-token-0000";
const task = {
  investigationId: "inv_42",
  mode: "demo",
  question: "Why did conversion fall?",
  campaignId: "home-insurance-search",
  targetUrl: null,
  periods: { baseline: { start: "2026-09-19", end: "2026-10-02" }, current: { start: "2026-10-03", end: "2026-10-16" } },
} as AgentTask;

let server: http.Server | undefined;
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
});

async function gateway(handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void): Promise<string> {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => handler(req, Buffer.concat(chunks).toString(), res));
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}
const config = (url: string | undefined, token: string | undefined = TOKEN) =>
  ({ OPENCLAW_GATEWAY_URL: url, OPENCLAW_GATEWAY_TOKEN: token, OPENCLAW_AGENT_ID: "sentinel" }) as AppConfig;

describe("OpenClawDispatcher", () => {
  it("posts the task to /v1/responses with the bearer token and returns the agent's final text", async () => {
    let seen: { url?: string; auth?: string; body?: Record<string, unknown> } = {};
    const url = await gateway((req, body, res) => {
      seen = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body) };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "resp_1", object: "response", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "I looked at it." }] }] }));
    });
    const text = await new OpenClawDispatcher(config(url)).dispatch(task, new AbortController().signal);
    expect(text).toBe("I looked at it.");
    expect(seen.url).toBe("/v1/responses");
    expect(seen.auth).toBe(`Bearer ${TOKEN}`);
    expect(seen.body).toMatchObject({ model: "openclaw/sentinel", user: "inv:inv_42" });
    expect(String(seen.body!.input)).toContain("inv_42");
    expect(String(seen.body!.input)).toContain("submit_report");
  });

  it("A12: refuses to send the bearer token over plain http to a non-loopback gateway", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      for (const gw of ["http://gateway.example.net:18789", "http://10.0.0.5:18789", "http://localhost.evil.com"]) {
        const error = await new OpenClawDispatcher(config(gw)).dispatch(task, new AbortController().signal).catch((e: unknown) => e);
        expect(error).toMatchObject({ name: "AgentSessionError", code: "RUNTIME_UNAVAILABLE", message: expect.stringContaining("https") });
        expect(String((error as Error).message)).not.toContain(TOKEN);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("fails with RUNTIME_UNAVAILABLE when the gateway is unreachable", async () => {
    const url = await gateway(() => undefined);
    await new Promise<void>((r) => server!.close(() => r()));
    const error = await new OpenClawDispatcher(config(url)).dispatch(task, new AbortController().signal).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: "AgentSessionError", code: "RUNTIME_UNAVAILABLE" });
  });

  it("fails with RUNTIME_UNAVAILABLE on an HTTP error and never echoes the token", async () => {
    const url = await gateway((_req, _body, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `bad token ${TOKEN}` } }));
    });
    const error = await new OpenClawDispatcher(config(url)).dispatch(task, new AbortController().signal).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "RUNTIME_UNAVAILABLE" });
    expect((error as Error).message).toContain("401");
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it("gives up after the timeout", async () => {
    const url = await gateway(() => undefined); // never answers
    const dispatcher = new OpenClawDispatcher(config(url));
    dispatcher.timeoutMs = 80;
    const error = await dispatcher.dispatch(task, new AbortController().signal).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "RUNTIME_UNAVAILABLE" });
    expect((error as Error).message).toMatch(/did not answer/);
  });

  it("refuses when the gateway is not configured", async () => {
    const error = await new OpenClawDispatcher(config(undefined)).dispatch(task, new AbortController().signal).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "RUNTIME_UNAVAILABLE" });
    expect((error as Error).message).toContain("OPENCLAW_GATEWAY_URL");
  });

  it("truncates long final text", () => {
    expect(truncateText("a".repeat(900), 500)).toHaveLength(501);
    expect(truncateText("short", 500)).toBe("short");
  });
});
