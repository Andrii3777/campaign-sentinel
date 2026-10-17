import { Inject, Injectable } from "@nestjs/common";
import {
  ToolNameSchema,
  toolSpecs,
  type EvidenceStrength,
  type ToolRejectionCode,
  type ToolResult,
} from "@campaign-sentinel/contracts";
import { PrismaService } from "../db/prisma.service";
import { CallerRefReusedError, InvestigationNotFoundError } from "../ledger/ledger.errors";
import { LedgerService, type Investigation, type ToolExecution } from "../ledger/ledger.service";
import { ToolRegistry } from "./tool-registry";
import { ToolFailure, type ToolHandler } from "./tool.types";

/** Spec story 50: tool calls per investigation (submit_report is budgeted separately by ReportService). */
export const TOOL_CALL_BUDGET = 24;
export const DEFAULT_TOOL_TIMEOUT_MS = 5_000;
export const RETRY_DELAY_MS = 500;
const TRANSIENT = new Set(["TIMEOUT", "UPSTREAM_UNAVAILABLE"]);

export interface ToolCall {
  tool: string;
  /** raw arguments incl. `reason`; validated here against the contracts schema */
  input: unknown;
  /** de-duplication key, unique per investigation (model tool_use id, MCP call id) */
  callerRef?: string;
}

const failure = (code: string, message: string, retryable = false): ToolResult => ({
  ok: false,
  error: { code, message, retryable },
});

/**
 * The single path every runtime uses to run a tool (spec §5.3): validation, mode permission, budget,
 * de-duplication, timeout, one retry for transient errors, evidence creation, untrusted-content guardrail.
 * Every attempt — rejected, failed or succeeded — is recorded in the ledger.
 */
@Injectable()
export class ToolExecutor {
  constructor(
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ToolRegistry) private readonly registry: ToolRegistry,
  ) {}

  /** Throws InvestigationNotFoundError for an unknown id; every other problem comes back as `{ ok: false }`. */
  async execute(investigationId: string, call: ToolCall): Promise<ToolResult> {
    const investigation = await this.prisma.investigation.findUnique({ where: { id: investigationId } });
    if (!investigation) throw new InvestigationNotFoundError(investigationId);

    const input = call.input ?? {};
    const rawReason = (input as { reason?: unknown }).reason;
    const reason = typeof rawReason === "string" && rawReason.trim() ? rawReason.trim().slice(0, 300) : "(no reason given)";
    let requested;
    try {
      requested = await this.ledger.requestToolExecution(investigationId, {
        tool: String(call.tool).slice(0, 100),
        input,
        reason,
        callerRef: call.callerRef,
      });
    } catch (error) {
      if (error instanceof CallerRefReusedError) return failure("CALL_ID_REUSED", error.message);
      throw error;
    }
    const { toolExecution: te, deduplicated } = requested;
    if (deduplicated) return storedResult(te);

    const reject = async (code: ToolRejectionCode, message: string, issues: unknown[] = [message]) => {
      await this.ledger.rejectToolExecution(te.id, code, issues);
      return failure(code, message);
    };

    if (investigation.status !== "RUNNING") {
      return reject("INVESTIGATION_NOT_RUNNING", `The investigation is ${investigation.status}; no more tool calls are accepted.`);
    }
    const name = ToolNameSchema.safeParse(call.tool);
    if (!name.success) return reject("UNKNOWN_TOOL", `Unknown tool "${String(call.tool).slice(0, 100)}".`);
    const spec = toolSpecs.find((s) => s.name === name.data)!;
    const mode = investigation.mode === "DEMO" ? "demo" : "url";
    if (spec.mode !== "both" && spec.mode !== mode) {
      return reject("NOT_PERMITTED", `${spec.name} is not available in ${mode} investigations.`);
    }
    const parsed = spec.inputSchema.safeParse(input);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({ path: i.path.map(String), code: i.code, message: i.message }));
      const text = issues.map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`).join("; ");
      return reject("INVALID_ARGUMENTS", `Invalid arguments: ${text}`, issues);
    }
    if (spec.name !== "submit_report") {
      const { toolCalls } = await this.ledger.incrementCounters(investigationId, { toolCalls: 1 });
      if (toolCalls > TOOL_CALL_BUDGET) {
        await this.ledger.incrementCounters(investigationId, { toolCalls: -1 });
        await this.ledger.appendEvent(investigationId, "guardrail.triggered", {
          kind: "budget_limit",
          details: { budget: "toolCalls", limit: TOOL_CALL_BUDGET },
        });
        return reject("BUDGET_EXCEEDED", `The tool-call budget of ${TOOL_CALL_BUDGET} calls is used up.`);
      }
    }

    const handler = this.registry.get(spec.name);
    for (let attempt = 1; ; attempt++) {
      await this.ledger.startToolExecution(te.id, attempt);
      try {
        if (!handler) throw new ToolFailure("TOOL_UNAVAILABLE", `${spec.name} is not available in this deployment.`);
        const output = await runWithTimeout(handler, parsed.data, investigation);
        return await this.succeed(investigation, te, spec.mode === "url" ? "live-http" : "synthetic-demo", output);
      } catch (error) {
        const e =
          error instanceof ToolFailure
            ? { code: error.code, message: error.message, retryable: error.retryable || TRANSIENT.has(error.code) }
            : { code: "INTERNAL_ERROR", message: "The tool failed unexpectedly.", retryable: false };
        if (e.retryable && attempt === 1) {
          await this.ledger.appendEvent(investigationId, "tool.call_retry_scheduled", {
            toolExecutionId: te.id,
            attempt: attempt + 1,
            delayMs: RETRY_DELAY_MS,
          });
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        await this.ledger.finishToolExecution(te.id, { ok: false, ...e });
        return failure(e.code, e.message, e.retryable);
      }
    }
  }

  private async succeed(
    investigation: Investigation,
    te: ToolExecution,
    provenance: "synthetic-demo" | "live-http",
    output: Awaited<ReturnType<ToolHandler["run"]>>,
  ): Promise<ToolResult> {
    const evidence = await this.ledger.addEvidence(
      investigation.id,
      te.id,
      (output.evidence ?? []).map((e) => ({ ...e, provenance })),
    );
    const content = output.untrustedContent;
    if (content && content.injectionSignals.length > 0) {
      await this.ledger.appendEvent(investigation.id, "guardrail.triggered", {
        kind: "prompt_injection_suspected",
        details: { tool: te.tool, toolExecutionId: te.id, source: content.source, signals: content.injectionSignals },
      });
    }
    const result: ToolResult = {
      ok: true,
      data: output.data,
      evidence: evidence.map((e) => ({ ref: e.ref, statement: e.statement, strength: e.strength as EvidenceStrength })),
      ...(output.warnings?.length ? { warnings: output.warnings } : {}),
      ...(content ? { untrustedContent: content } : {}),
    };
    await this.ledger.finishToolExecution(te.id, { ok: true, output: result, evidenceIds: evidence.map((e) => e.ref) });
    return result;
  }
}

async function runWithTimeout(handler: ToolHandler, input: unknown, investigation: Investigation) {
  const ms = handler.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ToolFailure("TIMEOUT", `The tool did not finish within ${ms} ms.`, true));
    }, ms);
  });
  try {
    return await Promise.race([handler.run(input as never, { investigation, signal: controller.signal }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The answer to a repeated callerRef: what the first call returned, never a re-execution. */
function storedResult(te: ToolExecution): ToolResult {
  switch (te.status) {
    case "SUCCEEDED":
      return te.outputTruncated
        ? failure("OUTPUT_TRUNCATED", "The stored result of this call was too large to replay.")
        : (te.output as ToolResult);
    case "FAILED":
    case "REJECTED":
      return failure(te.errorCode ?? "INTERNAL_ERROR", te.errorMessage ?? "The call failed.", false);
    default:
      return failure("CALL_IN_PROGRESS", "A call with this id is still running.", true);
  }
}
