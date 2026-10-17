"use client";

import type { InvestigationDetail, InvestigationEventDto, InvestigationStatus } from "@campaign-sentinel/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { pollEvents, reloadInvestigation } from "@/lib/api-client";
import { buildTimeline, layersOf, type ToolRow } from "@/lib/timeline";
import { CoreStrip } from "./core-strip";
import { EvidenceRegister } from "./evidence-register";
import { InvestigationHeader } from "./header";
import { GroundTruth, RawJson, ReportSection, VerdictBand } from "./report-section";
import { Timeline } from "./timeline";

const POLL_MS = 1000;
const TERMINAL: readonly InvestigationStatus[] = ["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"];
const isTerminal = (status: InvestigationStatus) => TERMINAL.includes(status);

/**
 * The investigation page. The server renders the first load; while the run is not terminal this polls
 * `GET /events?after=<seq>` every second and reloads the run record when something new arrived. Only persisted events are drawn.
 */
export function LiveInvestigation({ initialDetail, initialEvents }: { initialDetail: InvestigationDetail; initialEvents: InvestigationEventDto[] }) {
  const [detail, setDetail] = useState(initialDetail);
  const [events, setEvents] = useState(initialEvents);
  const [pollError, setPollError] = useState<{ code: string; message: string } | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [activeRef, setActiveRef] = useState<string | null>(null);
  const lastSeq = useRef(initialEvents.at(-1)?.seq ?? 0);
  const statusRef = useRef(initialDetail.status);
  const [initialKeys] = useState(() => new Set(layersOf(buildTimeline(initialEvents)).map((l) => l.key)));
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => setRefreshTick((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      try {
        const polled = await pollEvents(detail.id, lastSeq.current, signal);
        if (!polled.ok) {
          setPollError(polled.error);
        } else {
          setPollError(null);
          const fresh = polled.data.items;
          const changed = fresh.length > 0 || polled.data.status !== statusRef.current;
          if (fresh.length > 0) {
            lastSeq.current = fresh[fresh.length - 1]!.seq;
            setEvents((prev) => [...prev, ...fresh]);
          }
          if (changed) {
            const record = await reloadInvestigation(detail.id, signal);
            if (record.ok) {
              setDetail(record.data);
              statusRef.current = record.data.status;
            } else {
              setPollError(record.error);
            }
          }
          // Stop on the first quiet poll after a terminal status: the closing events (e.g. the submit_report result) land just after it.
          if (isTerminal(polled.data.status) && fresh.length === 0) return;
        }
      } catch {
        return; // aborted: the component unmounted or the dependencies changed
      }
      timer = setTimeout(tick, POLL_MS);
    }

    if (!isTerminal(statusRef.current) || refreshTick > 0) timer = setTimeout(tick, refreshTick > 0 ? 0 : POLL_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [detail.id, refreshTick]);

  const rows = useMemo(() => buildTimeline(events), [events]);
  const layers = useMemo(() => layersOf(rows), [rows]);
  const toolRows = useMemo(() => rows.filter((r): r is ToolRow => r.kind === "tool"), [rows]);
  const executions = useMemo(() => new Map(detail.toolExecutions.map((t) => [t.id, t])), [detail.toolExecutions]);
  const freshKeys = useMemo(() => new Set(layers.map((l) => l.key).filter((k) => !initialKeys.has(k))), [layers, initialKeys]);
  const startAt = events[0]?.at ?? detail.createdAt;

  const onEvidenceActive = useCallback(
    (ref: string | null) => {
      setActiveRef(ref);
      const evidence = ref ? detail.evidence.find((e) => e.ref === ref) : undefined;
      setActiveKey(evidence ? (toolRows.find((r) => r.toolExecutionId === evidence.toolExecutionId)?.key ?? null) : null);
    },
    [detail.evidence, toolRows],
  );

  const jumpToRow = useCallback((key: string) => {
    const target = document.getElementById(`row-${key}`);
    target?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    target?.focus({ preventScroll: true });
  }, []);

  const running = !isTerminal(detail.status);

  return (
    <>
      <InvestigationHeader detail={detail} onChanged={refresh} />

      {pollError ? (
        <p role="status" className="mt-4 text-sm text-degraded">
          Live updates paused: <span className="font-mono text-xs">{pollError.code}</span> {pollError.message} Retrying every second.
        </p>
      ) : null}

      {detail.report ? (
        <div className="mt-6">
          <VerdictBand report={detail.report} />
        </div>
      ) : null}

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,64fr)_minmax(0,36fr)]">
        <Card aria-labelledby="timeline-heading">
          <CardHeader
            id="timeline-heading"
            title="Timeline"
            actions={<span className="text-xs text-ink-2">{running ? "Live: new events appear as they are saved" : `${events.length} saved events`}</span>}
          />
          {events.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-2">No events saved yet. The first one appears the moment the run is queued.</p>
          ) : (
            <div className="flex items-start gap-1 py-2 pl-2">
              <div className="sticky top-4 shrink-0 self-start">
                <CoreStrip layers={layers} activeKey={activeKey} onActive={setActiveKey} onJump={jumpToRow} freshKeys={freshKeys} />
              </div>
              <Timeline rows={rows} executions={executions} startAt={startAt} activeKey={activeKey} onActive={setActiveKey} onEvidenceActive={onEvidenceActive} />
            </div>
          )}
        </Card>

        <Card aria-labelledby="evidence-heading" className="lg:sticky lg:top-4">
          <CardHeader id="evidence-heading" title="Evidence" actions={<span className="text-xs text-ink-2">{detail.evidence.length} items</span>} />
          <div tabIndex={0} aria-label="Evidence register" className="overscroll-contain lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto">
            <EvidenceRegister evidence={detail.evidence} toolRows={toolRows} activeRef={activeRef} onActiveRef={setActiveRef} onActiveKey={setActiveKey} />
          </div>
        </Card>
      </div>

      <div className="mt-6 flex flex-col gap-6">
        <ReportSection detail={detail} onEvidenceActive={onEvidenceActive} />
        {detail.groundTruth ? <GroundTruth truth={detail.groundTruth} /> : null}
        <RawJson detail={detail} />
      </div>
    </>
  );
}
