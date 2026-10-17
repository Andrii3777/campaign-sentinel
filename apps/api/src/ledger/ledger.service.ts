import { Inject, Injectable } from "@nestjs/common";
import {
  eventPayloadSchemas,
  type EventPayload,
  type EventType,
  type EvidenceKind,
  type EvidenceProvenance,
  type EvidenceStrength,
  type FailureCode,
  type InvestigationSource,
  type LedgerRuntime,
  type Severity,
  type ToolRejectionCode,
  type Verdict,
} from "@campaign-sentinel/contracts";
import { PrismaService } from "../db/prisma.service";
import { Prisma } from "../generated/prisma/client";
import type {
  Evidence,
  Investigation,
  InvestigationEvent,
  InvestigationMode,
  InvestigationStatus,
  Report,
  ToolExecution,
} from "../generated/prisma/client";
import { CallerRefReusedError, IllegalTransitionError, InvestigationNotFoundError, ToolExecutionStateError } from "./ledger.errors";

export type { Evidence, Investigation, InvestigationEvent, InvestigationMode, InvestigationStatus, Report, ToolExecution };

export const MAX_TOOL_OUTPUT_BYTES = 64 * 1024;

/** Spec §5.1 state machine. Terminal states have no outgoing edges; a retry is a new run. */
export const ALLOWED_TRANSITIONS: Readonly<Record<InvestigationStatus, readonly InvestigationStatus[]>> = {
  QUEUED: ["RUNNING", "CANCELLED"],
  RUNNING: ["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  INTERRUPTED: [],
};

const TERMINAL: readonly InvestigationStatus[] = ["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"];

export interface CreateInvestigationInput {
  mode: InvestigationMode;
  campaignId?: string;
  targetUrl?: string;
  question: string;
  baselineStart?: Date;
  baselineEnd?: Date;
  currentStart?: Date;
  currentEnd?: Date;
  source: InvestigationSource;
  runtime: LedgerRuntime;
  clientName?: string;
  clientVersion?: string;
  clientUserAgent?: string;
  model?: string;
  idempotencyKey?: string;
  retryOfId?: string;
  provenance?: Prisma.InputJsonObject;
}

export interface TransitionData {
  failureCode?: FailureCode;
  failureMessage?: string;
  model?: string;
}

export interface ToolCallRequest {
  tool: string;
  input: unknown;
  reason: string;
  callerRef?: string;
}

export type ToolOutcome =
  | { ok: true; output: unknown; evidenceIds?: string[] }
  | { ok: false; code: string; message: string; retryable: boolean };

export interface EvidenceInput {
  kind: EvidenceKind;
  strength: EvidenceStrength;
  statement: string;
  data: unknown;
  provenance: EvidenceProvenance;
}

export interface SaveReportInput {
  verdict: Verdict;
  severity: Severity;
  summary: string;
  payload: unknown;
}

export type CounterDeltas = Partial<
  Record<"modelTurns" | "toolCalls" | "reportAttempts" | "httpRequests" | "inputTokens" | "outputTokens", number>
>;

export type InvestigationDetail = Investigation & {
  report: Report | null;
  /** ordered by number: E1, E2, … E10 */
  evidence: Evidence[];
  /** in call order (createdAt, then id) */
  toolExecutions: ToolExecution[];
  campaign: { name: string } | null;
  retries: { id: string }[];
};

/** A list row with what the list DTO shows next to the run. */
export type InvestigationListRow = Investigation & {
  campaign: { name: string } | null;
  report: { verdict: string; severity: string } | null;
};

export interface ListInvestigationsInput {
  limit?: number;
  cursor?: string;
  mode?: InvestigationMode;
  status?: InvestigationStatus;
}

type Tx = Prisma.TransactionClient;

const json = (value: unknown) => value as Prisma.InputJsonValue;

/**
 * The only writer of investigation state. Every state change and its event are written in one
 * transaction; event `seq` and evidence refs come from row-locked counters on Investigation,
 * so they are gap-free per investigation under concurrency.
 */
@Injectable()
export class LedgerService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Creates a QUEUED run. With an idempotency key already used, returns that run and `created: false`. */
  async create(input: CreateInvestigationInput): Promise<{ investigation: Investigation; created: boolean }> {
    if (input.idempotencyKey) {
      const existing = await this.prisma.investigation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return { investigation: existing, created: false };
    }
    try {
      const investigation = await this.prisma.$transaction(async (tx) => {
        const { provenance, ...rest } = input;
        const created = await tx.investigation.create({ data: { ...rest, provenance: provenance ?? {} } });
        await this.insertEvent(tx, created.id, "investigation.created", {
          mode: created.mode === "DEMO" ? "demo" : "url",
          source: input.source,
          runtime: input.runtime,
          client: {
            name: input.clientName ?? null,
            version: input.clientVersion ?? null,
            userAgent: input.clientUserAgent ?? null,
          },
        });
        return tx.investigation.findUniqueOrThrow({ where: { id: created.id } });
      });
      return { investigation, created: true };
    } catch (error) {
      // lost a race on the same idempotency key: the winner's run is the answer
      if (input.idempotencyKey && isUniqueViolation(error)) {
        const existing = await this.prisma.investigation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (existing) return { investigation: existing, created: false };
      }
      throw error;
    }
  }

  /**
   * Moves a run `from` → `to` only if that edge exists and the run is currently `from`
   * (`UPDATE … WHERE status = from`). Otherwise throws IllegalTransitionError and writes nothing.
   * Appends `investigation.<to>` in the same transaction.
   */
  async transition(
    id: string,
    from: InvestigationStatus,
    to: InvestigationStatus,
    data: TransitionData = {},
  ): Promise<Investigation> {
    return this.prisma.$transaction((tx) => this.transitionTx(tx, id, from, to, data));
  }

  /**
   * RUNNING → COMPLETED together with the report row and `report.accepted`, in ONE transaction:
   * a Report exists only for a COMPLETED run. A run that is no longer RUNNING throws IllegalTransitionError
   * and a second report for the same run throws a unique violation; both roll everything back.
   */
  async completeWithReport(id: string, attempt: number, report: SaveReportInput): Promise<Report> {
    return this.prisma.$transaction(async (tx) => {
      await this.transitionTx(tx, id, "RUNNING", "COMPLETED", {}, async () => {
        await this.insertEvent(tx, id, "report.accepted", { attempt, verdict: report.verdict, severity: report.severity });
      });
      return tx.report.create({
        data: {
          investigationId: id,
          schemaVersion: "1",
          verdict: report.verdict,
          severity: report.severity,
          summary: report.summary,
          payload: json(report.payload),
        },
      });
    });
  }

  private async transitionTx(
    tx: Tx,
    id: string,
    from: InvestigationStatus,
    to: InvestigationStatus,
    data: TransitionData,
    beforeEvent?: () => Promise<void>,
  ): Promise<Investigation> {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) throw new IllegalTransitionError(id, from, to, null);
    const now = new Date();
    const failureCode = to === "INTERRUPTED" ? (data.failureCode ?? "INTERRUPTED") : data.failureCode;
    const failureMessage =
      data.failureMessage ?? (to === "INTERRUPTED" ? "The run stopped making progress and was interrupted." : undefined);
    if (to === "FAILED" && (!failureCode || !failureMessage)) {
      throw new TypeError("transition to FAILED needs failureCode and failureMessage");
    }

    const { count } = await tx.investigation.updateMany({
      where: { id, status: from },
      data: {
        status: to,
        lastActivityAt: now,
        ...(to === "RUNNING" ? { startedAt: now } : {}),
        ...(TERMINAL.includes(to) ? { finishedAt: now } : {}),
        ...(failureCode ? { failureCode, failureMessage } : {}),
        ...(data.model ? { model: data.model } : {}),
      },
    });
    if (count === 0) {
      const current = await tx.investigation.findUnique({ where: { id }, select: { status: true } });
      if (!current) throw new InvestigationNotFoundError(id);
      throw new IllegalTransitionError(id, from, to, current.status);
    }
    await beforeEvent?.();
    switch (to) {
      case "RUNNING":
        await this.insertEvent(tx, id, "investigation.started", {});
        break;
      case "COMPLETED":
        await this.insertEvent(tx, id, "investigation.completed", {});
        break;
      case "CANCELLED":
        await this.insertEvent(tx, id, "investigation.cancelled", data.failureMessage ? { message: data.failureMessage } : {});
        break;
      case "FAILED":
      case "INTERRUPTED":
        await this.insertEvent(tx, id, to === "FAILED" ? "investigation.failed" : "investigation.interrupted", {
          code: failureCode!,
          message: failureMessage!,
        });
        break;
    }
    return tx.investigation.findUniqueOrThrow({ where: { id } });
  }

  /** Appends one event with the next seq. The payload is validated against the contracts schema for its type. */
  async appendEvent<T extends EventType>(id: string, type: T, payload: EventPayload<T>): Promise<InvestigationEvent> {
    return this.prisma.$transaction((tx) => this.insertEvent(tx, id, type, payload));
  }

  /**
   * Records an attempted call (REQUESTED). A repeated `callerRef` with the same tool and input returns the
   * existing execution, `deduplicated: true` (also when two requests race); with another tool or input it throws
   * CallerRefReusedError.
   */
  async requestToolExecution(
    investigationId: string,
    call: ToolCallRequest,
  ): Promise<{ toolExecution: ToolExecution; deduplicated: boolean }> {
    const input = call.input ?? {};
    const findExisting = async () => {
      if (!call.callerRef) return null;
      const existing = await this.prisma.toolExecution.findUnique({
        where: { investigationId_callerRef: { investigationId, callerRef: call.callerRef } },
      });
      if (!existing) return null;
      if (existing.tool !== call.tool || canonical(existing.input) !== canonical(input)) throw new CallerRefReusedError(call.callerRef);
      await this.appendEvent(investigationId, "tool.call_deduplicated", { toolExecutionId: existing.id, callerRef: call.callerRef });
      return { toolExecution: existing, deduplicated: true };
    };
    const repeated = await findExisting();
    if (repeated) return repeated;
    try {
      const toolExecution = await this.prisma.$transaction(async (tx) => {
        const te = await tx.toolExecution.create({
          data: {
            investigationId,
            tool: call.tool,
            callerRef: call.callerRef,
            input: json(input),
            reason: call.reason,
          },
        });
        await this.insertEvent(tx, investigationId, "tool.call_requested", {
          toolExecutionId: te.id,
          tool: call.tool,
          input: call.input,
          reason: call.reason,
          callerRef: call.callerRef ?? null,
        });
        return te;
      });
      return { toolExecution, deduplicated: false };
    } catch (error) {
      // lost a race on the same callerRef: the winner's execution is the answer
      if (call.callerRef && isUniqueViolation(error)) {
        const winner = await findExisting();
        if (winner) return winner;
      }
      throw error;
    }
  }

  /** REQUESTED → RUNNING (attempt 1), or RUNNING → RUNNING for a retry attempt. */
  async startToolExecution(toolExecutionId: string, attempt: number): Promise<ToolExecution> {
    return this.prisma.$transaction(async (tx) => {
      const te = await this.lockToolExecution(tx, toolExecutionId);
      if (te.status !== "REQUESTED" && te.status !== "RUNNING") {
        throw new ToolExecutionStateError(toolExecutionId, te.status, "start");
      }
      const updated = await tx.toolExecution.update({
        where: { id: toolExecutionId },
        data: { status: "RUNNING", attempt, startedAt: te.startedAt ?? new Date() },
      });
      await this.insertEvent(tx, te.investigationId, "tool.call_started", { toolExecutionId, attempt });
      return updated;
    });
  }

  /** RUNNING → SUCCEEDED / FAILED with duration; output above 64 KB is stored truncated with `outputTruncated`. */
  async finishToolExecution(toolExecutionId: string, outcome: ToolOutcome): Promise<ToolExecution> {
    return this.prisma.$transaction(async (tx) => {
      const te = await this.lockToolExecution(tx, toolExecutionId);
      if (te.status !== "RUNNING") throw new ToolExecutionStateError(toolExecutionId, te.status, "finish");
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - (te.startedAt ?? finishedAt).getTime();
      if (outcome.ok) {
        const { output, truncated } = capOutput(outcome.output);
        const updated = await tx.toolExecution.update({
          where: { id: toolExecutionId },
          data: { status: "SUCCEEDED", output, outputTruncated: truncated, finishedAt, durationMs },
        });
        await this.insertEvent(tx, te.investigationId, "tool.call_succeeded", {
          toolExecutionId,
          durationMs,
          attempt: te.attempt,
          evidenceIds: outcome.evidenceIds ?? [],
        });
        return updated;
      }
      const updated = await tx.toolExecution.update({
        where: { id: toolExecutionId },
        data: { status: "FAILED", errorCode: outcome.code, errorMessage: outcome.message, finishedAt, durationMs },
      });
      await this.insertEvent(tx, te.investigationId, "tool.call_failed", {
        toolExecutionId,
        durationMs,
        attempt: te.attempt,
        code: outcome.code,
        retryable: outcome.retryable,
      });
      return updated;
    });
  }

  /** REQUESTED → REJECTED: the call was attempted but never executed. */
  async rejectToolExecution(toolExecutionId: string, code: ToolRejectionCode, issues: unknown[]): Promise<ToolExecution> {
    return this.prisma.$transaction(async (tx) => {
      const te = await this.lockToolExecution(tx, toolExecutionId);
      if (te.status !== "REQUESTED") throw new ToolExecutionStateError(toolExecutionId, te.status, "reject");
      const updated = await tx.toolExecution.update({
        where: { id: toolExecutionId },
        data: {
          status: "REJECTED",
          errorCode: code,
          errorMessage: issues.map((i) => (typeof i === "string" ? i : JSON.stringify(i))).join("; ").slice(0, 2000),
          finishedAt: new Date(),
        },
      });
      await this.insertEvent(tx, te.investigationId, "tool.call_rejected", { toolExecutionId, code, issues });
      return updated;
    });
  }

  /** Stores evidence with refs E1, E2… continuing per investigation; emits `evidence.recorded` for each. */
  async addEvidence(investigationId: string, toolExecutionId: string, items: EvidenceInput[]): Promise<Evidence[]> {
    if (items.length === 0) return [];
    return this.prisma.$transaction(async (tx) => {
      const te = await tx.toolExecution.findUnique({ where: { id: toolExecutionId }, select: { investigationId: true } });
      if (!te || te.investigationId !== investigationId) {
        throw new TypeError(`tool execution ${toolExecutionId} does not belong to investigation ${investigationId}`);
      }
      const { lastEvidenceNo } = await tx.investigation
        .update({
          where: { id: investigationId },
          data: { lastEvidenceNo: { increment: items.length } },
          select: { lastEvidenceNo: true },
        })
        .catch(notFound(investigationId));
      const first = lastEvidenceNo - items.length + 1;
      const created: Evidence[] = [];
      for (const [i, item] of items.entries()) {
        const evidence = await tx.evidence.create({
          data: { ...item, data: json(item.data), investigationId, toolExecutionId, ref: `E${first + i}` },
        });
        await this.insertEvent(tx, investigationId, "evidence.recorded", {
          evidenceId: evidence.ref,
          kind: item.kind,
          strength: item.strength,
          statement: item.statement,
        });
        created.push(evidence);
      }
      return created;
    });
  }

  async getInvestigation(id: string): Promise<InvestigationDetail | null> {
    const found = await this.prisma.investigation.findUnique({
      where: { id },
      include: {
        report: true,
        evidence: true,
        toolExecutions: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        campaign: { select: { name: true } },
        retries: { select: { id: true }, orderBy: { createdAt: "asc" } },
      },
    });
    found?.evidence.sort((a, b) => Number(a.ref.slice(1)) - Number(b.ref.slice(1)));
    return found;
  }

  /** Newest first. `nextCursor` is the id to pass as `cursor` for the next page, or null. */
  async listInvestigations(input: ListInvestigationsInput = {}): Promise<{ items: InvestigationListRow[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const rows = await this.prisma.investigation.findMany({
      where: { mode: input.mode, status: input.status },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: { campaign: { select: { name: true } }, report: { select: { verdict: true, severity: true } } },
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items[items.length - 1]!.id : null };
  }

  async getEventsAfter(id: string, seq: number): Promise<InvestigationEvent[]> {
    return this.prisma.investigationEvent.findMany({
      where: { investigationId: id, seq: { gt: seq } },
      orderBy: { seq: "asc" },
    });
  }

  /** Marks activity (heartbeat used by stale-run detection). */
  async touch(id: string): Promise<void> {
    await this.prisma.investigation.update({ where: { id }, data: { lastActivityAt: new Date() } }).catch(notFound(id));
  }

  async incrementCounters(id: string, deltas: CounterDeltas): Promise<Investigation> {
    const data = Object.fromEntries(Object.entries(deltas).map(([k, v]) => [k, { increment: v }]));
    return this.prisma.investigation
      .update({ where: { id }, data: { ...data, lastActivityAt: new Date() } })
      .catch(notFound(id));
  }

  private async insertEvent<T extends EventType>(
    tx: Tx,
    id: string,
    type: T,
    payload: EventPayload<T>,
  ): Promise<InvestigationEvent> {
    const parsed = eventPayloadSchemas[type].parse(payload);
    // row lock on the investigation serialises seq allocation until commit
    const { lastEventSeq } = await tx.investigation
      .update({
        where: { id },
        data: { lastEventSeq: { increment: 1 }, lastActivityAt: new Date() },
        select: { lastEventSeq: true },
      })
      .catch(notFound(id));
    return tx.investigationEvent.create({
      data: { investigationId: id, seq: lastEventSeq, type, payload: json(parsed) },
    });
  }

  private async lockToolExecution(tx: Tx, id: string): Promise<ToolExecution> {
    await tx.$executeRaw`SELECT 1 FROM "ToolExecution" WHERE id = ${id} FOR UPDATE`;
    const te = await tx.toolExecution.findUnique({ where: { id } });
    if (!te) throw new ToolExecutionStateError(id, "MISSING", "update");
    return te;
  }
}

function capOutput(output: unknown): { output: Prisma.InputJsonValue; truncated: boolean } {
  const text = JSON.stringify(output ?? null);
  if (Buffer.byteLength(text) <= MAX_TOOL_OUTPUT_BYTES) return { output: json(output ?? null), truncated: false };
  // leave room for the wrapper and JSON escaping of the preview
  const preview = Buffer.from(text).subarray(0, MAX_TOOL_OUTPUT_BYTES / 2).toString("utf8");
  return { output: { truncated: true, originalBytes: Buffer.byteLength(text), preview }, truncated: true };
}

/** JSON with sorted keys: jsonb does not keep key order, so equal inputs compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function notFound(id: string) {
  return (error: unknown): never => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new InvestigationNotFoundError(id);
    }
    throw error;
  };
}
