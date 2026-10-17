"use client";

import type { InvestigationDetail } from "@campaign-sentinel/contracts";
import { Ban, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cancelInvestigation, retryInvestigation } from "@/lib/api-client";

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"]);

/** Cancel while the run is live, Retry (the one reserved-orange action) once it has finished. Errors stay visible under the buttons. */
export function RunActions({ detail, onChanged }: { detail: InvestigationDetail; onChanged: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const finished = TERMINAL.has(detail.status);
  const canRetry = finished && detail.runtime === "deterministic";

  async function cancel() {
    setBusy(true);
    setError(null);
    const result = await cancelInvestigation(detail.id);
    setBusy(false);
    if (result.ok) onChanged();
    else setError(result.error);
  }

  async function retry() {
    setBusy(true);
    setError(null);
    const result = await retryInvestigation(detail.id);
    if (result.ok) {
      startTransition(() => router.push(`/investigations/${result.data.id}`));
    } else {
      setBusy(false);
      setError(result.error);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2">
        {finished ? (
          <Button variant="primary" onClick={retry} disabled={!canRetry || busy || pending} title={canRetry ? undefined : "Only runs of the built-in deterministic runtime can be retried from here."}>
            <RotateCw aria-hidden />
            {busy || pending ? "Retrying…" : "Retry this run"}
          </Button>
        ) : (
          <Button onClick={cancel} disabled={busy}>
            <Ban aria-hidden />
            {busy ? "Cancelling…" : "Cancel run"}
          </Button>
        )}
      </div>
      {finished && !canRetry ? <p className="max-w-64 text-xs text-ink-2 sm:text-right">Retry is available for deterministic runs only.</p> : null}
      {error ? (
        <p role="alert" className="max-w-72 text-xs text-failed sm:text-right">
          <span className="font-mono">{error.code}</span> {error.message}
        </p>
      ) : null}
    </div>
  );
}
