import { FunctionCallingConfigMode, GoogleGenAI, type Content, type GenerateContentResponse } from "@google/genai";
import { type AgentSession, type AgentStopReason, type AgentTask, type AgentToolCall, type AgentTurn, type ToolResultForModel } from "../session";
import { PROVIDER_MAX_TOKENS, PROVIDER_TIMEOUT_MS, resultText, sanitizedTools, userMessage, type ProviderSessionOptions } from "./common";
import { toSessionError } from "./errors";

/** finishReason values that mean the model or a safety filter stopped the answer (spec: blocked → refusal). */
const BLOCKED_FINISH = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT"]);
let counter = 0;

/**
 * Spec §5.2 over `@google/genai` `generateContent` function calling. The history is the `Content[]` list; the
 * model's own `content` (thought parts and signatures included) is appended unchanged, and all function
 * responses of a turn go in one user content. Declarations use `parametersJsonSchema`.
 */
export class GeminiSession implements AgentSession {
  readonly model: string;
  private readonly ai: GoogleGenAI;
  private readonly modelId: string;
  private readonly apiKey: string;
  private contents: Content[] = [];
  private systemInstruction = "";
  private declarations: { name: string; description: string; parametersJsonSchema: Record<string, unknown> }[] = [];

  constructor(opts: ProviderSessionOptions) {
    this.modelId = opts.model;
    this.model = `gemini:${opts.model}`;
    this.apiKey = opts.apiKey;
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey, httpOptions: { baseUrl: opts.baseUrl, timeout: opts.timeoutMs ?? PROVIDER_TIMEOUT_MS, retryOptions: { attempts: 1 } } });
  }

  async start(task: AgentTask): Promise<AgentTurn> {
    this.systemInstruction = task.systemPrompt;
    this.declarations = sanitizedTools(task.tools).map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.schema }));
    return this.step([{ role: "user", parts: [{ text: userMessage(task) }] }]);
  }

  async continue(results: ToolResultForModel[], nudge?: string): Promise<AgentTurn> {
    const parts: NonNullable<Content["parts"]> = results.map((r) => ({
      functionResponse: {
        // ids minted by this session are not sent back; ids the model supplied must be echoed
        ...(r.callerRef.startsWith("gemini-") ? {} : { id: r.callerRef }),
        name: r.tool,
        response: r.result.ok ? { output: resultText(r) } : { error: resultText(r) },
      },
    }));
    if (nudge) parts.push({ text: nudge });
    return this.step([...this.contents, { role: "user", parts }]);
  }

  /** `history` becomes the session history only when the call succeeds, so a retried call never duplicates a message. */
  private async step(history: Content[]): Promise<AgentTurn> {
    let response: GenerateContentResponse;
    try {
      response = await this.ai.models.generateContent({
        model: this.modelId,
        contents: history,
        config: {
          systemInstruction: this.systemInstruction,
          tools: [{ functionDeclarations: this.declarations }],
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
          maxOutputTokens: PROVIDER_MAX_TOKENS,
        },
      });
    } catch (error) {
      throw toSessionError("Gemini", error, this.apiKey);
    }

    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const toolCalls: AgentToolCall[] = [];
    for (const part of parts) {
      if (part.functionCall?.name) {
        toolCalls.push({ callerRef: part.functionCall.id ?? `gemini-${++counter}`, tool: part.functionCall.name, input: part.functionCall.args ?? {} });
      }
    }
    const finish = String(candidate?.finishReason ?? "");
    const blocked = Boolean(response.promptFeedback?.blockReason) || BLOCKED_FINISH.has(finish);
    const stop: AgentStopReason = blocked ? "refusal" : finish === "MAX_TOKENS" ? "max_tokens" : toolCalls.length ? "tool_use" : "end_turn";
    // keep the model's content verbatim (ids filled in so the echo matches what we report); calls that will not
    // be run (max_tokens, blocked) are dropped, so history never holds a function call without a result
    const kept = stop === "tool_use" ? parts : parts.filter((p) => !p.functionCall);
    if (kept.length) {
      let i = 0;
      const echoed: Content = {
        ...candidate!.content,
        parts: kept.map((p) => (p.functionCall?.name && !p.functionCall.id ? { ...p, functionCall: { ...p.functionCall, id: toolCalls[i++]?.callerRef } } : p)),
      };
      this.contents = [...history, echoed];
    } else {
      this.contents = history;
    }
    const text = parts.flatMap((p) => (p.text && !p.thought ? [p.text] : [])).join("\n");
    const usage = response.usageMetadata;
    return {
      stopReason: stop,
      toolCalls: stop === "tool_use" ? toolCalls : [],
      text: text || undefined,
      usage: { inputTokens: usage?.promptTokenCount ?? 0, outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0) },
    };
  }
}
