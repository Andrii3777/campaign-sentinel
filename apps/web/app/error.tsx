"use client";

import { ErrorState } from "@/components/ui/error-state";

/** Last line of defence: a render error becomes an error block with retry, never a blank page. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="pt-8">
      <ErrorState code={error.digest ? `RENDER_${error.digest}` : "RENDER_ERROR"} message="This page failed to render. Retry, and if it keeps failing check the web server log." onRetry={reset} />
    </div>
  );
}
