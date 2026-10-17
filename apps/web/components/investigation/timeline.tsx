"use client";

import type { ToolExecutionDto } from "@campaign-sentinel/contracts";
import { Ban, Bot, ChevronRight, CircleCheck, CircleX, Flag, RotateCw, ShieldAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { JsonView } from "@/components/ui/json-view";
import { stratumFill, stratumOfTool } from "@/components/ui/kind-chip";
import { formatDuration, formatOffset, humanize } from "@/lib/format";
import type { TimelineRow, ToolRow } from "@/lib/timeline";
import { EvidenceChip, ToolStatusMark } from "./status-marks";

type Props = {
  rows: readonly TimelineRow[];
  executions: ReadonlyMap<string, ToolExecutionDto>;
  startAt: string;
  activeKey: string | null;
  onActive: (key: string | null) => void;
  onEvidenceActive: (ref: string | null) => void;
};

/** Persisted events only, in fixed columns: layer, time, tool, reason, status, duration. A state change restyles a cell, never moves one. */
export function Timeline({ rows, executions, startAt, activeKey, onActive, onEvidenceActive }: Props) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const toolRows = rows.filter((r): r is ToolRow => r.kind === "tool");
  const toolNames = new Map(toolRows.map((r) => [r.toolExecutionId, r.tool]));
  const callNumbers = new Map(toolRows.map((r, i) => [r.toolExecutionId, i + 1]));

  return (
    <div className="min-w-0 flex-1">
      <div aria-hidden className="tl-row border-b border-hairline px-3 py-2 text-xs font-semibold text-ink-2 max-md:hidden">
        <span className="tl-layer" />
        <span className="tl-time">Time</span>
        <span className="tl-tool">Tool</span>
        <span className="tl-reason">Declared reason</span>
        <span className="tl-status">Status</span>
        <span className="tl-dur text-right">Duration</span>
      </div>
      <ol className="list-none">
        {rows.map((row) => {
          const cells = cellsFor(row, toolNames, callNumbers, onEvidenceActive, open.has(row.key), () => toggle(row.key), onActive);
          if (row.kind !== "tool") {
            return (
              <li
                key={row.key}
                id={`row-${row.key}`}
                data-active={activeKey === row.key}
                className="hl border-b border-hairline"
                onMouseEnter={() => onActive(row.key)}
                onMouseLeave={() => onActive(null)}
              >
                <div className="tl-row px-3 py-2">
                  <Time row={row} startAt={startAt} />
                  {cells}
                </div>
              </li>
            );
          }
          const isOpen = open.has(row.key);
          return (
            <li
              key={row.key}
              id={`call-${row.toolExecutionId}`}
              data-active={activeKey === row.key}
              className="hl border-b border-hairline"
              onMouseEnter={() => onActive(row.key)}
              onMouseLeave={() => onActive(null)}
            >
              <div className="tl-row relative px-3 py-2">
                <Time row={row} startAt={startAt} />
                {cells}
              </div>
              {isOpen ? <ToolDetail row={row} execution={executions.get(row.toolExecutionId)} onEvidenceActive={onEvidenceActive} /> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Time({ row, startAt }: { row: TimelineRow; startAt: string }) {
  return (
    <time dateTime={row.at} title={row.at} className="tl-time pt-0.5 font-mono text-xs text-ink-2">
      {formatOffset(startAt, row.at)}
    </time>
  );
}

function Layer({ className }: { className: string }) {
  return <span aria-hidden className={`tl-layer mt-1 size-3 rounded-[2px] ${className}`} />;
}

function Status({ icon: Icon, label, tone, sub }: { icon: LucideIcon; label: string; tone: string; sub?: string }) {
  return (
    <span className={`tl-status flex flex-col items-end md:items-start ${tone}`}>
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
        <Icon aria-hidden className="size-3.5 shrink-0" />
        {label}
      </span>
      {sub ? <span className="text-xs font-normal text-ink-2">{sub}</span> : null}
    </span>
  );
}

const Tool = ({ children }: { children: ReactNode }) => <span className="tl-tool min-w-0 text-sm font-medium break-words">{children}</span>;
const Reason = ({ children }: { children?: ReactNode }) => <span className="tl-reason min-w-0 text-sm break-words text-ink-2">{children}</span>;
const Dur = ({ ms }: { ms?: number | null }) => <span className="tl-dur text-right text-xs text-ink-2 md:pt-0.5">{ms === undefined ? "" : formatDuration(ms)}</span>;

function cellsFor(row: TimelineRow, toolNames: ReadonlyMap<string, string>, callNumbers: ReadonlyMap<string, number>, onEvidenceActive: (ref: string | null) => void, isOpen: boolean, toggle: () => void, onActive: (key: string | null) => void): ReactNode {
  switch (row.kind) {
    case "tool":
      return (
        <>
          <Layer className={stratumFill[stratumOfTool(row.tool)]} />
          <span className="tl-tool min-w-0">
            <button
              id={`row-${row.key}`}
              type="button"
              aria-expanded={isOpen}
              aria-controls={`detail-${row.key}`}
              onClick={toggle}
              onFocus={() => onActive(row.key)}
              onBlur={() => onActive(null)}
              className="inline-flex cursor-pointer items-start gap-1 text-left font-mono text-xs font-medium break-words md:break-all after:absolute after:inset-0 after:content-['']"
            >
              <ChevronRight aria-hidden className={`mt-0.5 size-3.5 shrink-0 text-ink-2 transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`} />
              <span>
                <span className="mr-1 text-ink-2">#{callNumbers.get(row.toolExecutionId)}</span>
                {row.tool}
              </span>
            </button>
          </span>
          <Reason>
            {row.reason}
            {row.evidenceRefs.length > 0 ? (
              <span className="relative z-10 mt-1 flex flex-wrap gap-1">
                {row.evidenceRefs.map((ref) => (
                  <EvidenceChip key={ref} id={ref} onActive={onEvidenceActive} />
                ))}
              </span>
            ) : null}
          </Reason>
          <span className="tl-status flex flex-col items-end md:items-start">
            <ToolStatusMark status={row.status} />
            <span className="text-xs text-ink-2">{row.attempt > 0 ? `attempt ${row.attempt}` : "not started"}</span>
          </span>
          <Dur ms={row.durationMs} />
        </>
      );
    case "lifecycle":
      return (
        <>
          <Layer className="border border-hairline bg-surface" />
          <Tool>{row.label}</Tool>
          <Reason />
          <span className="tl-status" />
          <Dur />
        </>
      );
    case "turn": {
      const tokens = row.inputTokens !== null || row.outputTokens !== null ? ` · tokens in ${row.inputTokens ?? "—"} / out ${row.outputTokens ?? "—"}` : "";
      return (
        <>
          <Layer className="border border-hairline bg-surface" />
          <Tool>
            <span className="inline-flex items-center gap-1.5">
              <Bot aria-hidden className="size-3.5 text-ink-2" />
              Model turn {row.turn}
            </span>
          </Tool>
          <Reason>
            <span className="font-mono text-xs">{row.model}</span> · stop reason {row.stopReason}
            {tokens}
          </Reason>
          <span className="tl-status" />
          <Dur />
        </>
      );
    }
    case "retry":
      return (
        <>
          <Layer className="bg-degraded" />
          <Tool>Retry scheduled</Tool>
          <Reason>
            <span className="font-mono text-xs">{toolNames.get(row.toolExecutionId) ?? "tool call"}</span> will run again as attempt {row.attempt} after {formatDuration(row.delayMs)}.
          </Reason>
          <Status icon={RotateCw} label="Retrying" tone="text-degraded" />
          <Dur />
        </>
      );
    case "dedup":
      return (
        <>
          <Layer className="border border-hairline bg-surface" />
          <Tool>Duplicate call</Tool>
          <Reason>
            Call <span className="font-mono text-xs">{row.callerRef}</span> repeated an earlier request; the earlier result was returned.
          </Reason>
          <Status icon={Ban} label="Deduplicated" tone="text-ink-2" />
          <Dur />
        </>
      );
    case "guardrail":
      return (
        <>
          <Layer className="bg-guardrail" />
          <Tool>Guardrail</Tool>
          <Reason>
            <span className="font-semibold text-guardrail">{humanize(row.guardKind)}</span>
            <span className="mt-0.5 block font-mono text-xs break-all">{JSON.stringify(row.details)}</span>
          </Reason>
          <Status icon={ShieldAlert} label="Triggered" tone="text-guardrail" />
          <Dur />
        </>
      );
    case "model":
      return (
        <>
          <Layer className="bg-degraded" />
          <Tool>{row.outcome === "failed" ? "Model call failed" : "Model call retried"}</Tool>
          <Reason>
            <span className="font-mono text-xs">{row.code}</span> · attempt {row.attempt}
          </Reason>
          <Status icon={TriangleAlert} label={row.outcome === "failed" ? "Failed" : "Retrying"} tone="text-degraded" />
          <Dur />
        </>
      );
    case "report":
      return row.outcome === "accepted" ? (
        <>
          <Layer className="bg-stratum-report" />
          <Tool>Report accepted</Tool>
          <Reason>
            Attempt {row.attempt} · verdict {humanize(row.verdict).toLowerCase()} · severity {row.severity}
          </Reason>
          <Status icon={CircleCheck} label="Accepted" tone="text-ok" />
          <Dur />
        </>
      ) : (
        <>
          <Layer className="bg-failed" />
          <Tool>Report rejected</Tool>
          <Reason>
            <ul className="list-none">
              {row.errors.slice(0, 4).map((error, i) => (
                <li key={i}>
                  <span className="font-mono text-xs text-ink">{error.path || "(report)"}</span> · {error.rule}: {error.message}
                </li>
              ))}
              {row.errors.length > 4 ? <li>+{row.errors.length - 4} more</li> : null}
            </ul>
          </Reason>
          <Status icon={CircleX} label="Rejected" tone="text-failed" sub={`attempt ${row.attempt}`} />
          <Dur />
        </>
      );
    case "terminal": {
      const tone = row.status === "COMPLETED" ? "text-ok" : row.status === "FAILED" ? "text-failed" : "text-degraded";
      return (
        <>
          <Layer className="bg-ink" />
          <Tool>{humanize(row.status.toLowerCase())}</Tool>
          <Reason>{row.message}</Reason>
          <Status icon={row.status === "COMPLETED" ? CircleCheck : Flag} label={humanize(row.status.toLowerCase())} tone={tone} />
          <Dur />
        </>
      );
    }
  }
}

function ToolDetail({ row, execution, onEvidenceActive }: { row: ToolRow; execution: ToolExecutionDto | undefined; onEvidenceActive: (ref: string | null) => void }) {
  return (
    <div id={`detail-${row.key}`} className="flex flex-col gap-2 border-t border-hairline bg-ground/60 px-3 py-3 md:pl-[104px]">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-ink-2">Call</dt>
        <dd className="font-mono break-all">{row.toolExecutionId}</dd>
        {row.callerRef ? (
          <>
            <dt className="text-ink-2">Caller ref</dt>
            <dd className="font-mono break-all">{row.callerRef}</dd>
          </>
        ) : null}
        <dt className="text-ink-2">Attempt</dt>
        <dd>{row.attempt > 0 ? row.attempt : "not started"}</dd>
        {row.evidenceRefs.length > 0 ? (
          <>
            <dt className="text-ink-2">Evidence</dt>
            <dd className="flex flex-wrap gap-1">
              {row.evidenceRefs.map((ref) => (
                <EvidenceChip key={ref} id={ref} onActive={onEvidenceActive} />
              ))}
            </dd>
          </>
        ) : null}
      </dl>
      {row.rejection ? (
        <p role="note" className="text-sm text-failed">
          <span className="font-semibold">Rejected before running:</span> <span className="font-mono text-xs">{row.rejection.code}</span>
          <span className="mt-1 block font-mono text-xs break-words text-ink">{JSON.stringify(row.rejection.issues)}</span>
        </p>
      ) : null}
      {row.status === "failed" ? (
        <p role="note" className="text-sm text-failed">
          <span className="font-semibold">Failed:</span> <span className="font-mono text-xs">{execution?.errorCode ?? row.errorCode}</span>
          {execution?.errorMessage ? <span className="block text-ink">{execution.errorMessage}</span> : null}
          <span className="block text-xs text-ink-2">{row.retryable ? "Retryable error." : "Not retryable."}</span>
        </p>
      ) : null}
      {execution ? (
        <>
          <JsonView value={execution.input} label="Input" />
          {execution.output !== null && execution.output !== undefined ? <JsonView value={execution.output} label={execution.outputTruncated ? "Output (truncated)" : "Output"} /> : null}
        </>
      ) : (
        <p className="text-xs text-ink-2">Input and output load with the next refresh of the run.</p>
      )}
    </div>
  );
}
