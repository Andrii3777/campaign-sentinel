export interface ApiResponse {
  status: number;
  body: unknown;
}

/** The only door from the MCP server to the application: HTTP calls to the Agent API (no database access). */
export interface ApiClient {
  request(method: "GET" | "POST", path: string, body?: unknown): Promise<ApiResponse>;
}

export interface ApiClientConfig {
  baseUrl: string;
  token: string;
  /** Tool calls can take a while (browser checks); Codex allows 60 s per tool call. */
  timeoutMs?: number;
}

/** Network and parse problems become a response too, so the agent sees an error result instead of a crash. */
export function httpApiClient({ baseUrl, token, timeoutMs = 55_000 }: ApiClientConfig): ApiClient {
  const root = baseUrl.replace(/\/+$/, "");
  return {
    async request(method, path, body) {
      try {
        const res = await fetch(`${root}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "User-Agent": "campaign-sentinel-mcp",
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const raw = await res.text();
        let parsed: unknown;
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch {
          parsed = { code: "BAD_RESPONSE", message: `The API answered ${res.status} with a body that is not JSON.` };
        }
        return { status: res.status, body: parsed };
      } catch (error) {
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        return {
          status: 0,
          body: {
            code: timedOut ? "API_TIMEOUT" : "API_UNREACHABLE",
            message: timedOut
              ? `The Sentinel API did not answer within ${timeoutMs} ms.`
              : `Cannot reach the Sentinel API at ${root}. Start it with "pnpm dev" (database: "docker compose up -d db").`,
          },
        };
      }
    },
  };
}
