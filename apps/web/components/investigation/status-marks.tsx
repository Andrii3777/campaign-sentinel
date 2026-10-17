import type { EvidenceStrength } from "@campaign-sentinel/contracts";
import { Ban, CircleCheck, CircleX, Clock, LoaderCircle, type LucideIcon } from "lucide-react";
import type { ToolRowStatus } from "@/lib/timeline";

const toolStatus: Record<ToolRowStatus, [LucideIcon, string, string]> = {
  requested: [Clock, "Requested", "text-ink-2"],
  running: [LoaderCircle, "Running", "text-ink"],
  succeeded: [CircleCheck, "Succeeded", "text-ok"],
  failed: [CircleX, "Failed", "text-failed"],
  rejected: [Ban, "Rejected", "text-failed"],
};

/** Status is always icon + word; colour only reinforces it. */
export function ToolStatusMark({ status }: { status: ToolRowStatus }) {
  const [Icon, label, tone] = toolStatus[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${tone}`}>
      <Icon aria-hidden className={`size-3.5 shrink-0 ${status === "running" ? "animate-spin motion-reduce:animate-none" : ""}`} />
      {label}
    </span>
  );
}

const strengthBars: Record<EvidenceStrength, number> = { direct: 3, indirect: 2, context: 1 };

/** Three bars: how much weight the evidence carries (direct 3, indirect 2, context 1) next to the word. */
export function StrengthMark({ strength }: { strength: EvidenceStrength }) {
  const filled = strengthBars[strength];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2" title={`Evidence strength: ${strength}`}>
      <span aria-hidden className="flex items-end gap-px">
        {[1, 2, 3].map((n) => (
          <span key={n} className={`w-1 ${n <= filled ? "bg-ink" : "bg-[#c4cac6]"}`} style={{ height: 4 + n * 3 }} />
        ))}
      </span>
      {strength}
    </span>
  );
}

/** Mono evidence reference that jumps to the evidence register entry. */
export function EvidenceChip({ id, onActive }: { id: string; onActive?: (id: string | null) => void }) {
  return (
    <a
      href={`#evidence-${id}`}
      onMouseEnter={() => onActive?.(id)}
      onMouseLeave={() => onActive?.(null)}
      className="inline-flex h-5 items-center rounded-sm border border-hairline bg-surface px-1.5 font-mono text-xs text-ink hover:border-ink-2"
    >
      {id}
    </a>
  );
}
