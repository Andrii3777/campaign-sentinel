# ADR-0007: URL mode and the SafeFetcher

Status: accepted (2026-10-17)

## Context

Besides the demo data, the user can submit a public URL for a live check. A server that fetches URLs on request is an SSRF primitive, and a model that chooses what to fetch makes it worse. A URL also reveals little: status, timing, content, links and tags, but never spend, clicks or conversions; the product must not pretend otherwise.

## Options considered

| Option | Verdict |
|---|---|
| Plain `fetch` with a blocklist of hostnames | Rejected: hostnames resolve to anything; DNS rebinding defeats a check made before the request. |
| An egress proxy or network policy only | Right for production, not available for a local demo; kept as a next step. |
| **An application-level guard, DNS pinning and hard limits, applied to every hop** | **Chosen.** |

## Decision

`apps/api/src/web-inspection`:

- `validateTargetUrl`: http and https only, ports 80 and 443 only, no credentials in the URL, at most 2048 characters, internationalised names converted to punycode; the name is resolved and the URL is refused if **any** resolved address is loopback, private, link-local (including the cloud metadata address), carrier-grade NAT, `0.0.0.0/8`, multicast, reserved, broadcast, IPv6 loopback, unique-local or link-local, or an IPv4-mapped form of those.
- The request connects to the **validated address** (a custom `lookup` on `node:http` and `node:https`), so a second DNS answer cannot redirect it. Redirects are followed manually (at most 5) and each hop goes through the guard again; a redirect to `169.254.169.254` is refused.
- Limits: 8 s per request, 2 MB per body (the stream is aborted), only HTML and plain text are parsed, no cookies and no authorization headers, 25 outbound requests and 10 checked links per investigation, same-site links only for `check_links`. `fetch_page` accepts only the target or a link or form action seen on an already fetched page, so the model cannot ask for an arbitrary address.
- `browser_check` (optional Playwright Chromium) routes every sub-request through the same validator and aborts disallowed ones; if Chromium is not installed the tool answers `unavailable` with how to enable it, and the report must say the check was not made. The Docker image has no Chromium.
- Refusals are plain 400 messages and `guardrail.triggered` events. HTTP failures (DNS, refused, TLS, timeout, 4xx and 5xx, redirect loops, oversized or non-HTML bodies) are recorded as evidence and the run still completes with a report that says what could not be checked.
- Test-only switch `URL_FETCH_ALLOW_PRIVATE=1` admits loopback addresses so tests and the examples script can use a local fixture site; the API refuses to start with it when `NODE_ENV=production`, and it never admits private ranges or link-local addresses.

The User-Agent is `CampaignSentinel/1.0 (+https://github.com/Andrii3777/campaign-sentinel)`, which identifies the fetcher to site owners.

## Trade-offs

- Ports other than 80 and 443 are refused even for legitimate sites.
- A public page can still cause up to 25 outbound requests per investigation, from the host the API runs on; creation is throttled (5 URL investigations per minute per address, in memory).
- The guard is application-level: a production deployment should add egress network policy as a second layer.
- Browser checks add a large dependency and are off in Docker.

## How verified

Unit tests cover every blocked range, redirect re-validation and DNS-rebinding pinning; integration tests run the URL tools against a local fixture site (redirect chains and loops, an oversized body, a redirect to a private address, a slow page, a hidden injection). On 2026-10-17 `scripts/verify/url-live.mjs` checked `https://example.com` once: HTTP 200 in about 79 ms, and Chromium loaded it too. That is a single manual check, not a test; see [verification.md](../verification.md).
