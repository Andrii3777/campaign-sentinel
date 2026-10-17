import OpenAI from "openai";
import { type AgentSession, type AgentStopReason, type AgentTask, type AgentToolCall, type AgentTurn, type ToolResultForModel } from "../session";
import { PROVIDER_MAX_TOKENS, PROVIDER_TIMEOUT_MS, resultText, userMessage, type ProviderSessionOptions } from "./common";
import { toSessionError } from "./errors";

type Input = OpenAI.Responses.ResponseInput;

/**
 * Spec §5.2 over the OpenAI Responses API (function calling). The provider-native history is the response
 * chain: every call after the first sends only the new items plus `previous_response_id` (instructions and
 * tools are not inherited, so they are sent each time). Tool schemas go in as published, `strict: false`
 * (strict mode would force every optional field to be required; the ToolExecutor validates the input).
 */
export class OpenAISession implements AgentSession {
  readonly model: string;
  private readonly client: OpenAI;
  private readonly modelId: string;
  private readonly apiKey: string;
  private instructions = "";
  private tools: OpenAI.Responses.FunctionTool[] = [];
  private previousId: string | undefined;
  /** calls of a response that was cut off (max_tokens, refusal): never run, so the next request answers them */
  private unrun: string[] = [];

  constructor(opts: ProviderSessionOptions) {
    this.modelId = opts.model;
    this.model = `openai:${opts.model}`;
    this.apiKey = opts.apiKey;
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseUrl, maxRetries: 0, timeout: opts.timeoutMs ?? PROVIDER_TIMEOUT_MS });
  }

  async start(task: AgentTask): Promise<AgentTurn> {
    this.instructions = task.systemPrompt;
    this.tools = task.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.inputSchema, strict: false }));
    return this.step([{ role: "user", content: userMessage(task) }], undefined);
  }

  async continue(results: ToolResultForModel[], nudge?: string): Promise<AgentTurn> {
    const input: Input = [
      ...this.unrun.map((id): Input[number] => ({ type: "function_call_output", call_id: id, output: "This call was cut off before it was complete and was not run. Make it again if you still need it." })),
      ...results.map((r): Input[number] => ({ type: "function_call_output", call_id: r.callerRef, output: resultText(r) })),
    ];
    if (nudge) input.push({ role: "user", content: nudge });
    return this.step(input, this.previousId);
  }

  /** The chain pointer moves only after a successful call, so a retried call repeats the same request. */
  private async step(input: Input, previousId: string | undefined): Promise<AgentTurn> {
    let response: OpenAI.Responses.Response;
    try {
      response = await this.client.responses.create({
        model: this.modelId,
        instructions: this.instructions,
        input,
        tools: this.tools,
        tool_choice: "auto",
        parallel_tool_calls: true,
        max_output_tokens: PROVIDER_MAX_TOKENS,
        ...(previousId ? { previous_response_id: previousId } : {}),
      });
    } catch (error) {
      throw toSessionError("OpenAI", error, this.apiKey);
    }
    if (response.status === "failed") {
      const code = response.error?.code;
      const retryable = code === "server_error" || code === "rate_limit_exceeded";
      throw toSessionError("OpenAI", Object.assign(new Error(response.error?.message ?? "the response failed"), { status: retryable ? 503 : 400 }), this.apiKey);
    }
    this.previousId = response.id;

    const toolCalls: AgentToolCall[] = [];
    const texts: string[] = [];
    let refused = false;
    for (const item of response.output) {
      if (item.type === "function_call") toolCalls.push({ callerRef: item.call_id, tool: item.name, input: parseArguments(item.arguments) });
      else if (item.type === "message") {
        for (const part of item.content) {
          if (part.type === "output_text") texts.push(part.text);
          else if (part.type === "refusal") refused = true;
        }
      }
    }
    const reason = response.incomplete_details?.reason as string | undefined;
    const stop: AgentStopReason =
      refused || reason === "content_filter" ? "refusal" : response.status === "incomplete" ? "max_tokens" : toolCalls.length ? "tool_use" : "end_turn";
    this.unrun = stop === "tool_use" ? [] : toolCalls.map((c) => c.callerRef);
    return {
      stopReason: stop,
      toolCalls: stop === "tool_use" ? toolCalls : [],
      text: texts.join("\n") || undefined,
      usage: response.usage ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } : undefined,
    };
  }
}

/** Invalid JSON is passed on as the raw string, so the ToolExecutor rejects it with a validation error the model can read. */
function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return raw;
  }
}
