import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { renderSystemPrompt, toolInputJsonSchema, toolsForMode, type FailureCode } from "@campaign-sentinel/contracts";
import { PrismaService } from "../db/prisma.service";
import { IllegalTransitionError, InvestigationNotFoundError } from "../ledger/ledger.errors";
import { LedgerService, type Investigation } from "../ledger/ledger.service";
import { REPORT_ATTEMPT_BUDGET, ReportService } from "../reports/report.service";
import { TOOL_CALL_BUDGET, ToolExecutor } from "../tools/tool-executor";
import { OpenClawDispatcher, FINAL_TEXT_LIMIT, truncateText } from "./openclaw/openclaw-dispatcher";
import { AgentSessionError, type AgentBudgets, type AgentSession, type AgentTask, type AgentTurn, type ToolResultForModel } from "./session";
import { SessionFactory } from "./session-factory";

/** Spec story 50 (built-in runtimes). */
export const RUN_BUDGETS: AgentBudgets = {
  turns: 16,
  toolCalls: TOOL_CALL_BUDGET,
  reportAttempts: REPORT_ATTEMPT_BUDGET,
  wallClockMs: 5 * 60_000,
};
export const RUNNER_CONCURRENCY = 2;
export const MAX_NUDGES = 2;
export const MODEL_RETRY_DELAY_MS = 1_000;
/** Spec story 55. */
export const STALE_BUILT_IN_MS = 60_000;
export const EXTERNAL_IDLE_MS = 15 * 60_000;
export const SWEEP_INTERVAL_MS = 60_000;
export const NUDGE =
  "You did not call a tool. Continue the investigation with a tool call, or call submit_report with your final report.";

/** Runtimes the app drives itself (an `external` run is driven by an outside agent through the Agent API). */
const BUILT_IN_RUNTIMES = ["deterministic", "ai", "openclaw"];

class Stop extends Error {}
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The single agent loop (spec §5.2): queue (concurrency 2) → createSession → start → per turn: record
 * `agent.turn`, refusal → MODEL_REFUSED, no tool call → nudge (max 2) else NO_REPORT, run every tool call
 * through ToolExecutor and hand all results back in one `continue`; ReportService completes or fails the
 * run. Abort signal, turn and wall-clock budgets are checked before each model and tool call.
 */
@Injectable()
export class Runner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("Runner");
  private readonly queue: string[] = [];
  private readonly active = new Map<string, AbortController>();
  private readonly running = new Set<Promise<void>>();
  private sweepTimer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ToolExecutor) private readonly executor: ToolExecutor,
    @Inject(ReportService) private readonly reports: ReportService,
    @Inject(SessionFactory) readonly sessions: SessionFactory,
    @Inject(OpenClawDispatcher) private readonly openclaw: OpenClawDispatcher,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.recoverStale();
    this.sweepTimer = setInterval(() => void this.sweep().catch((e) => this.logger.error(e)), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.sweepTimer);
    this.queue.length = 0;
    for (const c of this.active.values()) c.abort();
    await Promise.allSettled([...this.running]);
  }

  /** Queues a QUEUED run; at most RUNNER_CONCURRENCY run at once. */
  enqueue(id: string): void {
    if (!this.queue.includes(id) && !this.active.has(id)) this.queue.push(id);
    this.pump();
  }

  /** Resolves when no run is queued or active (tests, shutdown). */
  async whenIdle(): Promise<void> {
    while (this.running.size > 0 || this.queue.length > 0) await Promise.allSettled([...this.running]);
  }

  /** QUEUED/RUNNING → CANCELLED and aborts the loop; a terminal run throws IllegalTransitionError (409). */
  async cancel(id: string): Promise<Investigation> {
    const inv = await this.prisma.investigation.findUnique({ where: { id } });
    if (!inv) throw new InvestigationNotFoundError(id);
    const index = this.queue.indexOf(id);
    if (index >= 0) this.queue.splice(index, 1);
    const from = inv.status === "QUEUED" ? "QUEUED" : "RUNNING";
    const cancelled = await this.ledger.transition(id, from, "CANCELLED", { failureMessage: "Cancelled by the user." });
    this.active.get(id)?.abort();
    return cancelled;
  }

  /**
   * Startup recovery (story 55): built-in runs RUNNING without activity for > 60 s → INTERRUPTED, and every
   * QUEUED built-in run is queued again (the in-memory queue died with the previous process).
   */
  async recoverStale(): Promise<number> {
    const count = await this.interrupt(BUILT_IN_RUNTIMES, STALE_BUILT_IN_MS, "The API restarted while this run was in progress.");
    const queued = await this.prisma.investigation.findMany({
      where: { status: "QUEUED", runtime: { in: BUILT_IN_RUNTIMES } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    for (const { id } of queued) this.enqueue(id);
    return count;
  }

  /** 60 s sweep: built-in runs idle > 60 s that this process is not driving, and external runs idle > 15 min → INTERRUPTED. */
  async sweep(): Promise<number> {
    return (
      (await this.interrupt(BUILT_IN_RUNTIMES, STALE_BUILT_IN_MS, "The run stopped making progress and was interrupted.")) +
      (await this.interrupt(["external"], EXTERNAL_IDLE_MS, "The external agent was inactive for more than 15 minutes."))
    );
  }

  /** Drives one QUEUED investigation to a terminal state (used by the queue; awaited directly in tests). */
  async run(id: string): Promise<void> {
    const controller = new AbortController();
    this.active.set(id, controller);
    try {
      await this.drive(id, controller.signal);
    } catch (error) {
      try {
        if (error instanceof BudgetStop) {
          await this.fail(id, "BUDGET_EXCEEDED", "The run exceeded its 5 minute wall-clock budget.");
        } else if (!(error instanceof Stop)) {
          this.logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
          await this.fail(id, "INTERNAL_ERROR", "The run failed unexpectedly.");
        }
      } catch (inner) {
        // e.g. the database is down: the sweep interrupts the run later; never crash the process
        this.logger.error(inner instanceof Error ? (inner.stack ?? inner.message) : String(inner));
      }
    } finally {
      this.active.delete(id);
    }
  }

  private pump(): void {
    while (this.running.size < RUNNER_CONCURRENCY && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const p: Promise<void> = this.run(id).finally(() => {
        this.running.delete(p);
        this.pump();
      });
      this.running.add(p);
    }
  }

  private async drive(id: string, signal: AbortSignal): Promise<void> {
    const inv = await this.prisma.investigation.findUnique({ where: { id } });
    if (!inv || inv.status !== "QUEUED") return;
    if (inv.runtime === "openclaw") return this.driveOpenClaw(inv, signal);
    let session: AgentSession;
    try {
      session = this.sessions.createSession(inv);
    } catch (error) {
      await this.ledger.transition(id, "QUEUED", "RUNNING");
      const e = error instanceof AgentSessionError ? error : new AgentSessionError("RUNTIME_UNAVAILABLE", "The runtime could not be started.");
      return this.fail(id, e.code, e.message);
    }
    await this.ledger.transition(id, "QUEUED", "RUNNING", { model: session.model });
    const deadline = Date.now() + RUN_BUDGETS.wallClockMs;
    const task = buildTask(inv);

    let turn = await this.callModel(id, () => session.start(task), signal, deadline);
    let turns = 0;
    let nudges = 0;
    for (;;) {
      turns++;
      await this.recordTurn(id, turns, session.model, turn);
      if (turn.stopReason === "refusal") return this.fail(id, "MODEL_REFUSED", "The model refused to continue.");

      const results: ToolResultForModel[] = [];
      let nudge: string | undefined;
      if (turn.toolCalls.length === 0) {
        if (++nudges > MAX_NUDGES) return this.fail(id, "NO_REPORT", "The agent stopped without submitting a report.");
        nudge = NUDGE;
      } else {
        for (const call of turn.toolCalls) {
          this.check(signal, deadline);
          const result = await this.executor.execute(id, { tool: call.tool, input: call.input, callerRef: call.callerRef });
          results.push({ callerRef: call.callerRef, tool: call.tool, result });
        }
        await this.reports.recordToolFailures(id);
        // ReportService completes or fails the run; a cancel moves it to CANCELLED
        const { status } = await this.prisma.investigation.findUniqueOrThrow({ where: { id }, select: { status: true } });
        if (status !== "RUNNING") return;
      }
      if (turns >= RUN_BUDGETS.turns) {
        return this.fail(id, "BUDGET_EXCEEDED", `The agent used all ${RUN_BUDGETS.turns} turns without an accepted report.`);
      }
      turn = await this.callModel(id, () => session.continue(results, nudge), signal, deadline);
    }
  }

  /**
   * Runtime `openclaw` (spec 5.13): the gateway's agent works through MCP and the Agent API; here we only wait
   * for its answer, then judge by the stored run: still RUNNING means it never submitted an accepted report.
   */
  private async driveOpenClaw(inv: Investigation, signal: AbortSignal): Promise<void> {
    const id = inv.id;
    await this.ledger.transition(id, "QUEUED", "RUNNING", { model: `openclaw:${this.openclaw.agentId}` });
    let text: string;
    try {
      text = await this.openclaw.dispatch(buildTask(inv), signal);
    } catch (error) {
      if (signal.aborted) throw new Stop();
      const e = error instanceof AgentSessionError ? error : new AgentSessionError("RUNTIME_UNAVAILABLE", "The OpenClaw gateway could not be used.");
      return this.fail(id, e.code, e.message);
    }
    const { status } = await this.prisma.investigation.findUniqueOrThrow({ where: { id }, select: { status: true } });
    if (status !== "RUNNING") return;
    const tail = text.trim() ? ` Its final message: "${truncateText(text.trim(), FINAL_TEXT_LIMIT)}"` : " It sent no final message.";
    return this.fail(id, "NO_REPORT", `OpenClaw finished without an accepted report.${tail}`);
  }

  /** Throws Stop when cancelled; fails the run when the wall-clock budget is spent. */
  private check(signal: AbortSignal, deadline: number): void {
    if (signal.aborted) throw new Stop();
    if (Date.now() > deadline) throw new BudgetStop();
  }

  private async callModel(id: string, call: () => Promise<AgentTurn>, signal: AbortSignal, deadline: number): Promise<AgentTurn> {
    for (let attempt = 1; ; attempt++) {
      try {
        this.check(signal, deadline);
        return await raceDeadline(call(), signal, deadline);
      } catch (error) {
        if (error instanceof Stop) {
          if (error instanceof BudgetStop) await this.fail(id, "BUDGET_EXCEEDED", "The run exceeded its 5 minute wall-clock budget.");
          throw error;
        }
        const e = error instanceof AgentSessionError ? error : null;
        const code: FailureCode = e?.code ?? "INTERNAL_ERROR";
        await this.ledger.appendEvent(id, "model.call_failed", { code, attempt });
        if (e?.retryable && attempt === 1) {
          await this.ledger.appendEvent(id, "model.call_retry", { code, attempt: attempt + 1 });
          await new Promise((r) => setTimeout(r, MODEL_RETRY_DELAY_MS));
          continue;
        }
        if (!e) this.logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
        await this.fail(id, code, e?.message ?? "The agent session failed unexpectedly.");
        throw new Stop();
      }
    }
  }

  private async recordTurn(id: string, turn: number, model: string, t: AgentTurn): Promise<void> {
    await this.ledger.incrementCounters(id, {
      modelTurns: 1,
      inputTokens: t.usage?.inputTokens ?? 0,
      outputTokens: t.usage?.outputTokens ?? 0,
    });
    await this.ledger.appendEvent(id, "agent.turn", {
      turn,
      model,
      stopReason: t.stopReason,
      inputTokens: t.usage?.inputTokens ?? null,
      outputTokens: t.usage?.outputTokens ?? null,
    });
  }

  /** RUNNING → FAILED; a run that already ended (cancelled, completed) stays as it is. */
  private async fail(id: string, failureCode: FailureCode, failureMessage: string): Promise<void> {
    try {
      await this.ledger.transition(id, "RUNNING", "FAILED", { failureCode, failureMessage });
    } catch (error) {
      if (!(error instanceof IllegalTransitionError)) throw error;
    }
  }

  private async interrupt(runtimes: string[], idleMs: number, failureMessage: string): Promise<number> {
    const stale = await this.prisma.investigation.findMany({
      where: { status: "RUNNING", runtime: { in: runtimes }, lastActivityAt: { lt: new Date(Date.now() - idleMs) } },
      select: { id: true },
    });
    let count = 0;
    for (const { id } of stale) {
      if (this.active.has(id)) continue;
      try {
        await this.ledger.transition(id, "RUNNING", "INTERRUPTED", { failureCode: "INTERRUPTED", failureMessage });
        count++;
      } catch (error) {
        if (!(error instanceof IllegalTransitionError)) throw error;
      }
    }
    return count;
  }
}

class BudgetStop extends Stop {}

function raceDeadline<T>(promise: Promise<T>, signal: AbortSignal, deadline: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new BudgetStop()), Math.max(0, deadline - Date.now()));
    const onAbort = () => reject(new Stop());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    });
  });
}

/** The task handed to `session.start`: mode-scoped tools, the versioned system prompt, budgets. */
export function buildTask(inv: Investigation): AgentTask {
  const mode = inv.mode === "DEMO" ? "demo" : "url";
  const periods =
    inv.baselineStart && inv.baselineEnd && inv.currentStart && inv.currentEnd
      ? {
          baseline: { start: day(inv.baselineStart), end: day(inv.baselineEnd) },
          current: { start: day(inv.currentStart), end: day(inv.currentEnd) },
        }
      : null;
  return {
    investigationId: inv.id,
    mode,
    question: inv.question,
    campaignId: inv.campaignId,
    targetUrl: inv.targetUrl,
    periods,
    systemPrompt: renderSystemPrompt(mode),
    tools: toolsForMode(mode).map((s) => ({ name: s.name, description: s.description, inputSchema: toolInputJsonSchema(s.name) })),
    budgets: RUN_BUDGETS,
  };
}
