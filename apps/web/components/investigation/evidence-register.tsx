"use client";

import type { EvidenceDto } from "@campaign-sentinel/contracts";
import { KindChip } from "@/components/ui/kind-chip";
import type { ToolRow } from "@/lib/timeline";
import { StrengthMark } from "./status-marks";

/** Every number the report cites, in the order it was laid down, each with the tool call that produced it. */
export function EvidenceRegister({
  evidence,
  toolRows,
  activeRef,
  onActiveRef,
  onActiveKey,
}: {
  evidence: readonly EvidenceDto[];
  toolRows: readonly ToolRow[];
  activeRef: string | null;
  onActiveRef: (ref: string | null) => void;
  onActiveKey: (key: string | null) => void;
}) {
  if (evidence.length === 0) {
    return <p className="px-4 py-6 text-sm text-ink-2">No evidence recorded yet. Each successful tool call adds its findings here.</p>;
  }
  const calls = new Map(toolRows.map((row, i) => [row.toolExecutionId, { row, number: i + 1 }]));
  return (
    <ol className="list-none">
      {evidence.map((item) => {
        const call = calls.get(item.toolExecutionId);
        return (
          <li
            key={item.ref}
            id={`evidence-${item.ref}`}
            data-active={activeRef === item.ref}
            className="hl flex flex-col gap-1.5 border-b border-hairline px-4 py-3"
            onMouseEnter={() => {
              onActiveRef(item.ref);
              if (call) onActiveKey(call.row.key);
            }}
            onMouseLeave={() => {
              onActiveRef(null);
              onActiveKey(null);
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold">{item.ref}</span>
              <KindChip kind={item.kind} />
              <StrengthMark strength={item.strength} />
            </div>
            <p className="max-w-[65ch] text-sm text-pretty">{item.statement}</p>
            {call ? (
              <a href={`#call-${call.row.toolExecutionId}`} className="w-fit text-xs text-ink-2 underline decoration-hairline hover:text-ink hover:decoration-ink">
                from call #{call.number} <span className="font-mono">{call.row.tool}</span>
              </a>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
