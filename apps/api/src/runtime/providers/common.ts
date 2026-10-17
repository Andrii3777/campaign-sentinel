import type { AgentTask, AgentToolSpec, ToolResultForModel } from "../session";

/** Options shared by the three provider sessions. `baseUrl` is for tests (a fake HTTP server). */
export interface ProviderSessionOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export const PROVIDER_TIMEOUT_MS = 120_000;
export const PROVIDER_MAX_TOKENS = 16_000;
const MAX_RESULT_CHARS = 60_000;

/** The first user message: the question plus the ids the tools default to. The system prompt holds no user data. */
export function userMessage(task: AgentTask): string {
  const lines = [`Investigation ${task.investigationId} (mode: ${task.mode}).`, `Question: ${task.question}`];
  if (task.campaignId) lines.push(`Campaign: ${task.campaignId}`);
  if (task.targetUrl) lines.push(`Target URL: ${task.targetUrl}`);
  if (task.periods) {
    const { baseline, current } = task.periods;
    lines.push(`Baseline period: ${baseline.start} to ${baseline.end}`, `Current period: ${current.start} to ${current.end}`);
  }
  lines.push(
    `Budgets: at most ${task.budgets.turns} turns, ${task.budgets.toolCalls} tool calls, ${task.budgets.reportAttempts} report attempts.`,
    "Investigate with the tools, then finish by calling submit_report.",
  );
  return lines.join("\n");
}

/** A tool result as the model sees it; very large outputs are cut so history stays bounded. */
export function resultText(r: ToolResultForModel): string {
  const text = JSON.stringify(r.result);
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…[truncated]` : text;
}

const UNSUPPORTED = new Set(["pattern", "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems", "default", "$schema"]);
const KEPT_FORMATS = new Set(["date", "date-time", "email", "uuid"]);

/**
 * Strips JSON Schema keywords that strict / Gemini schemas reject (the ToolExecutor validates the real
 * input anyway) and closes every object. Does not mutate its argument.
 */
export function sanitizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  if (schema === null || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED.has(key)) continue;
    if (key === "format" && !KEPT_FORMATS.has(String(value))) continue;
    out[key] = key === "properties" && value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeSchema(v)]))
      : sanitizeSchema(value);
  }
  if (out.type === "object" && out.additionalProperties === undefined) out.additionalProperties = false;
  return out;
}

export const sanitizedTools = (tools: AgentToolSpec[]) =>
  tools.map((t) => ({ name: t.name, description: t.description, schema: sanitizeSchema(t.inputSchema) as Record<string, unknown> }));
