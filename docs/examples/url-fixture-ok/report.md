# Investigation report: http://127.0.0.1:4210/ok

- Verdict: **likely_cause** · Severity: **medium** — The most severe finding is a site content problem.
- Run `cmvcmthwl009is0xfb4u0m4eq` · mode url · runtime deterministic (model deterministic-policy-v1) · provenance live-http
- Question: Is this page healthy, fast and correctly set up for paid traffic?

## Summary

The page answered 200 in 20 ms. 1 problem(s) were found; the most important: 1 same-site link(s) or form action(s) are broken.

## What changed

1 same-site link(s) or form action(s) are broken. [E5, E6]

## Key metrics (computed by the server from tool evidence)

```json
{
  "bytes": 1360,
  "status": 200,
  "ttfbMs": 13,
  "totalMs": 20,
  "attempts": 3,
  "finalUrl": "http://127.0.0.1:4210/ok",
  "redirects": 0,
  "fetchError": null,
  "successRate": 1
}
```

## Observations

- GET http://127.0.0.1:4210/ok returned 200 in 20 ms (TTFB 13 ms), 1360 bytes. [E1]
- Page analysis: title present, meta description present, 1 h1, 28 words, 1 form, 2 CTAs, 3 internal / 1 external links, viewport meta present, lang set, HSTS yes, CSP yes. [E2]
- Tracking tags found in the HTML: GA4 (G-ABC123XYZ9); GTM (GTM-K9F2Q7P). [E3]
- 3/3 attempts succeeded (100%) for http://127.0.0.1:4210/ok; results 200, 200, 200; time min/median/max 9/11/18 ms. [E4]
- Checked 3 same-site links: 1 broken (http://127.0.0.1:4210/submit → 404). [E5]

## Hypotheses

| id | category | status | confidence | statement | supporting | contradicting |
|---|---|---|---|---|---|---|
| H1 | site_content | supported | medium | 1 same-site link(s) or form action(s) are broken. | E5, E6 | - |

- H1 confidence rationale: Measured directly on the live page; impact on conversions cannot be seen from a URL.

## Unknowns

- none

## Recommended actions

- (now) Fix or remove the broken links and form actions. — 1 same-site link(s) or form action(s) are broken. [H1]

## Limitations

- A URL gives access only to what the site publicly serves — status, timing, content, links, tags. It does not reveal ad spend, clicks, conversions or private analytics.
- Produced by the deterministic policy (no AI): fixed rules and report templates applied to the tool results.

## Security notes

- none

## Evidence

- **E1** GET http://127.0.0.1:4210/ok returned 200 in 20 ms (TTFB 13 ms), 1360 bytes.
- **E2** Page analysis: title present, meta description present, 1 h1, 28 words, 1 form, 2 CTAs, 3 internal / 1 external links, viewport meta present, lang set, HSTS yes, CSP yes.
- **E3** Tracking tags found in the HTML: GA4 (G-ABC123XYZ9); GTM (GTM-K9F2Q7P).
- **E4** 3/3 attempts succeeded (100%) for http://127.0.0.1:4210/ok; results 200, 200, 200; time min/median/max 9/11/18 ms.
- **E5** Checked 3 same-site links: 1 broken (http://127.0.0.1:4210/submit → 404).
- **E6** Link http://127.0.0.1:4210/submit is broken: HEAD returned 404.
