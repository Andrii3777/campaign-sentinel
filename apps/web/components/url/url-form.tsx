"use client";

import { Info, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import type { RuntimeOption } from "@/components/campaign/start-form";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { createUrlInvestigation, type RuntimeChoice } from "@/lib/api-client";

const inputClass = "h-9 w-full min-w-0 rounded-sm border bg-surface px-2.5 text-sm text-ink placeholder:text-ink-3 hover:border-ink-2";

/** Starts a live URL investigation. The scope statement sits above the field, so it is read before anything is typed (story 38). */
export function UrlForm({ scopeStatement, runtimes, initialUrl }: { scopeStatement: string; runtimes: readonly RuntimeOption[]; initialUrl: string }) {
  const router = useRouter();
  const [navigating, startTransition] = useTransition();
  const [url, setUrl] = useState(initialUrl);
  const [runtime, setRuntime] = useState<RuntimeChoice>("deterministic");
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // One key per attempt: a double click returns the same run; editing starts a new attempt.
  const key = useRef(crypto.randomUUID());
  const touch = () => {
    key.current = crypto.randomUUID();
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await createUrlInvestigation(url.trim(), runtime, key.current);
    if (result.ok) {
      startTransition(() => router.push(`/investigations/${result.data.id}`));
      return; // stay disabled until the navigation lands
    }
    setSubmitting(false);
    // Validation errors name the field; take the API's own sentence for the URL, otherwise the error's message.
    const details = Array.isArray(result.error.details) ? (result.error.details as { field?: unknown; message?: unknown }[]) : [];
    const urlIssue = details.find((d) => d.field === "url" && typeof d.message === "string");
    setError({ code: result.error.code, message: typeof urlIssue?.message === "string" ? urlIssue.message : result.error.message });
    touch();
  }

  return (
    <Card aria-labelledby="url-form-heading" className="max-w-[720px]">
      <CardHeader id="url-form-heading" title="Check a public page" />
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 p-4">
        <p className="flex max-w-[65ch] items-start gap-2 text-sm text-ink">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-stratum-http" />
          <span>{scopeStatement}</span>
        </p>

        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="url-input" className="text-xs font-semibold">
            Public page URL
          </label>
          <input
            id="url-input"
            name="url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            placeholder="https://example.com/landing"
            onChange={(e) => {
              touch();
              setUrl(e.target.value);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "url-error url-hint" : "url-hint"}
            className={`${inputClass} ${error ? "border-failed" : "border-hairline"}`}
          />
          <p id="url-hint" className="text-xs text-ink-2">
            http or https, port 80 or 443, no credentials in the URL. Addresses on private or internal networks are refused and nothing is fetched.
          </p>
          {error ? (
            <p id="url-error" role="alert" className="text-sm text-failed">
              <span className="font-semibold">This URL was not accepted.</span> <code className="font-mono text-xs">{error.code}</code>
              <span className="block text-ink">{error.message}</span>
            </p>
          ) : null}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-semibold">Runtime</legend>
          {runtimes.map((option) => (
            <label
              key={option.value}
              className={`flex gap-3 rounded-sm border px-3 py-2.5 ${option.available ? "cursor-pointer hover:border-ink-2" : "cursor-not-allowed bg-ground/60"} ${runtime === option.value && option.available ? "border-ink" : "border-hairline"}`}
            >
              <input
                type="radio"
                name="runtime"
                value={option.value}
                checked={runtime === option.value}
                disabled={!option.available}
                onChange={() => {
                  touch();
                  setRuntime(option.value);
                }}
                className="mt-0.5 size-4 shrink-0 accent-ink"
              />
              <span className="flex min-w-0 flex-col">
                <span className={`text-sm font-medium ${option.available ? "" : "text-ink-2"}`}>{option.label}</span>
                <span className="text-xs text-ink-2">{option.available ? option.description : (option.reason ?? "Not available")}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div>
          <Button type="submit" variant="primary" disabled={submitting || navigating}>
            <Search aria-hidden />
            {submitting || navigating ? "Starting…" : "Start URL check"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
