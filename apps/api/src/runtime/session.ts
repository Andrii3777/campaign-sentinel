import type { FailureCode, InvestigationMode, Period, ToolName, ToolResult } from "@campaign-sentinel/contracts";

/**
 * Provider-neutral agent session (spec §5.2). Each implementation (deterministic policy, scripted test
 * session, Anthropic / OpenAI / Gemini in ticket 06) keeps its own provider-native history; the Runner
 * only sees turns and hands back tool results.
 */
export interface AgentToolSpec {
  name: ToolName;
  description: string;
  /** JSON Schema (draft 2020-12) of the input, from `toolInputJsonSchema` */
  inputSchema: Record<string, unknown>;
}

export interface AgentBudgets {
  turns: number;
  toolCalls: number;
  reportAttempts: number;
  wallClockMs: number;
}

/** Everything a session needs to start. The system prompt holds no user data; the question goes in the first user message. */
export interface AgentTask {
  investigationId: string;
  mode: InvestigationMode;
  question: string;
  campaignId: string | null;
  targetUrl: string | null;
  periods: { baseline: Period; current: Period } | null;
  systemPrompt: string;
  /** only the tools of this investigation's mode (+ submit_report) */
  tools: AgentToolSpec[];
  budgets: AgentBudgets;
}

export interface AgentToolCall {
  /** unique per investigation (e.g. the provider's tool_use id); used for de-duplication */
  callerRef: string;
  tool: string;
  input: unknown;
}

export type AgentStopReason = "tool_use" | "end_turn" | "max_tokens" | "refusal";

export interface AgentTurn {
  stopReason: AgentStopReason;
  toolCalls: AgentToolCall[];
  /** visible text only, never thinking */
  text?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/** One executed call, returned to the model; all results of a turn go back in one `continue`. */
export interface ToolResultForModel {
  callerRef: string;
  tool: string;
  result: ToolResult;
}

export interface AgentSession {
  /** e.g. "deterministic-policy-v1", "scripted", "anthropic:claude-opus-5-5"; stored as Investigation.model */
  readonly model: string;
  start(task: AgentTask): Promise<AgentTurn>;
  /** `nudge` is set when the previous turn had no tool call ("call submit_report"); results are then empty */
  continue(results: ToolResultForModel[], nudge?: string): Promise<AgentTurn>;
}

/** A model/runtime failure. Retryable errors (429, 5xx, connection) get one loop-level retry. */
export class AgentSessionError extends Error {
  constructor(
    readonly code: Extract<FailureCode, "MODEL_UNAVAILABLE" | "MODEL_REFUSED" | "MODEL_CONFIG_ERROR" | "RUNTIME_UNAVAILABLE">,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AgentSessionError";
  }
}
