import { fetchPage, type FetchErrorCode, type FetchOptions } from "./safe-fetcher";

export interface AvailabilityAttempt {
  n: number;
  ok: boolean;
  status?: number;
  code?: FetchErrorCode;
  blocked: boolean;
  totalMs: number;
}

export interface Availability {
  url: string;
  attempts: AvailabilityAttempt[];
  /** share of attempts that ended in a status < 400 */
  successRate: number;
  timings: { minMs: number; medianMs: number; maxMs: number };
}

/** `attempts` GETs `delayMs` apart (spec: 1–5 attempts, 1 s apart). A blocked or capped attempt ends the series. */
export async function measureAvailability(
  url: string,
  attempts: number,
  options: Omit<FetchOptions, "method"> & { delayMs?: number } = {},
): Promise<Availability> {
  const results: AvailabilityAttempt[] = [];
  for (let n = 1; n <= attempts; n++) {
    if (n > 1) await new Promise((r) => setTimeout(r, options.delayMs ?? 1000));
    const r = await fetchPage(url, options);
    results.push(
      r.ok
        ? { n, ok: r.status < 400, status: r.status, blocked: false, totalMs: r.timings.totalMs }
        : { n, ok: false, code: r.code, ...(r.status ? { status: r.status } : {}), blocked: r.blocked, totalMs: r.timings.totalMs },
    );
    if (!r.ok && (r.blocked || r.code === "REQUEST_CAP_REACHED")) break;
  }
  const times = results.map((a) => a.totalMs).sort((a, b) => a - b);
  const mid = times.length >> 1;
  return {
    url,
    attempts: results,
    successRate: results.filter((a) => a.ok).length / results.length,
    timings: {
      minMs: times[0]!,
      medianMs: times.length % 2 ? times[mid]! : Math.round((times[mid - 1]! + times[mid]!) / 2),
      maxMs: times.at(-1)!,
    },
  };
}
