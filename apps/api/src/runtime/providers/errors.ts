import { AgentSessionError } from "../session";

/** Removes the API key and key-looking tokens from a provider message before it can reach an event or a log. */
export function redact(text: string, apiKey: string): string {
  let out = apiKey ? text.split(apiKey).join("[REDACTED]") : text;
  out = out.replace(/\b(?:sk|AIza|key)[-_A-Za-z0-9]{8,}/g, "[REDACTED]");
  return out.slice(0, 300);
}

/**
 * Typed mapping shared by the three providers (spec §5.2): 429 / 408 / 409 / 5xx / connection failures are
 * retryable (MODEL_UNAVAILABLE); other 4xx (400, 401, 403, 404, 422) are configuration errors.
 */
export function toSessionError(provider: string, error: unknown, apiKey: string): AgentSessionError {
  if (error instanceof AgentSessionError) return error;
  const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : undefined;
  const detail = redact(error instanceof Error ? error.message : String(error), apiKey);
  if (status === undefined) return new AgentSessionError("MODEL_UNAVAILABLE", `${provider} could not be reached: ${detail}`, true);
  if (status === 429 || status === 408 || status === 409 || status >= 500) {
    return new AgentSessionError("MODEL_UNAVAILABLE", `${provider} is temporarily unavailable (HTTP ${status}): ${detail}`, true);
  }
  const hint = status === 401 || status === 403 ? " Check the API key." : status === 404 ? " Check the model id." : "";
  return new AgentSessionError("MODEL_CONFIG_ERROR", `${provider} rejected the request (HTTP ${status}).${hint} ${detail}`.trim(), false);
}
