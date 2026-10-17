import {
  ApiErrorSchema,
  CampaignDetailSchema,
  CampaignListResponseSchema,
  EventsResponseSchema,
  HealthResponseSchema,
  InvestigationDetailSchema,
  InvestigationListResponseSchema,
  type CampaignDetail,
  type CampaignListItem,
  type EventsResponse,
  type HealthResponse,
  type InvestigationDetail,
  type InvestigationListItem,
  type InvestigationListResponse,
} from "@campaign-sentinel/contracts";

import { apiBaseUrl } from "./api-url";

export { apiBaseUrl };

/** The one thing of a zod schema this module uses (web does not depend on zod itself). */
type Parser<T> = { safeParse(data: unknown): { success: true; data: T } | { success: false } };

/** Error shape every screen renders: always `{code, message}`, never a stack. */
export type ApiFailure = { code: string; message: string; status?: number; details?: unknown };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiFailure };

export async function apiGet<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, { cache: "no-store", ...init, headers: { accept: "application/json", ...init?.headers } });
  } catch {
    // The internal URL is deployment detail: it stays out of the message the page shows.
    return { ok: false, error: { code: "API_UNREACHABLE", message: "The API did not respond. Check that it is running (pnpm dev) and retry." } };
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    return {
      ok: false,
      error: parsed.success
        ? { code: parsed.data.code, message: parsed.data.message, status: response.status, details: parsed.data.details }
        : { code: `HTTP_${response.status}`, message: `The API answered ${response.status} ${response.statusText}`.trim(), status: response.status },
    };
  }
  // Every success response of this API is a JSON value; an empty or non-JSON 2xx (e.g. a proxy page) is a broken response.
  if (body === null) return { ok: false, error: { code: "BAD_RESPONSE", message: "The API answered without a JSON body", status: response.status } };
  return { ok: true, data: body as T };
}

/** GET + parse with the contract schema; a body that does not match is BAD_RESPONSE, never rendered. */
export async function apiGetParsed<T>(path: string, schema: Parser<T>, what: string): Promise<ApiResult<T>> {
  const result = await apiGet<unknown>(path);
  if (!result.ok) return result;
  const parsed = schema.safeParse(result.data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: { code: "BAD_RESPONSE", message: `The ${what} response did not match the contract` } };
}

export type { InvestigationListItem };
export type InvestigationPage = InvestigationListResponse;

export async function listRecentInvestigations(limit: number): Promise<ApiResult<InvestigationPage>> {
  const result = await apiGetParsed(`/api/investigations?limit=${limit}`, InvestigationListResponseSchema, "investigations");
  // 404 = the list endpoint is not deployed yet: there is nothing to show, which is the empty state, not an error.
  if (!result.ok && result.error.status === 404) return { ok: true, data: { items: [], nextCursor: null } };
  return result;
}

/** Past demo runs of one campaign. The list endpoint has no campaign filter, so the newest demo runs are filtered here. */
export async function listCampaignInvestigations(campaignId: string): Promise<ApiResult<InvestigationListItem[]>> {
  const result = await apiGetParsed("/api/investigations?limit=100&mode=demo", InvestigationListResponseSchema, "investigations");
  if (!result.ok) return result;
  return { ok: true, data: result.data.items.filter((run) => run.campaignId === campaignId) };
}

export async function getHealth(): Promise<ApiResult<HealthResponse>> {
  return apiGetParsed("/api/health", HealthResponseSchema, "health");
}

export async function listCampaigns(): Promise<ApiResult<CampaignListItem[]>> {
  const result = await apiGetParsed("/api/campaigns", CampaignListResponseSchema, "campaigns");
  return result.ok ? { ok: true, data: result.data.items } : result;
}

export function getCampaign(id: string): Promise<ApiResult<CampaignDetail>> {
  return apiGetParsed(`/api/campaigns/${encodeURIComponent(id)}`, CampaignDetailSchema, "campaign");
}

export function getInvestigation(id: string): Promise<ApiResult<InvestigationDetail>> {
  return apiGetParsed(`/api/investigations/${encodeURIComponent(id)}`, InvestigationDetailSchema, "investigation");
}

export function getInvestigationEvents(id: string, after = 0): Promise<ApiResult<EventsResponse>> {
  return apiGetParsed(`/api/investigations/${encodeURIComponent(id)}/events?after=${after}`, EventsResponseSchema, "events");
}
