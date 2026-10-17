import http from "node:http";
import type { AddressInfo } from "node:net";
import { toolInputJsonSchema, type ToolResult } from "@campaign-sentinel/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AgentSessionError, type AgentSession, type AgentTask, type ToolResultForModel } from "../session";
import { AnthropicSession } from "./anthropic-session";
import { GeminiSession } from "./gemini-session";
import { OpenAISession } from "./openai-session";

// Fake HTTP transport: a loopback server plays the provider. No network, no real key.
const KEY = "fake-key-for-tests-0000";
type Json = Record<string, unknown>;
interface Recorded {
  path: string;
  headers: http.IncomingHttpHeaders;
  body: Json;
}
interface Reply {
  status: number;
  body: Json;
}

let server: http.Server;
let base = "";
let replies: Reply[] = [];
let requests: Recorded[] = [];
const req = (i: number): Recorded => requests[i]!;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      requests.push({ path: req.url ?? "", headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString() || "{}") as Json });
      const reply = replies.shift() ?? { status: 500, body: { error: { message: "no scripted reply" } } };
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  replies = [];
  requests = [];
});

const task: AgentTask = {
  investigationId: "inv_1",
  mode: "demo",
  question: "Why did conversion fall?",
  campaignId: "home-insurance-search",
  targetUrl: null,
  periods: { baseline: { start: "2026-09-19", end: "2026-10-02" }, current: { start: "2026-10-03", end: "2026-10-16" } },
  systemPrompt: "SYSTEM PROMPT",
  tools: [
    { name: "compare_periods", description: "Compare periods", inputSchema: toolInputJsonSchema("compare_periods") },
    { name: "submit_report", description: "Submit", inputSchema: toolInputJsonSchema("submit_report") },
  ],
  budgets: { turns: 16, toolCalls: 24, reportAttempts: 3, wallClockMs: 300_000 },
};
const ok = (marker: string): ToolResult => ({ ok: true, data: { marker }, evidence: [] });
const results = (...ids: string[]): ToolResultForModel[] => ids.map((id) => ({ callerRef: id, tool: "compare_periods", result: ok(`MARK-${id}`) }));
const text = (body: Json) => JSON.stringify(body);

interface Kit {
  name: string;
  make(): AgentSession;
  toolCalls(calls: { id: string; input: Json }[]): Reply;
  answer(t: string): Reply;
  refusal(): Reply;
  error(status: number, message: string): Reply;
  /** how many tool results the request carried */
  resultCount(body: Json): number;
  /** a reply cut off by the token limit in the middle of tool calls */
  truncatedCalls(calls: { id: string; input: Json }[]): Reply;
  /** how many of the given call ids the request still carries as a function call with no result */
  unanswered(body: Json, ids: string[]): number;
}

const anthropicKit: Kit = {
  name: "anthropic",
  make: () => new AnthropicSession({ apiKey: KEY, model: "claude-opus-5-5", baseUrl: base, effort: "medium" }),
  toolCalls: (calls) => ({
    status: 200,
    body: {
      id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "tool_use", stop_sequence: null,
      content: [{ type: "thinking", thinking: "SECRET-THINKING", signature: "sig-1" }, ...calls.map((c) => ({ type: "tool_use", id: c.id, name: "compare_periods", input: c.input }))],
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  }),
  answer: (t) => ({
    status: 200,
    body: { id: "msg_2", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null, content: [{ type: "text", text: t }], usage: { input_tokens: 20, output_tokens: 7 } },
  }),
  refusal: () => ({
    status: 200,
    body: { id: "msg_3", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "refusal", stop_sequence: null, content: [], stop_details: { type: "refusal", category: "cyber", explanation: null }, usage: { input_tokens: 5, output_tokens: 0 } },
  }),
  error: (status, message) => ({ status, body: { type: "error", error: { type: status === 401 ? "authentication_error" : "overloaded_error", message } } }),
  resultCount: (body) => {
    const msgs = body.messages as { role: string; content: { type: string }[] }[];
    return msgs.filter((m) => m.role === "user").flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_result").length;
  },
  truncatedCalls: (calls) => ({
    status: 200,
    body: {
      id: "msg_t", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "max_tokens", stop_sequence: null,
      content: calls.map((c) => ({ type: "tool_use", id: c.id, name: "compare_periods", input: c.input })),
      usage: { input_tokens: 10, output_tokens: 16000 },
    },
  }),
  unanswered: (body, ids) => {
    const blocks = (body.messages as { content: { type: string; id?: string; tool_use_id?: string }[] | string }[]).flatMap((m) => (Array.isArray(m.content) ? m.content : []));
    const answered = new Set(blocks.filter((b) => b.type === "tool_result").map((b) => b.tool_use_id));
    return blocks.filter((b) => b.type === "tool_use" && ids.includes(b.id!) && !answered.has(b.id)).length;
  },
};

const openaiKit: Kit = {
  name: "openai",
  make: () => new OpenAISession({ apiKey: KEY, model: "gpt-test", baseUrl: `${base}/v1` }),
  toolCalls: (calls) => ({
    status: 200,
    body: {
      id: "resp_1", object: "response", status: "completed", model: "gpt-test",
      output: calls.map((c) => ({ type: "function_call", id: `fc_${c.id}`, call_id: c.id, name: "compare_periods", arguments: JSON.stringify(c.input), status: "completed" })),
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  }),
  answer: (t) => ({
    status: 200,
    body: { id: "resp_2", object: "response", status: "completed", model: "gpt-test", output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: t, annotations: [] }] }], usage: { input_tokens: 20, output_tokens: 7 } },
  }),
  refusal: () => ({
    status: 200,
    body: { id: "resp_3", object: "response", status: "completed", model: "gpt-test", output: [{ type: "message", id: "msg_2", role: "assistant", status: "completed", content: [{ type: "refusal", refusal: "Declined." }] }], usage: { input_tokens: 5, output_tokens: 3 } },
  }),
  error: (status, message) => ({ status, body: { error: { message, type: "server_error", code: null } } }),
  resultCount: (body) => ((body.input as { type?: string }[]) ?? []).filter((i) => i.type === "function_call_output").length,
  truncatedCalls: (calls) => ({
    status: 200,
    body: {
      id: "resp_trunc", object: "response", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, model: "gpt-test",
      output: calls.map((c) => ({ type: "function_call", id: `fc_${c.id}`, call_id: c.id, name: "compare_periods", arguments: JSON.stringify(c.input), status: "incomplete" })),
      usage: { input_tokens: 10, output_tokens: 16000 },
    },
  }),
  // the server-side chain (previous_response_id) still holds the calls of the truncated response
  unanswered: (body, ids) => {
    if (body.previous_response_id !== "resp_trunc") return 0;
    const answered = new Set(((body.input as { type?: string; call_id?: string }[]) ?? []).filter((i) => i.type === "function_call_output").map((i) => i.call_id));
    return ids.filter((id) => !answered.has(id)).length;
  },
};

const geminiKit: Kit = {
  name: "gemini",
  make: () => new GeminiSession({ apiKey: KEY, model: "gemini-test", baseUrl: base }),
  toolCalls: (calls) => ({
    status: 200,
    body: {
      candidates: [{ content: { role: "model", parts: calls.map((c) => ({ functionCall: { id: c.id, name: "compare_periods", args: c.input } })) }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    },
  }),
  answer: (t) => ({
    status: 200,
    body: { candidates: [{ content: { role: "model", parts: [{ text: t }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 7 } },
  }),
  refusal: () => ({ status: 200, body: { promptFeedback: { blockReason: "SAFETY" }, usageMetadata: { promptTokenCount: 5 } } }),
  error: (status, message) => ({ status, body: { error: { code: status, message, status: status === 401 ? "UNAUTHENTICATED" : "UNAVAILABLE" } } }),
  resultCount: (body) =>
    ((body.contents as { parts?: { functionResponse?: unknown }[] }[]) ?? []).flatMap((c) => c.parts ?? []).filter((p) => p.functionResponse).length,
  truncatedCalls: (calls) => ({
    status: 200,
    body: {
      candidates: [{ content: { role: "model", parts: calls.map((c) => ({ functionCall: { id: c.id, name: "compare_periods", args: c.input } })) }, finishReason: "MAX_TOKENS" }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 16000 },
    },
  }),
  unanswered: (body, ids) => {
    const parts = ((body.contents as { parts?: { functionCall?: { id?: string }; functionResponse?: { id?: string } }[] }[]) ?? []).flatMap((c) => c.parts ?? []);
    const answered = new Set(parts.flatMap((p) => (p.functionResponse?.id ? [p.functionResponse.id] : [])));
    return parts.filter((p) => p.functionCall?.id && ids.includes(p.functionCall.id) && !answered.has(p.functionCall.id)).length;
  },
};

describe.each([anthropicKit, openaiKit, geminiKit])("$name session conformance", (kit) => {
  it("round-trips a tool call: model asks, result goes back, final text comes out", async () => {
    replies = [kit.toolCalls([{ id: "call-A", input: { reason: "Compare the two periods." } }]), kit.answer("All done.")];
    const session = kit.make();
    const first = await session.start(task);
    expect(first.stopReason).toBe("tool_use");
    expect(first.toolCalls).toEqual([{ callerRef: "call-A", tool: "compare_periods", input: { reason: "Compare the two periods." } }]);
    expect(first.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(first.text ?? "").not.toContain("SECRET-THINKING");

    const second = await session.continue(results("call-A"));
    expect(second.stopReason).toBe("end_turn");
    expect(second.text).toBe("All done.");
    expect(second.toolCalls).toEqual([]);
    expect(requests).toHaveLength(2);
    expect(text(req(0).body)).toContain("SYSTEM PROMPT");
    expect(text(req(0).body)).toContain("home-insurance-search");
    expect(text(req(1).body)).toContain("MARK-call-A");
    expect(kit.resultCount(req(1).body)).toBe(1);
  });

  it("A12: a max_tokens stop in the middle of tool calls never leaves a call without a result in the history", async () => {
    replies = [kit.truncatedCalls([{ id: "cut-1", input: { reason: "cut off" } }]), kit.answer("Continuing.")];
    const session = kit.make();
    const first = await session.start(task);
    expect(first).toMatchObject({ stopReason: "max_tokens", toolCalls: [] });
    await session.continue([], "Continue with a tool call.");
    expect(requests).toHaveLength(2);
    expect(kit.unanswered(req(1).body, ["cut-1"])).toBe(0);
  });

  it("returns every result of a parallel turn in one continue call", async () => {
    replies = [
      kit.toolCalls([{ id: "p1", input: { reason: "first one" } }, { id: "p2", input: { reason: "second one" } }]),
      kit.answer("ok"),
    ];
    const session = kit.make();
    const first = await session.start(task);
    expect(first.toolCalls.map((c) => c.callerRef)).toEqual(["p1", "p2"]);
    await session.continue(results("p1", "p2"));
    expect(requests).toHaveLength(2);
    expect(kit.resultCount(req(1).body)).toBe(2);
  });

  it("maps 5xx and 429 to a retryable MODEL_UNAVAILABLE and can repeat the failed continue without duplicating history", async () => {
    replies = [kit.toolCalls([{ id: "r1", input: { reason: "x y z" } }]), kit.error(503, "overloaded"), kit.error(429, "slow down"), kit.answer("recovered")];
    const session = kit.make();
    await session.start(task);
    for (let i = 0; i < 2; i++) {
      const error = await session.continue(results("r1")).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AgentSessionError);
      expect(error).toMatchObject({ code: "MODEL_UNAVAILABLE", retryable: true });
    }
    const turn = await session.continue(results("r1"));
    expect(turn.text).toBe("recovered");
    expect(kit.resultCount(requests.at(-1)!.body)).toBe(1);
  });

  it("maps a refusal / blocked response to stopReason refusal", async () => {
    replies = [kit.refusal()];
    const turn = await kit.make().start(task);
    expect(turn.stopReason).toBe("refusal");
    expect(turn.toolCalls).toEqual([]);
  });

  it("maps an auth error to a non-retryable MODEL_CONFIG_ERROR and never echoes the key", async () => {
    replies = [kit.error(401, `Incorrect API key provided: ${KEY}`)];
    const error = await kit.make().start(task).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "MODEL_CONFIG_ERROR", retryable: false });
    expect((error as Error).message).not.toContain(KEY);
  });

  it("restarts cleanly: start resets the history", async () => {
    replies = [kit.error(503, "down"), kit.answer("fresh")];
    const session = kit.make();
    await session.start(task).catch(() => undefined);
    const turn = await session.start(task);
    expect(turn.text).toBe("fresh");
    expect(JSON.stringify(req(1).body)).toBe(JSON.stringify(req(0).body));
  });
});

describe("provider specifics", () => {
  it("anthropic: strict tools, auto tool choice, caching, fallback beta, effort; thinking blocks are echoed back unchanged", async () => {
    replies = [anthropicKit.toolCalls([{ id: "t1", input: { reason: "look at it" } }]), anthropicKit.answer("fin")];
    const session = anthropicKit.make();
    await session.start(task);
    await session.continue(results("t1"));
    const first = req(0);
    const second = req(1);
    expect(first.headers["x-api-key"]).toBe(KEY);
    expect(String(first.headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
    expect(first.body).toMatchObject({ model: "claude-opus-5-5", max_tokens: 16000, tool_choice: { type: "auto" }, fallbacks: "default", output_config: { effort: "medium" } });
    const tools = first.body.tools as { strict?: boolean; cache_control?: unknown; name: string }[];
    expect(tools.every((t) => t.strict === true)).toBe(true);
    expect(tools.at(-1)!.cache_control).toEqual({ type: "ephemeral" });
    expect((first.body.system as { cache_control?: unknown }[])[0]!.cache_control).toEqual({ type: "ephemeral" });
    const assistant = (second.body.messages as { role: string; content: { type: string; signature?: string }[] }[]).find((m) => m.role === "assistant")!;
    expect(assistant.content[0]).toMatchObject({ type: "thinking", signature: "sig-1" });
    expect(JSON.stringify(first.body.tools)).not.toContain("minLength");
  });

  it("anthropic: a failed tool result is sent with is_error", async () => {
    replies = [anthropicKit.toolCalls([{ id: "e1", input: { reason: "bad one" } }]), anthropicKit.answer("fin")];
    const session = anthropicKit.make();
    await session.start(task);
    await session.continue([{ callerRef: "e1", tool: "compare_periods", result: { ok: false, error: { code: "TOOL_UNAVAILABLE", message: "nope", retryable: false } } }]);
    const user = (req(1).body.messages as { role: string; content: { type: string; is_error?: boolean }[] }[]).filter((m) => m.role === "user").at(-1)!;
    expect(user.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "e1", is_error: true });
  });

  it("anthropic: a nudge goes out as plain user text", async () => {
    replies = [anthropicKit.answer("thinking aloud"), anthropicKit.answer("ok")];
    const session = anthropicKit.make();
    await session.start(task);
    await session.continue([], "call submit_report");
    expect(JSON.stringify(req(1).body.messages)).toContain("call submit_report");
  });

  it("openai: chains with previous_response_id and keeps instructions and tools on every call", async () => {
    replies = [openaiKit.toolCalls([{ id: "o1", input: { reason: "look at it" } }]), openaiKit.answer("fin")];
    const session = openaiKit.make();
    await session.start(task);
    await session.continue(results("o1"));
    expect(req(0).headers.authorization).toBe(`Bearer ${KEY}`);
    expect(req(1).body).toMatchObject({ previous_response_id: "resp_1", instructions: "SYSTEM PROMPT", model: "gpt-test" });
    expect((req(1).body.tools as unknown[]).length).toBe(2);
  });

  it("gemini: sends the key as a header, function declarations, and echoes the model content back", async () => {
    replies = [geminiKit.toolCalls([{ id: "g1", input: { reason: "look at it" } }]), geminiKit.answer("fin")];
    const session = geminiKit.make();
    await session.start(task);
    await session.continue(results("g1"));
    expect(req(0).headers["x-goog-api-key"]).toBe(KEY);
    expect(req(0).path).toContain("gemini-test:generateContent");
    const body = req(0).body as { systemInstruction?: unknown; tools?: { functionDeclarations: { name: string }[] }[] };
    expect(JSON.stringify(body.systemInstruction)).toContain("SYSTEM PROMPT");
    expect(body.tools![0]!.functionDeclarations.map((f) => f.name)).toEqual(["compare_periods", "submit_report"]);
    const contents = req(1).body.contents as { role: string; parts: { functionCall?: { id: string }; functionResponse?: { id?: string; name: string } }[] }[];
    expect(contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(contents[1]!.parts[0]!.functionCall!.id).toBe("g1");
    expect(contents[2]!.parts[0]!.functionResponse).toMatchObject({ id: "g1", name: "compare_periods" });
  });
});
