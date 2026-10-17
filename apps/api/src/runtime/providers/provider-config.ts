import type { AppConfig } from "../../config/config";
import { AgentSessionError, type AgentSession } from "../session";
import { AnthropicSession } from "./anthropic-session";
import { GeminiSession } from "./gemini-session";
import { OpenAISession } from "./openai-session";

/**
 * Defaults confirmed from the providers' current official docs (see CONCERNS of ticket 06):
 * OpenAI "start with gpt-6-astra" (developers.openai.com agents/models guide); Gemini `gemini-3.5-flash`
 * (googleapis/js-genai sdk-samples constants). Both are overridden by OPENAI_MODEL / GEMINI_MODEL.
 */
export const DEFAULT_OPENAI_MODEL = "gpt-6-astra";
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";

type KeyConfig = Pick<
  AppConfig,
  "LLM_PROVIDER" | "ANTHROPIC_API_KEY" | "ANTHROPIC_MODEL" | "ANTHROPIC_EFFORT" | "OPENAI_API_KEY" | "OPENAI_MODEL" | "GEMINI_API_KEY" | "GEMINI_MODEL"
>;
export interface AiRuntimeStatus {
  provider: string;
  model: string;
  status: "available" | "missing_key" | "unknown_provider";
}

function selected(config: KeyConfig): { model: string; key: string | undefined; keyName: string } | null {
  switch (config.LLM_PROVIDER) {
    case "anthropic":
      return { model: config.ANTHROPIC_MODEL, key: config.ANTHROPIC_API_KEY, keyName: "ANTHROPIC_API_KEY" };
    case "openai":
      return { model: config.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL, key: config.OPENAI_API_KEY, keyName: "OPENAI_API_KEY" };
    case "gemini":
      return { model: config.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL, key: config.GEMINI_API_KEY, keyName: "GEMINI_API_KEY" };
    default:
      return null;
  }
}

/** What `/api/health` reports and what gates `runtime: "ai"` (story 66). */
export function aiRuntimeStatus(config: KeyConfig): AiRuntimeStatus {
  const s = selected(config);
  if (!s) return { provider: String(config.LLM_PROVIDER), model: "", status: "unknown_provider" };
  return { provider: config.LLM_PROVIDER, model: s.model, status: s.key ? "available" : "missing_key" };
}

/** The one-line reason shown when the AI option is disabled (also the text of the 400 on creation). */
export function aiUnavailableReason(config: KeyConfig): string | null {
  const s = selected(config);
  if (!s) return `LLM_PROVIDER "${String(config.LLM_PROVIDER)}" is not supported; use anthropic, openai or gemini.`;
  return s.key ? null : `The AI agent needs ${s.keyName} in .env (LLM_PROVIDER=${config.LLM_PROVIDER}). Use the deterministic runtime or add the key and restart the API.`;
}

export function openclawStatus(config: Pick<AppConfig, "OPENCLAW_GATEWAY_URL" | "OPENCLAW_GATEWAY_TOKEN">): "configured" | "not_configured" {
  return config.OPENCLAW_GATEWAY_URL && config.OPENCLAW_GATEWAY_TOKEN ? "configured" : "not_configured";
}

/** A session for the `LLM_PROVIDER` in `.env`; MODEL_CONFIG_ERROR when its key is missing. */
export function createProviderSession(config: KeyConfig): AgentSession {
  const s = selected(config);
  const reason = aiUnavailableReason(config);
  if (!s || reason) throw new AgentSessionError("MODEL_CONFIG_ERROR", reason ?? "No LLM provider is configured.");
  const opts = { apiKey: s.key!, model: s.model };
  switch (config.LLM_PROVIDER) {
    case "anthropic":
      return new AnthropicSession({ ...opts, effort: config.ANTHROPIC_EFFORT });
    case "openai":
      return new OpenAISession(opts);
    default:
      return new GeminiSession(opts);
  }
}
