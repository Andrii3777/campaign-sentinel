"use client";

import { stratumFill, stratumOfTool } from "@/components/ui/kind-chip";
import { formatDuration } from "@/lib/format";
import { layerHeight, type Layer } from "@/lib/timeline";

const statusWord: Record<Layer["status"], string> = {
  requested: "requested",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
  rejected: "rejected",
  guardrail: "triggered",
};

function layerClass(layer: Layer, fresh: boolean): string {
  const base = `layer block w-full border-b border-surface ${fresh ? "layer-fresh" : ""}`;
  if (layer.kind === "guardrail") return `${base} layer-guardrail border-0`;
  if (layer.status === "requested" || layer.status === "running") return `${base} layer-active`;
  if (layer.status === "rejected") return `${base} layer-rejected`;
  const fill = stratumFill[stratumOfTool(layer.tool ?? "")];
  return `${base} ${fill} ${layer.status === "failed" ? "layer-failed translate-x-[3px]" : ""}`;
}

/**
 * The core strip: one layer per tool call, height from duration (log scale), colour from tool kind.
 * Failed calls are cut by a red fault hatch and shifted, rejected calls are grey-hatched, guardrails are violet wedges,
 * and the call still in flight carries the reserved orange. Hover or focus a layer to light its timeline row.
 */
export function CoreStrip({
  layers,
  activeKey,
  onActive,
  onJump,
  freshKeys,
}: {
  layers: readonly Layer[];
  activeKey: string | null;
  onActive: (key: string | null) => void;
  onJump: (key: string) => void;
  freshKeys: ReadonlySet<string>;
}) {
  return (
    <ol aria-label="Core strip, one layer per tool call, in call order" className="mr-1 w-7 shrink-0 list-none border-x border-hairline bg-ground">
      {layers.map((layer, index) => (
        <li key={layer.key}>
          <button
            type="button"
            aria-label={`Layer ${index + 1}: ${layer.label}, ${statusWord[layer.status]}${layer.durationMs !== null ? `, ${formatDuration(layer.durationMs)}` : ""}. Jump to its timeline row.`}
            className={`${layerClass(layer, freshKeys.has(layer.key))} ${activeKey === layer.key ? "outline-2 outline-offset-0 outline-ink" : ""}`}
            style={{ height: layer.kind === "guardrail" ? 14 : layer.status === "requested" || layer.status === "running" ? Math.max(12, layerHeight(layer.durationMs)) : layerHeight(layer.durationMs) }}
            onMouseEnter={() => onActive(layer.key)}
            onMouseLeave={() => onActive(null)}
            onFocus={() => onActive(layer.key)}
            onBlur={() => onActive(null)}
            onClick={() => onJump(layer.key)}
          />
        </li>
      ))}
      {layers.length === 0 ? <li aria-hidden className="h-1.5" /> : null}
    </ol>
  );
}
