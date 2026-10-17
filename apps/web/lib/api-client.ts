import type { EventsResponse, InvestigationDetail, InvestigationListItem } from "@campaign-sentinel/contracts";
import type { ApiResult } from "./api";
import { apiBaseUrl } from "./api-url";

/**
 * Every call the browser makes (start, poll, cancel, retry, URL form, history "load more"); the one fetch wrapper. Same `{ok, error:{code,message}}` shape as the server helpers.
 * shortcut: responses are shape-checked, not zod-parsed, to keep the contracts bundle out of the client; the server page parses the first load.
 */
async function call<T>(method: "GET" | "POST", path: string, opts: { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      method,
      cache: "no-store",
      signal: opts.signal,
      headers: { accept: "application/json", ...(opts.body !== undefined ? { "content-type": "application/json" } : {}), ...opts.headers },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (error) {
    if (opts.signal?.aborted) throw error;
    return { ok: false, error: { code: "API_UNREACHABLE", message: "The API did not respond. Check that it is running (pnpm dev) and retry." } };
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const e = (body ?? {}) as { code?: unknown; message?: unknown; details?: unknown };
    return {
      ok: false,
      error: {
        code: typeof e.code === "string" ? e.code : `HTTP_${response.status}`,
        message: typeof e.message === "string" ? e.message : `The API answered ${response.status}`,
        status: response.status,
        details: e.details,
      },
    };
  }
  if (body === null || typeof body !== "object") return { ok: false, error: { code: "BAD_RESPONSE", message: "The API answered without a JSON body", status: response.status } };
  return { ok: true, data: body as T };
}

export type CreateRequest = {
  mode: "demo";
  campaignId: string;
  question?: string;
  baseline: { start: string; end: string };
  current: { start: string; end: string };
  runtime: "deterministic" | "ai" | "openclaw";
};

/** `Idempotency-Key` makes a double click return the same run (story 3). */
export function createInvestigation(request: CreateRequest, idempotencyKey: string): Promise<ApiResult<InvestigationListItem>> {
  return call("POST", "/api/investigations", { body: request, headers: { "Idempotency-Key": idempotencyKey, "X-Sentinel-Client": "web" } });
}

export const cancelInvestigation = (id: string) => call<InvestigationListItem>("POST", `/api/investigations/${encodeURIComponent(id)}/cancel`);
export const retryInvestigation = (id: string) => call<InvestigationListItem>("POST", `/api/investigations/${encodeURIComponent(id)}/retry`, { headers: { "X-Sentinel-Client": "web" } });

export async function pollEvents(id: string, after: number, signal: AbortSignal): Promise<ApiResult<EventsResponse>> {
  const result = await call<EventsResponse>("GET", `/api/investigations/${encodeURIComponent(id)}/events?after=${after}`, { signal });
  if (result.ok && (!Array.isArray(result.data.items) || typeof result.data.status !== "string")) {
    return { ok: false, error: { code: "BAD_RESPONSE", message: "The events response did not have the expected shape" } };
  }
  return result;
}

export async function reloadInvestigation(id: string, signal: AbortSignal): Promise<ApiResult<InvestigationDetail>> {
  const result = await call<InvestigationDetail>("GET", `/api/investigations/${encodeURIComponent(id)}`, { signal });
  if (result.ok && (!Array.isArray(result.data.toolExecutions) || !Array.isArray(result.data.evidence))) {
    return { ok: false, error: { code: "BAD_RESPONSE", message: "The investigation response did not have the expected shape" } };
  }
  return result;
}

export type RuntimeChoice = "deterministic" | "ai" | "openclaw";

/** `Idempotency-Key`: a double click returns the same run. */
export function createUrlInvestigation(url: string, runtime: RuntimeChoice, idempotencyKey: string): Promise<ApiResult<InvestigationListItem>> {
  return call("POST", "/api/investigations", { body: { mode: "url", url, runtime }, headers: { "Idempotency-Key": idempotencyKey, "X-Sentinel-Client": "web" } });
}

export const HISTORY_PAGE_SIZE = 50;
export type HistoryFilters = { mode?: string; status?: string };

/** Query string for `GET /api/investigations`; shared by the server render and the browser's "load more". */
export function historyQuery(filters: HistoryFilters, cursor?: string | null): string {
  const q = new URLSearchParams({ limit: String(HISTORY_PAGE_SIZE) });
  if (filters.mode) q.set("mode", filters.mode);
  if (filters.status) q.set("status", filters.status);
  if (cursor) q.set("cursor", cursor);
  return `/api/investigations?${q.toString()}`;
}

export type HistoryPage = { items: InvestigationListItem[]; nextCursor: string | null };

export async function loadMoreInvestigations(filters: HistoryFilters, cursor: string): Promise<ApiResult<HistoryPage>> {
  const result = await call<HistoryPage>("GET", historyQuery(filters, cursor));
  if (result.ok && (!Array.isArray(result.data.items) || (result.data.nextCursor !== null && typeof result.data.nextCursor !== "string"))) {
    return { ok: false, error: { code: "BAD_RESPONSE", message: "The investigations response did not have the expected shape" } };
  }
  return result;
}
