import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/** Resolves a hostname to every address it has (injected in tests; default: the OS resolver). */
export type Resolver = (hostname: string) => Promise<string[]>;

export interface GuardOptions {
  resolve?: Resolver;
  /** aborting it ends a pending DNS lookup (reported as DNS_FAILURE) */
  signal?: AbortSignal;
  /** Test-only escape hatch (URL_FETCH_ALLOW_PRIVATE=1): loopback addresses on any port are allowed. */
  allowLoopback?: boolean;
}

export type UrlRefusalCode =
  | "INVALID_URL"
  | "URL_TOO_LONG"
  | "UNSUPPORTED_SCHEME"
  | "CREDENTIALS_IN_URL"
  | "PORT_NOT_ALLOWED"
  | "BLOCKED_ADDRESS"
  | "DNS_FAILURE";

export type UrlCheck =
  | { ok: true; url: URL; /** the address to connect to (pinned) */ address: string; addresses: string[] }
  /** `blocked`: refused by the SSRF policy (→ `guardrail.triggered: ssrf_blocked`), not merely unusable */
  | { ok: false; code: UrlRefusalCode; message: string; blocked: boolean };

export const MAX_URL_LENGTH = 2048;

export const systemResolver: Resolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

// spec §7.3: loopback, private, link-local (incl. metadata), CGNAT, 0/8, multicast, reserved, broadcast, v6 equivalents
const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::", 96], // IPv4-compatible (deprecated)
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48], // local-use NAT64
  ["::ffff:0:0:0", 96], // SIIT (not the IPv4-mapped ::ffff:0:0/96, which is unmapped below)
  ["2002::", 16], // 6to4: embeds any IPv4, including 127.x and 10.x
  ["2001::", 32], // Teredo
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8],
] as const)
  blocked.addSubnet(net, prefix, "ipv6");

/** `::ffff:a.b.c.d` / `::ffff:7f00:1` → `a.b.c.d`; anything else unchanged. */
function unmapIpv4(ip: string): string {
  const lower = ip.toLowerCase();
  const dotted = /^(?:0{0,4}:){0,5}:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return dotted[1]!;
  const hex = /^(?:0{0,4}:){0,5}:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (!hex) return ip;
  const hi = parseInt(hex[1]!, 16);
  const lo = parseInt(hex[2]!, 16);
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
}

export function isBlockedAddress(ip: string): boolean {
  const addr = unmapIpv4(ip);
  const family = isIP(addr);
  if (family === 0) return true;
  return blocked.check(addr, family === 4 ? "ipv4" : "ipv6");
}

const isLoopback = (ip: string) => {
  const addr = unmapIpv4(ip);
  return addr === "::1" || (isIP(addr) === 4 && addr.startsWith("127."));
};

/** Rejects as soon as the signal aborts; the lookup itself cannot be cancelled, its late result is ignored. */
function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("aborted"));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

const refuse = (code: UrlRefusalCode, message: string): UrlCheck => ({
  ok: false,
  code,
  message,
  blocked: code !== "INVALID_URL" && code !== "DNS_FAILURE",
});

/**
 * The SSRF guard (spec §7.3). Called for the initial URL, every redirect hop, every link check and every
 * browser sub-request. Resolves DNS once and returns the address the caller must connect to.
 */
export async function validateTargetUrl(raw: string, options: GuardOptions = {}): Promise<UrlCheck> {
  if (raw.length > MAX_URL_LENGTH) return refuse("URL_TOO_LONG", `The URL is longer than ${MAX_URL_LENGTH} characters.`);
  let url: URL;
  try {
    url = new URL(raw); // WHATWG parsing: IDN → punycode, odd IPv4 forms (0x7f.1, 2130706433) → dotted
  } catch {
    return refuse("INVALID_URL", "This is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return refuse("UNSUPPORTED_SCHEME", "Only http and https URLs can be inspected.");
  if (url.username || url.password) return refuse("CREDENTIALS_IN_URL", "URLs with credentials are not allowed.");
  if (url.href.length > MAX_URL_LENGTH) return refuse("URL_TOO_LONG", `The URL is longer than ${MAX_URL_LENGTH} characters.`);

  // the escape hatch never works in production, even if a caller passes it
  const allowLoopback = options.allowLoopback === true && process.env.NODE_ENV !== "production";
  const portOk = url.port === "" || url.port === "80" || url.port === "443";
  if (!portOk && !allowLoopback) return refuse("PORT_NOT_ALLOWED", "Only ports 80 and 443 are allowed.");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = await raceAbort((options.resolve ?? systemResolver)(host), options.signal);
    } catch {
      return refuse("DNS_FAILURE", `The host ${host} could not be resolved.`);
    }
    if (addresses.length === 0) return refuse("DNS_FAILURE", `The host ${host} could not be resolved.`);
  }

  const loopbackOnly = allowLoopback && addresses.every(isLoopback);
  if (!loopbackOnly && addresses.some(isBlockedAddress))
    return refuse("BLOCKED_ADDRESS", "The URL points to a private, local or reserved network address.");
  if (!portOk && !loopbackOnly)
    return refuse("PORT_NOT_ALLOWED", "Only ports 80 and 443 are allowed.");
  return { ok: true, url, address: addresses[0]!, addresses };
}
