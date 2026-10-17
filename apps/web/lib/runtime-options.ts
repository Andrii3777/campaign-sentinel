import type { HealthResponse } from "@campaign-sentinel/contracts";
import type { RuntimeOption } from "@/components/campaign/start-form";
import type { ApiResult } from "./api";

/** Deterministic is always on; the others say why they are off, from the API's own health report. Shared by the campaign page and the URL page. */
export function runtimeOptions(health: ApiResult<HealthResponse>): RuntimeOption[] {
  const h = health.ok ? health.data : null;
  const unknown = "The API did not report its runtimes, so this option cannot be used right now.";
  const ai = h?.runtimes.ai.status;
  return [
    { value: "deterministic", label: "Deterministic policy", description: "Rule-based, no model, same tools and report checks. Same input, same result.", available: true },
    {
      value: "ai",
      label: "AI agent",
      description: "The configured LLM provider decides which tools to call.",
      available: ai === "available",
      reason: !h ? unknown : ai === "missing_key" ? "The provider API key is not set in .env." : "No LLM provider is configured on the server.",
    },
    {
      value: "openclaw",
      label: "OpenClaw",
      description: "Run through the configured OpenClaw gateway.",
      available: h?.runtimes.openclaw === "configured",
      reason: !h ? unknown : "OpenClaw is not configured on the server.",
    },
  ];
}
