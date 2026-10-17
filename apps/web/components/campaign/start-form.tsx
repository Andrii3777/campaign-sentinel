"use client";

import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { createInvestigation, type CreateRequest } from "@/lib/api-client";

export type RuntimeOption = { value: CreateRequest["runtime"]; label: string; description: string; available: boolean; reason?: string };
type Period = { start: string; end: string };
type FieldErrors = Partial<Record<string, string>>;

const inputClass =
  "h-9 w-full min-w-0 rounded-sm border bg-surface px-2.5 text-sm text-ink placeholder:text-ink-3 hover:border-ink-2 aria-[invalid=true]:border-failed";

function Field({ id, label, error, children, hint }: { id: string; label: string; error?: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-semibold">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-ink-2">{hint}</p> : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-failed">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Starts a demo investigation. Field errors from the API (`details: [{field, message}]`) are shown under the field they name. */
export function StartForm({
  campaignId,
  defaultQuestion,
  defaultPeriods,
  dataRange,
  runtimes,
}: {
  campaignId: string;
  defaultQuestion: string;
  defaultPeriods: { baseline: Period; current: Period };
  dataRange: Period;
  runtimes: readonly RuntimeOption[];
}) {
  const router = useRouter();
  const [navigating, startTransition] = useTransition();
  const [question, setQuestion] = useState("");
  const [periods, setPeriods] = useState(defaultPeriods);
  const [runtime, setRuntime] = useState<CreateRequest["runtime"]>("deterministic");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<{ code: string; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // One key per attempt: a double click re-sends the same key and gets the same run back (story 3); editing a field starts a new attempt.
  const key = useRef(crypto.randomUUID());
  const touch = () => {
    key.current = crypto.randomUUID();
  };

  const setPeriod = (which: "baseline" | "current", edge: "start" | "end", value: string) => {
    touch();
    setPeriods((p) => ({ ...p, [which]: { ...p[which], [edge]: value } }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    const trimmed = question.trim();
    const result = await createInvestigation({ mode: "demo", campaignId, ...(trimmed ? { question: trimmed } : {}), baseline: periods.baseline, current: periods.current, runtime }, key.current);
    if (result.ok) {
      startTransition(() => router.push(`/investigations/${result.data.id}`));
      return; // stay disabled until the navigation lands
    }
    setSubmitting(false);
    const details = Array.isArray(result.error.details) ? (result.error.details as { field?: unknown; message?: unknown }[]) : [];
    const known = new Set(["question", "baseline.start", "baseline.end", "current.start", "current.end", "runtime"]);
    const byField: FieldErrors = {};
    const leftover: string[] = [];
    for (const d of details) {
      if (typeof d.field !== "string" || typeof d.message !== "string") continue;
      if (known.has(d.field)) byField[d.field] = byField[d.field] ? `${byField[d.field]} ${d.message}` : d.message;
      else leftover.push(`${d.field}: ${d.message}`);
    }
    setErrors(byField);
    if (Object.keys(byField).length === 0 || leftover.length > 0) {
      setFormError({ code: result.error.code, message: leftover.length > 0 ? leftover.join(" ") : result.error.message });
    }
    touch();
  }

  const dateField = (which: "baseline" | "current", edge: "start" | "end", label: string) => {
    const id = `${which}-${edge}`;
    const error = errors[`${which}.${edge}`];
    return (
      <Field id={id} label={label} error={error}>
        <input
          id={id}
          type="date"
          required
          min={dataRange.start}
          max={dataRange.end}
          value={periods[which][edge]}
          onChange={(e) => setPeriod(which, edge, e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${inputClass} ${error ? "border-failed" : "border-hairline"}`}
        />
      </Field>
    );
  };

  return (
    <Card id="investigate" aria-labelledby="start-heading" className="scroll-mt-4">
      <CardHeader id="start-heading" title="Investigate this campaign" />
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 p-4">
        <Field id="question" label="Question" error={errors.question} hint="Leave empty to use the default question.">
          <textarea
            id="question"
            rows={3}
            maxLength={500}
            value={question}
            placeholder={defaultQuestion}
            onChange={(e) => {
              touch();
              setQuestion(e.target.value);
            }}
            aria-invalid={errors.question ? true : undefined}
            aria-describedby={errors.question ? "question-error" : undefined}
            className={`${inputClass} h-auto resize-y py-2 ${errors.question ? "border-failed" : "border-hairline"}`}
          />
        </Field>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-semibold">Baseline period</legend>
          <div className="grid grid-cols-2 gap-3">
            {dateField("baseline", "start", "Start")}
            {dateField("baseline", "end", "End")}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-semibold">Current period</legend>
          <div className="grid grid-cols-2 gap-3">
            {dateField("current", "start", "Start")}
            {dateField("current", "end", "End")}
          </div>
          <p className="text-xs text-ink-2">
            Data available {dataRange.start} to {dataRange.end}. A period is at most 31 days; the current period starts after the baseline ends.
          </p>
        </fieldset>

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
          {errors.runtime ? <p className="text-xs font-medium text-failed">{errors.runtime}</p> : null}
        </fieldset>

        {formError ? (
          <p role="alert" className="text-sm text-failed">
            <span className="font-semibold">Could not start the investigation.</span> <code className="font-mono text-xs">{formError.code}</code>
            <span className="block text-ink">{formError.message}</span>
          </p>
        ) : null}

        <div>
          <Button type="submit" variant="primary" disabled={submitting || navigating}>
            <Play aria-hidden />
            {submitting || navigating ? "Starting…" : "Start investigation"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
