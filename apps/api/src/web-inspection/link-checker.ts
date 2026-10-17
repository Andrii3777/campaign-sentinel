import { fetchPage, type FetchErrorCode, type FetchOptions } from "./safe-fetcher";

export interface LinkCheck {
  url: string;
  method: "HEAD" | "GET";
  status?: number;
  code?: FetchErrorCode;
  /** refused by the SSRF guard */
  blocked: boolean;
  broken: boolean;
  timeMs: number;
}

export const LINK_CHECK_CONCURRENCY = 4;

/** Like Promise.all(items.map(fn)) but with at most `limit` calls in flight; results keep the input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** HEAD each URL (GET when HEAD is refused or fails); every request goes through the SafeFetcher guard. */
export async function checkLinks(urls: string[], options: Omit<FetchOptions, "method"> = {}): Promise<LinkCheck[]> {
  return mapLimit(
    urls,
    LINK_CHECK_CONCURRENCY,
    async (url): Promise<LinkCheck> => {
      let method: "HEAD" | "GET" = "HEAD";
      let r = await fetchPage(url, { ...options, method });
      const retryWithGet = r.ok ? r.status === 405 || r.status === 501 : !r.blocked && r.code !== "REQUEST_CAP_REACHED";
      if (retryWithGet) {
        method = "GET";
        r = await fetchPage(url, { ...options, method });
      }
      return r.ok
        ? { url, method, status: r.status, blocked: false, broken: r.status >= 400, timeMs: r.timings.totalMs }
        : { url, method, code: r.code, ...(r.status ? { status: r.status } : {}), blocked: r.blocked, broken: true, timeMs: r.timings.totalMs };
    },
  );
}
