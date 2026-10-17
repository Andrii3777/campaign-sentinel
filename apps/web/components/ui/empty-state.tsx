import type { ReactNode } from "react";

/** Nothing to show yet: one sentence and one clear next action. */
export function EmptyState({ message, action }: { message: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 px-4 py-8">
      <p className="max-w-[65ch] text-sm text-ink-2">{message}</p>
      {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}
