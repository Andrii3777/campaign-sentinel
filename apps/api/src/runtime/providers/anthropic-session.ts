import Anthropic from "@anthropic-ai/sdk";
import { AgentSessionError, type AgentSession, type AgentStopReason, type AgentTask, type AgentTurn, type ToolResultForModel } from "../session";
import { PROVIDER_MAX_TOKENS, PROVIDER_TIMEOUT_MS, resultText, sanitizedTools, userMessage, type ProviderSessionOptions } from "./common";
import { toSessionError } from "./errors";

type Message = Anthropic.Beta.BetaMessageParam;
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];
/** Server-side refusal fallback (`fallbacks: "default"`); the header differs from the array form's `-2026-06-01`. */
export const ANTHROPIC_FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Spec §5.2. Non-streaming `client.beta.messages.create`, tools `strict` with `tool_choice: auto` (forced
 * choice is rejected by Opus 5.5), the full assistant `content` appended unchanged (thinking blocks included,
 * never returned in `text`), all results of a turn in one user message, system + tools marked for caching.
 */
export class AnthropicSession implements AgentSession {
  readonly model: string;
  private readonly client: Anthropic;
  private readonly modelId: string;
  private readonly effort: Effort;
  private messages: Message[] = [];
  private system: Anthropic.Beta.BetaTextBlockParam[] = [];
  private tools: Anthropic.Beta.BetaToolUnion[] = [];

  constructor(opts: ProviderSessionOptions & { effort?: string }) {
    const effort = opts.effort ?? "medium";
    if (!(EFFORTS as readonly string[]).includes(effort)) {
      throw new AgentSessionError("MODEL_CONFIG_ERROR", `ANTHROPIC_EFFORT must be one of ${EFFORTS.join(", ")}.`);
    }
    this.effort = effort as Effort;
    this.modelId = opts.model;
    this.model = `anthropic:${opts.model}`;
    // maxRetries 0: the Runner owns the single loop-level retry
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseUrl, maxRetries: 0, timeout: opts.timeoutMs ?? PROVIDER_TIMEOUT_MS });
    this.apiKey = opts.apiKey;
  }
  private readonly apiKey: string;

  async start(task: AgentTask): Promise<AgentTurn> {
    this.system = [{ type: "text", text: task.systemPrompt, cache_control: { type: "ephemeral" } }];
    const tools = sanitizedTools(task.tools).map((t) => ({ name: t.name, description: t.description, input_schema: t.schema as Anthropic.Beta.BetaTool.InputSchema, strict: true }));
    if (tools.length) (tools[tools.length - 1] as Anthropic.Beta.BetaTool).cache_control = { type: "ephemeral" };
    this.tools = tools;
    return this.step([{ role: "user", content: userMessage(task) }]);
  }

  async continue(results: ToolResultForModel[], nudge?: string): Promise<AgentTurn> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = results.map((r) => ({
      type: "tool_result",
      tool_use_id: r.callerRef,
      content: resultText(r),
      is_error: !r.result.ok,
    }));
    if (nudge) content.push({ type: "text", text: nudge });
    return this.step([...this.messages, { role: "user", content }]);
  }

  /** Sends `history`; it becomes the session history only when the call succeeds, so a retried call never duplicates a message. */
  private async step(history: Message[]): Promise<AgentTurn> {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model: this.modelId,
        max_tokens: PROVIDER_MAX_TOKENS,
        betas: [ANTHROPIC_FALLBACK_BETA],
        fallbacks: "default",
        output_config: { effort: this.effort },
        system: this.system,
        tools: this.tools,
        tool_choice: { type: "auto" },
        messages: history,
      });
    } catch (error) {
      throw toSessionError("Anthropic", error, this.apiKey);
    }

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    const truncated = response.stop_reason === "max_tokens" && toolUses.length > 0;
    // a tool_use cut off by max_tokens must not be run, nor left in history without a result
    const echoed = truncated ? response.content.filter((b) => b.type !== "tool_use") : response.content;
    this.messages = echoed.length ? [...history, { role: "assistant", content: echoed as Anthropic.Beta.BetaContentBlockParam[] }] : history;

    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    const u = response.usage;
    return {
      stopReason: stopReason(response.stop_reason, toolUses.length > 0 && !truncated),
      toolCalls: truncated ? [] : toolUses.map((b) => ({ callerRef: b.id, tool: b.name, input: b.input })),
      text: text || undefined,
      usage: {
        inputTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        outputTokens: u.output_tokens,
      },
    };
  }
}

function stopReason(reason: Anthropic.Beta.BetaStopReason | null, hasCalls: boolean): AgentStopReason {
  if (reason === "refusal") return "refusal";
  if (reason === "max_tokens" || reason === "model_context_window_exceeded") return "max_tokens";
  return hasCalls ? "tool_use" : "end_turn";
}
