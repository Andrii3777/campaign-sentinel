import type { EvidenceProvenance, InvestigationMode, InvestigationStatus, LedgerRuntime } from "@campaign-sentinel/contracts";
import {
  Ban,
  Bot,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Cpu,
  FlaskConical,
  Globe,
  LoaderCircle,
  Plug,
  Route,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

type Tone = "neutral" | "ok" | "failed" | "degraded" | "guardrail";

const tones: Record<Tone, string> = {
  neutral: "text-ink",
  ok: "text-ok",
  failed: "text-failed",
  degraded: "text-degraded",
  guardrail: "text-guardrail",
};

/** Hairline label with an icon; the text carries the meaning, colour only reinforces it. */
export function Badge({
  icon: Icon,
  tone = "neutral",
  children,
  title,
  spin,
}: {
  icon?: LucideIcon;
  tone?: Tone;
  children: ReactNode;
  title?: string;
  spin?: boolean;
}) {
  return (
    <span
      title={title}
      className={`inline-flex h-6 items-center gap-1.5 rounded-sm border border-hairline bg-surface px-2 text-xs font-medium whitespace-nowrap ${tones[tone]}`}
    >
      {Icon ? <Icon aria-hidden className={`size-3.5 shrink-0 ${tone === "neutral" ? "text-ink-2" : ""} ${spin ? "animate-spin motion-reduce:animate-none" : ""}`} /> : null}
      {children}
    </span>
  );
}

export function ModeBadge({ mode }: { mode: InvestigationMode }) {
  return mode === "demo" ? <Badge icon={Route}>Demo campaign</Badge> : <Badge icon={Globe}>URL</Badge>;
}

export function ProvenanceBadge({ provenance }: { provenance: EvidenceProvenance }) {
  return provenance === "synthetic-demo" ? (
    <Badge icon={FlaskConical} title="Dataset synthetic-demo-v1">
      Synthetic demo data
    </Badge>
  ) : (
    <Badge icon={Globe}>Live HTTP</Badge>
  );
}

const runtimeLabels: Record<LedgerRuntime, [LucideIcon, string]> = {
  deterministic: [Cpu, "Deterministic"],
  ai: [Bot, "AI agent"],
  external: [Plug, "External agent"],
  openclaw: [Plug, "OpenClaw"],
};

export function RuntimeBadge({ runtime, model }: { runtime: LedgerRuntime; model?: string | null }) {
  const [icon, label] = runtimeLabels[runtime] ?? [CircleDashed, runtime];
  return (
    <Badge icon={icon} title={model ?? undefined}>
      {label}
    </Badge>
  );
}

const statusLabels: Record<InvestigationStatus, [LucideIcon, string, Tone]> = {
  QUEUED: [Clock, "Queued", "neutral"],
  RUNNING: [LoaderCircle, "Running", "neutral"],
  COMPLETED: [CircleCheck, "Completed", "ok"],
  FAILED: [CircleX, "Failed", "failed"],
  CANCELLED: [Ban, "Cancelled", "neutral"],
  INTERRUPTED: [TriangleAlert, "Interrupted", "degraded"],
};

export function StatusBadge({ status }: { status: InvestigationStatus }) {
  const [icon, label, tone] = statusLabels[status] ?? [CircleDashed, status, "neutral"];
  return (
    <Badge icon={icon} tone={tone} spin={status === "RUNNING"}>
      {label}
    </Badge>
  );
}
