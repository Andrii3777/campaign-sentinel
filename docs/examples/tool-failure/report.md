# Investigation report: Meal Kit Subscription · Search + Social (meal-kit-search-social)

- Verdict: **likely_cause** · Severity: **high** — The tracked conversion rate changed by −42.0%; whether the loss is real could not be confirmed.
- Run `cmvcmtgmo0077s0xf5n7cvqrf` · mode demo · runtime deterministic (model deterministic-policy-v1) · provenance synthetic-demo
- Question: Why did the conversion rate change between the baseline and current period?

## Summary

The tracked conversion rate went from 3.92% to 2.27% (−42.0%) between 2026-09-19…2026-10-02 vs 2026-10-03…2026-10-16, evenly across sources and devices. The change point on 2026-10-05 lines up with the deploy change recorded at 2026-10-05 07:00 UTC (change #2), which makes a conversion flow problem the likely cause; tracking health could not be checked, so confidence is capped.

## What changed

CR 3.92% → 2.27% [E2]; the deploy change recorded at 2026-10-05 07:00 UTC (change #2) [E14].

## Key metrics (computed by the server from tool evidence)

```json
{
  "ci95": [
    -0.020991,
    -0.011925
  ],
  "pValue": 1.14e-12,
  "current": {
    "period": {
      "end": "2026-10-16",
      "start": "2026-10-03"
    },
    "sessions": 11219,
    "conversions": 255,
    "conversionRate": 0.022729
  },
  "baseline": {
    "period": {
      "end": "2026-10-02",
      "start": "2026-09-19"
    },
    "sessions": 11177,
    "conversions": 438,
    "conversionRate": 0.039188
  },
  "isSignificant": true,
  "absoluteChange": -0.016458,
  "relativeChange": -0.42,
  "conversionsPerDayDifference": -13.1
}
```

## Observations

- Between 2026-09-19…2026-10-02 vs 2026-10-03…2026-10-16 the tracked conversion rate went from 3.92% to 2.27% (−42.0%); the change is statistically significant (p < 0.001). [E2]
- Daily conversion rate averaged 3.90% before 2026-10-05 and 2.02% from 2026-10-05 on (change point; 16 vs 12 days, −48.1%). [E3]
- All 2 source segments changed CR by a similar relative amount (−42.1% to −41.8%); mix effect −0.00 pp, rate effect −1.65 pp. [E5]
- desktop: 5xx rate 0.0% → 0.0%, availability 100.0% → 100.0%, p95 1,067 → 1,027 ms, p50 788 → 756 ms (56 checks in the current period). [E9]
- mobile: 5xx rate 0.0% → 0.0%, availability 100.0% → 100.0%, p95 1,062 → 1,071 ms, p50 791 → 825 ms (56 checks in the current period). [E10]
- Change #2 at 2026-10-05 07:00 UTC, category deploy, by web-team (text in untrusted content). [E14]

## Hypotheses

| id | category | status | confidence | statement | supporting | contradicting |
|---|---|---|---|---|---|---|
| H1 | conversion_flow | supported | medium | The deploy change recorded at 2026-10-05 07:00 UTC (change #2) changed the conversion flow and conversions fell uniformly from 2026-10-05. | E14, E3, E2 | - |
| H2 | traffic_source | ruled_out | medium | One traffic source caused the drop. | - | E4, E5 |
| H3 | landing_page | ruled_out | medium | The landing page broke. | - | E9, E10 |

- H1 confidence rationale: Timing and a uniform drop support it, but no direct evidence confirms it and tracking health is unknown.
- H2 confidence rationale: The cited evidence contradicts it.
- H3 confidence rationale: The cited evidence contradicts it.

## Unknowns

- **What would inspect_tracking_health have shown?** The tool failed (UPSTREAM_UNAVAILABLE), so the findings it informs remain unconfirmed. How to resolve: Rerun the investigation when inspect_tracking_health is available.

## Recommended actions

- (now) Verify the conversion flow (form, checkout and confirmation events) end to end after the deploy change recorded at 2026-10-05 07:00 UTC (change #2). — It is the change aligned with the drop. [H1]
- (next) Rerun this investigation when the tracking-health data is available. — Rules a tracking loss in or out. [H1]

## Limitations

- Tracking health could not be checked, so a tracking loss is not ruled out.
- Produced by the deterministic policy (no AI): fixed rules and report templates applied to the tool results.

## Security notes

- none

## Tool failures

- inspect_tracking_health: UPSTREAM_UNAVAILABLE — The upstream data source for this tool did not respond (demo fault injected).

## Evidence

- **E1** Baseline 2026-09-19…2026-10-02: 11,177 sessions, 438 tracked conversions, CR 3.92%, spend $15,911.37; current 2026-10-03…2026-10-16: 11,219 sessions, 255 tracked conversions, CR 2.27%, spend $15,997.35.
- **E2** Tracked CR changed from 3.92% (438 / 11,177 sessions, 2026-09-19…2026-10-02) to 2.27% (255 / 11,219 sessions, 2026-10-03…2026-10-16): −1.65 pp (−42.0%); two-proportion z-test p < 0.001, 95% CI of the difference [−2.10 pp, −1.19 pp] — significant; −13.1 tracked conversions/day.
- **E3** Daily conversion rate averaged 3.90% before 2026-10-05 and 2.02% from 2026-10-05 on (change point; 16 vs 12 days, −48.1%).
- **E4** No source explains the CR change out of proportion to its traffic: the largest contributor, google_search, accounts for 55% of the −1.65 pp change with 54.9% of baseline sessions.
- **E5** All 2 source segments changed CR by a similar relative amount (−42.1% to −41.8%); mix effect −0.00 pp, rate effect −1.65 pp.
- **E6** No device explains the CR change out of proportion to its traffic: the largest contributor, mobile, accounts for 67% of the −1.65 pp change with 65.3% of baseline sessions.
- **E7** All 2 device segments changed CR by a similar relative amount (−42.7% to −40.7%); mix effect −0.00 pp, rate effect −1.65 pp.
- **E8** inspect_tracking_health unavailable: UPSTREAM_UNAVAILABLE
- **E9** desktop: 5xx rate 0.0% → 0.0%, availability 100.0% → 100.0%, p95 1,067 → 1,027 ms, p50 788 → 756 ms (56 checks in the current period).
- **E10** mobile: 5xx rate 0.0% → 0.0%, availability 100.0% → 100.0%, p95 1,062 → 1,071 ms, p50 791 → 825 ms (56 checks in the current period).
- **E11** Deployed version changed v4.9.2 → v5.0.0, first seen by monitoring at 2026-10-05 12:00 UTC.
- **E12** Snapshot of v5.0.0 captured 2026-10-16: form present, tracking tags: gtag, meta_pixel; page text is returned as untrusted content.
- **E13** Change #1 at 2026-10-01 09:00 UTC, category budget, by growth-team (text in untrusted content).
- **E14** Change #2 at 2026-10-05 07:00 UTC, category deploy, by web-team (text in untrusted content).
- **E15** Change #3 at 2026-10-08 12:00 UTC, category traffic, by growth-team (text in untrusted content).
