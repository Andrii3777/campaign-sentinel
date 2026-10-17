import { Inject, Injectable } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../../config/config";
import { AgentSessionError, type AgentTask } from "../session";
import { redact } from "../providers/errors";

/** Spec §5.13: wait at most 10 minutes for the gateway to finish the run. */
export const OPENCLAW_TIMEOUT_MS = 10 * 60_000;
export const FINAL_TEXT_LIMIT = 500;

export const truncateText = (text: string, limit: number): string => (text.length > limit ? `${text.slice(0, limit)}…` : text);

/** https anywhere, or http only to a loopback host: the bearer token never crosses a network in clear text. */
export function isSafeGateway(gateway: string): boolean {
  try {
    const u = new URL(gateway);
    return u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "localhost" || /^127\./.test(u.hostname) || u.hostname === "[::1]"));
  } catch {
    return false;
  }
}

/** What the OpenClaw agent is asked to do. The agent calls our tools through the `campaign-sentinel` MCP server. */
export function openclawInput(task: AgentTask): string {
  const lines = [
    `Investigate the existing Campaign Sentinel investigation ${task.investigationId} (mode: ${task.mode}).`,
    `Question: ${task.question}`,
  ];
  if (task.campaignId) lines.push(`Campaign: ${task.campaignId}`);
  if (task.targetUrl) lines.push(`Target URL: ${task.targetUrl}`);
  if (task.periods) {
    lines.push(`Baseline: ${task.periods.baseline.start} to ${task.periods.baseline.end}`, `Current: ${task.periods.current.start} to ${task.periods.current.end}`);
  }
  lines.push(
    `Use only the campaign-sentinel tools and pass investigation id ${task.investigationId}; do not start a new investigation.`,
    "Follow the investigate-campaign playbook and finish by calling submit_report with a grounded report.",
  );
  return lines.join("\n");
}

/**
 * Runtime `openclaw` (spec §5.13): POSTs the task to `${OPENCLAW_GATEWAY_URL}/v1/responses` and waits for the
 * gateway's answer. The agent itself reaches the ledger through MCP → Agent API; the Runner decides the
 * outcome from the stored run, using the returned text only for the NO_REPORT message.
 */
@Injectable()
export class OpenClawDispatcher {
  /** public so tests can shorten it */
  timeoutMs = OPENCLAW_TIMEOUT_MS;

  constructor(@Inject(APP_CONFIG) private readonly config: Pick<AppConfig, "OPENCLAW_GATEWAY_URL" | "OPENCLAW_GATEWAY_TOKEN" | "OPENCLAW_AGENT_ID">) {}

  get agentId(): string {
    return this.config.OPENCLAW_AGENT_ID;
  }

  /** Resolves with the agent's final text; throws AgentSessionError(RUNTIME_UNAVAILABLE) when the gateway cannot be used. */
  async dispatch(task: AgentTask, signal: AbortSignal): Promise<string> {
    const { OPENCLAW_GATEWAY_URL: gateway, OPENCLAW_GATEWAY_TOKEN: token } = this.config;
    if (!gateway || !token) {
      throw new AgentSessionError("RUNTIME_UNAVAILABLE", "OpenClaw is not configured: set OPENCLAW_GATEWAY_URL and OPENCLAW_GATEWAY_TOKEN in .env.");
    }
    if (!isSafeGateway(gateway)) {
      throw new AgentSessionError("RUNTIME_UNAVAILABLE", "OPENCLAW_GATEWAY_URL must use https unless the gateway runs on this machine (localhost); the bearer token is not sent over plain http.");
    }
    const url = `${gateway.replace(/\/+$/, "")}/v1/responses`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ model: `openclaw/${this.config.OPENCLAW_AGENT_ID}`, user: `inv:${task.investigationId}`, input: openclawInput(task), stream: false }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
      });
    } catch (error) {
      if (signal.aborted) throw error; // cancelled by the user: the Runner handles it
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      const why = timedOut ? `did not answer within ${Math.round(this.timeoutMs / 1000)} s` : `could not be reached (${redact(error instanceof Error ? error.message : String(error), token)})`;
      throw new AgentSessionError("RUNTIME_UNAVAILABLE", `The OpenClaw gateway ${why}.`);
    }
    const raw = await response.text().catch(() => "");
    if (!response.ok) {
      const hint = response.status === 401 || response.status === 403 ? " Check OPENCLAW_GATEWAY_TOKEN." : response.status === 404 ? " Enable gateway.http.endpoints.responses." : "";
      throw new AgentSessionError("RUNTIME_UNAVAILABLE", `The OpenClaw gateway answered HTTP ${response.status}.${hint} ${redact(raw, token)}`.trim());
    }
    return finalText(raw);
  }
}

/** The assistant's `output_text` parts of an OpenResponses body ("" when the body has none). */
function finalText(raw: string): string {
  try {
    const body = JSON.parse(raw) as { output_text?: unknown; output?: { type?: string; content?: { type?: string; text?: string }[] }[] };
    if (typeof body.output_text === "string") return body.output_text;
    return (body.output ?? [])
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content ?? [])
      .flatMap((part) => (part.type === "output_text" && part.text ? [part.text] : []))
      .join("\n");
  } catch {
    return "";
  }
}
