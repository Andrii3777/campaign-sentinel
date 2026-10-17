import type { HealthResponse } from "@campaign-sentinel/contracts";
import type { VerificationRecord, VerificationStatus } from "./verification";

export type LiveState = "available" | "configured" | "not_configured" | "missing_key" | "unknown_provider" | "unknown";
export type IntegrationRow = {
  id: string;
  label: string;
  kind: "runtime" | "client";
  description: string;
  /** What the running API reports right now; null for IDE clients, which the API cannot see. */
  live: { state: LiveState; detail?: string } | null;
  /** From the static record only; no record means "not verified". */
  verification: VerificationStatus;
  checkedAt?: string;
  evidence?: string;
};

const catalogue = [
  { id: "deterministic", label: "Deterministic policy", kind: "runtime", description: "Rule-based runtime built into the API. No model; same tools and report checks." },
  { id: "ai", label: "AI agent", kind: "runtime", description: "Built-in agent loop on the LLM provider chosen by LLM_PROVIDER." },
  { id: "openclaw", label: "OpenClaw", kind: "runtime", description: "External agent gateway, called through POST /v1/responses." },
  { id: "claude-code", label: "Claude Code", kind: "client", description: "IDE agent using the campaign-sentinel MCP server and the project skill." },
  { id: "codex", label: "Codex", kind: "client", description: "IDE agent using the campaign-sentinel MCP server and the project skill." },
  { id: "cursor", label: "Cursor", kind: "client", description: "IDE agent using the campaign-sentinel MCP server and the project skill." },
  { id: "antigravity", label: "Antigravity", kind: "client", description: "IDE agent using the campaign-sentinel MCP server and the project skill." },
] as const;

function liveFor(id: string, health: HealthResponse | null): IntegrationRow["live"] {
  if (id === "deterministic") return { state: health ? "available" : "unknown", detail: undefined };
  if (id === "ai") {
    const ai = health?.runtimes.ai;
    return { state: ai?.status ?? "unknown", detail: ai?.provider && ai.model ? `${ai.provider} · ${ai.model}` : undefined };
  }
  if (id === "openclaw") return { state: health?.runtimes.openclaw ?? "unknown", detail: undefined };
  return null;
}

export function buildIntegrationRows(health: HealthResponse | null, records: readonly VerificationRecord[]): IntegrationRow[] {
  return catalogue.map((item) => {
    const record = records.find((r) => r.id === item.id);
    return { ...item, live: liveFor(item.id, health), verification: record?.status ?? "not_verified", checkedAt: record?.checkedAt, evidence: record?.evidence };
  });
}
