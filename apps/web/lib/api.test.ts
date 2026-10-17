import { afterEach, describe, expect, it, vi } from "vitest";
import { apiGet, getHealth, listRecentInvestigations } from "./api";

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

afterEach(() => vi.unstubAllGlobals());

describe("listRecentInvestigations", () => {
  it("treats 404 (endpoint not built yet) as an empty list", async () => {
    vi.stubGlobal("fetch", respond(404, { code: "NOT_FOUND", message: "Cannot GET /api/investigations" }));
    const result = await listRecentInvestigations(8);
    expect(result).toEqual({ ok: true, data: { items: [], nextCursor: null } });
  });

  it("surfaces the API's own {code, message} on other errors", async () => {
    vi.stubGlobal("fetch", respond(500, { code: "INTERNAL_ERROR", message: "Database is down" }));
    const result = await listRecentInvestigations(8);
    expect(result).toEqual({ ok: false, error: { code: "INTERNAL_ERROR", message: "Database is down", status: 500 } });
  });

  it("returns API_UNREACHABLE instead of throwing when the API is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const result = await listRecentInvestigations(8);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("API_UNREACHABLE");
  });

  it("does not leak the internal API URL into the unreachable message", async () => {
    vi.stubEnv("API_INTERNAL_URL", "http://api.internal.example:4000");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const result = await apiGet("/api/anything");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).not.toContain("api.internal.example");
    vi.unstubAllEnvs();
  });
});

describe("list contract", () => {
  const item = {
    id: "i1", mode: "demo", campaignId: "c1", campaignName: "C", targetUrl: null, question: "q", status: "COMPLETED", failureCode: null, failureMessage: null,
    source: "web", runtime: "deterministic", model: null, clientName: null, clientVersion: null, provenance: "synthetic-demo", verdict: "cause_identified",
    severity: "high", retryOfId: null, createdAt: "2026-10-17T10:00:00.000Z", startedAt: null, finishedAt: null, durationMs: 1200,
  };

  it("returns the contract-cased list items untouched", async () => {
    vi.stubGlobal("fetch", respond(200, { items: [item], nextCursor: null }));
    const result = await listRecentInvestigations(8);
    expect(result).toEqual({ ok: true, data: { items: [item], nextCursor: null } });
  });

  it("rejects a list whose items break the contract (e.g. upper-case mode)", async () => {
    vi.stubGlobal("fetch", respond(200, { items: [{ ...item, mode: "DEMO" }], nextCursor: null }));
    const result = await listRecentInvestigations(8);
    expect(result).toMatchObject({ ok: false, error: { code: "BAD_RESPONSE" } });
  });
});

describe("apiGet", () => {
  it("returns BAD_RESPONSE for a 2xx whose body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>proxy page</html>", { status: 200 })));
    const result = await apiGet("/api/anything");
    expect(result).toMatchObject({ ok: false, error: { code: "BAD_RESPONSE" } });
  });

  it("returns BAD_RESPONSE for a 2xx with an empty body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const result = await apiGet("/api/anything");
    expect(result).toMatchObject({ ok: false, error: { code: "BAD_RESPONSE" } });
  });
});

describe("getHealth", () => {
  it("rejects a body that does not match the health contract", async () => {
    vi.stubGlobal("fetch", respond(200, { status: "ok" }));
    const result = await getHealth();
    expect(result).toMatchObject({ ok: false, error: { code: "BAD_RESPONSE" } });
  });
});
