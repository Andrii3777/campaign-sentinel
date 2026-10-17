/** Collapsible raw JSON in mono; native <details>, so it works without client JS and from the keyboard. */
export function JsonView({ value, label = "Raw JSON", open = false }: { value: unknown; label?: string; open?: boolean }) {
  return (
    <details open={open} className="rounded-sm border border-hairline bg-surface">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-ink-2 select-none hover:text-ink">{label}</summary>
      <pre className="max-h-96 overflow-auto border-t border-hairline px-3 py-2 font-mono text-xs leading-5 text-ink">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
