"use client";

import { CircleX, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "./button";

/** What failed (code + message) and how to recover. Without `onRetry`, retry re-renders the route's server data. */
export function ErrorState({ code, message, onRetry }: { code: string; message: string; onRetry?: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const retry = onRetry ?? (() => startTransition(() => router.refresh()));
  return (
    <div role="alert" className="flex flex-col items-start gap-3 px-4 py-6">
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-failed">
        <CircleX aria-hidden className="size-4" />
        <span>Could not load</span>
        <code className="rounded-sm border border-hairline px-1.5 font-mono text-xs text-ink">{code}</code>
      </p>
      <p className="max-w-[65ch] text-sm text-ink">{message}</p>
      <Button onClick={retry} disabled={pending}>
        <RotateCw aria-hidden className={pending ? "animate-spin motion-reduce:animate-none" : undefined} />
        {pending ? "Retrying…" : "Retry"}
      </Button>
    </div>
  );
}
