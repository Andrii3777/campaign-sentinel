import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { pipeline, type Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { validateTargetUrl, type GuardOptions, type UrlRefusalCode } from "./url-guard";

/** Identifies the fetcher to site owners; points at the project repository. */
export const USER_AGENT = "CampaignSentinel/1.0 (+https://github.com/Andrii3777/campaign-sentinel)";
export const FETCH_TIMEOUT_MS = 8_000;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 5;
const PARSED_TYPES = new Set(["text/html", "application/xhtml+xml", "text/plain"]);
const HEADER_SUBSET = [
  "content-type",
  "content-length",
  "content-encoding",
  "server",
  "cache-control",
  "x-robots-tag",
  "strict-transport-security",
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
];

export interface FetchOptions extends GuardOptions {
  method?: "GET" | "HEAD";
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  /** Called before every outbound request (each redirect hop); resolve `false` to refuse (per-investigation cap). */
  beforeRequest?: () => Promise<boolean> | boolean;
}

export interface RedirectHop {
  url: string;
  status: number;
  location: string;
}

export type FetchErrorCode =
  | UrlRefusalCode
  | "CONNECTION_REFUSED"
  | "CONNECTION_RESET"
  | "TLS_ERROR"
  | "TIMEOUT"
  | "REDIRECT_LOOP"
  | "TOO_MANY_REDIRECTS"
  | "BODY_TOO_LARGE"
  | "REQUEST_CAP_REACHED"
  | "NETWORK_ERROR";

export interface FetchedPage {
  ok: true;
  url: string;
  finalUrl: string;
  status: number;
  redirects: RedirectHop[];
  timings: { ttfbMs: number; totalMs: number };
  headers: Record<string, string>;
  contentType: string;
  /** decoded body bytes read (0 for HEAD and for types that are not parsed) */
  bytes: number;
  /** text for html/xhtml/plain GET responses; null otherwise (never downloaded) */
  body: string | null;
}

export interface FetchFailure {
  ok: false;
  url: string;
  code: FetchErrorCode;
  message: string;
  /** refused by the SSRF policy */
  blocked: boolean;
  /** the hop that failed (the initial URL or a redirect target) */
  failedUrl: string;
  redirects: RedirectHop[];
  status?: number;
  timings: { totalMs: number };
}

export class FetchError extends Error {
  constructor(
    readonly code: FetchErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * SafeFetcher (spec §7.3): every hop is validated by the URL guard, the socket is pinned to the validated
 * address (custom `lookup`, so DNS is never asked twice), redirects are followed by hand, no cookies or
 * credentials are sent, the body is capped and only text types are read. Never throws.
 */
export async function fetchPage(rawUrl: string, options: FetchOptions = {}): Promise<FetchedPage | FetchFailure> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])]);
  const redirects: RedirectHop[] = [];
  const seen = new Set<string>();
  let current = rawUrl;
  let lastStatus: number | undefined;

  const fail = (code: FetchErrorCode, message: string, blocked = false): FetchFailure => ({
    ok: false,
    url: rawUrl,
    code,
    message,
    blocked,
    failedUrl: current,
    redirects,
    ...(lastStatus !== undefined ? { status: lastStatus } : {}),
    timings: { totalMs: elapsed() },
  });

  try {
    for (;;) {
      const check = await validateTargetUrl(current, { ...options, signal });
      if (!check.ok) return fail(check.code, check.message, check.blocked);
      seen.add(check.url.href);
      if (options.beforeRequest && !(await options.beforeRequest()))
        return fail("REQUEST_CAP_REACHED", "The outbound request limit for this investigation is reached.");

      const hopStart = performance.now();
      const res = await pinnedRequest(check.url, check.address, { method: options.method ?? "GET" }, signal);
      const ttfbMs = Math.round(performance.now() - hopStart);
      const status = res.statusCode ?? 0;
      lastStatus = status;
      const location = res.headers.location;

      if (status >= 300 && status < 400 && location) {
        res.destroy();
        let next: string;
        try {
          next = new URL(location, check.url).href;
        } catch {
          return fail("NETWORK_ERROR", "The server sent an invalid redirect location.");
        }
        if (redirects.length >= MAX_REDIRECTS) return fail("TOO_MANY_REDIRECTS", `More than ${MAX_REDIRECTS} redirects.`);
        redirects.push({ url: check.url.href, status, location: next });
        if (seen.has(next)) return fail("REDIRECT_LOOP", "The redirects lead back to a URL already visited.");
        current = next;
        continue;
      }

      const headers: Record<string, string> = {};
      for (const name of HEADER_SUBSET) {
        const v = res.headers[name];
        if (v !== undefined) headers[name] = Array.isArray(v) ? v.join(", ") : v;
      }
      const contentType = (headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
      let body: string | null = null;
      let bytes = 0;
      if (options.method !== "HEAD" && PARSED_TYPES.has(contentType)) {
        const raw = await readCapped(res, options.maxBytes ?? MAX_BODY_BYTES, signal);
        bytes = raw.length;
        body = decode(raw, headers["content-type"]);
      } else res.destroy();
      return { ok: true, url: rawUrl, finalUrl: check.url.href, status, redirects, timings: { ttfbMs, totalMs: elapsed() }, headers, contentType, bytes, body };
    }
  } catch (error) {
    if (signal.aborted) return fail("TIMEOUT", `No complete answer within ${timeoutMs} ms.`);
    if (error instanceof FetchError) return fail(error.code, error.message);
    return fail(...networkError(error));
  }
}

/** One request over a socket pinned to `address`; no redirects, no cookies. `headers` replace the defaults. */
export function pinnedRequest(
  url: URL,
  address: string,
  init: { method: string; headers?: Record<string, string>; body?: Buffer | null },
  signal: AbortSignal,
): Promise<IncomingMessage> {
  const family = isIP(address);
  // pinned: the socket connects to the address the guard validated, whatever DNS says now
  const lookup = ((_host: string, opts: { all?: boolean }, cb: (...args: unknown[]) => void) =>
    opts?.all ? cb(null, [{ address, family }]) : cb(null, address, family)) as unknown as LookupFunction;
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: init.method,
        lookup,
        agent: false,
        signal,
        headers: {
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
          ...init.headers,
          "user-agent": USER_AGENT,
          "accept-encoding": "gzip, deflate, br",
        },
      },
      resolve,
    );
    req.on("error", reject);
    req.end(init.body ?? undefined);
  });
}

/**
 * Reads a (decompressed) body, aborting past `maxBytes`. Ends on abort or reset too: `pipeline` (unlike `pipe`)
 * destroys the decompressor when the response dies, so the read can never stay pending. Throws only FetchError.
 */
export async function readCapped(res: IncomingMessage, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  const declared = Number(res.headers["content-length"]);
  if (declared > maxBytes) {
    res.destroy();
    throw new FetchError("BODY_TOO_LARGE", `The body is larger than ${maxBytes} bytes.`);
  }
  const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
  const decompressor =
    encoding === "gzip" || encoding === "x-gzip"
      ? createGunzip()
      : encoding === "deflate"
        ? createInflate()
        : encoding === "br"
          ? createBrotliDecompress()
          : null;
  const stream: Readable = decompressor ? pipeline(res, decompressor, () => {}) : res;
  const onAbort = () => res.destroy(new FetchError("TIMEOUT", "The body did not arrive in time."));
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      size += (chunk as Buffer).length; // counted after decompression: a small gzip cannot expand past the cap
      if (size > maxBytes) throw new FetchError("BODY_TOO_LARGE", `The body is larger than ${maxBytes} bytes.`);
      chunks.push(chunk as Buffer);
    }
  } catch (error) {
    if (signal.aborted) throw new FetchError("TIMEOUT", "The body did not arrive in time.");
    if (error instanceof FetchError) throw error;
    throw new FetchError(...networkError(error));
  } finally {
    signal.removeEventListener("abort", onAbort);
    res.destroy();
    decompressor?.destroy();
  }
  return Buffer.concat(chunks);
}

function decode(raw: Buffer, contentType = ""): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(raw);
  } catch {
    return new TextDecoder("utf-8").decode(raw);
  }
}

function networkError(error: unknown): [FetchErrorCode, string] {
  const code = String((error as { code?: unknown })?.code ?? "");
  if (code === "ECONNREFUSED") return ["CONNECTION_REFUSED", "The server refused the connection."];
  // a body cut short: socket reset, premature close, or a compressed stream that ends mid-block
  if (["ECONNRESET", "EPIPE", "ERR_STREAM_PREMATURE_CLOSE", "Z_BUF_ERROR"].includes(code)) return ["CONNECTION_RESET", "The connection was closed unexpectedly."];
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_SSL/i.test(code)) return ["TLS_ERROR", "The TLS certificate or handshake failed."];
  if (code === "ETIMEDOUT" || code === "ABORT_ERR") return ["TIMEOUT", "The connection timed out."];
  if (code === "Z_DATA_ERROR" || code === "ERR_PADDING_1") return ["NETWORK_ERROR", "The response body could not be decompressed."];
  return ["NETWORK_ERROR", "The request failed."];
}
