# Investigation report: Home Insurance Quotes · Search (home-insurance-search)

- Verdict: **cause_identified** · Severity: **high** — Tracked conversions fell by −56.0% while real conversions held; bidding and reporting run on wrong data.
- Run `cmvcmtdf20000s0xfr4quvfio` · mode demo · runtime deterministic (model deterministic-policy-v1) · provenance synthetic-demo
- Question: Why did the conversion rate change between the baseline and current period?

## Summary

The tracked conversion rate went from 4.19% to 1.84% (−56.0%) between 2026-09-19…2026-10-02 vs 2026-10-03…2026-10-16, but backend-confirmed conversions stayed stable: the pixel recorded 97% of backend conversions before and only 42% after, starting with the deploy change recorded at 2026-10-03 22:15 UTC (change #3). This is a tracking loss, not a loss of customers.

## What changed

Tracked CR 4.19% → 1.84% [E2]; the pixel lost most backend-confirmed conversions [E8].

## Key metrics (computed by the server from tool evidence)

```json
{
  "ci95": [
    -0.027676,
    -0.019254
  ],
  "pValue": 1e-16,
  "current": {
    "period": {
      "end": "2026-10-16",
      "start": "2026-10-03"
    },
    "sessions": 12656,
    "conversions": 233,
    "conversionRate": 0.01841
  },
  "baseline": {
    "period": {
      "end": "2026-10-02",
      "start": "2026-09-19"
    },
    "sessions": 12585,
    "conversions": 527,
    "conversionRate": 0.041875
  },
  "isSignificant": true,
  "absoluteChange": -0.023465,
  "relativeChange": -0.5604,
  "conversionsPerDayDifference": -21
}
```

## Observations

- Between 2026-09-19…2026-10-02 vs 2026-10-03…2026-10-16 the tracked conversion rate went from 4.19% to 1.84% (−56.0%); the change is statistically significant (p < 0.001). [E2]
- Daily conversion rate averaged 4.18% before 2026-10-04 and 1.67% from 2026-10-04 on (change point; 15 vs 13 days, −60.0%). [E3]
- The pixel recorded 97% of backend-confirmed conversions in the baseline (527 of 543) but only 42% of backend-confirmed conversions in the current period (233 of 550). [E8]
- Change #3 at 2026-10-03 22:15 UTC, category deploy, by web-team (text in untrusted content). [E12]

## Hypotheses

| id | category | status | confidence | statement | supporting | contradicting |
|---|---|---|---|---|---|---|
| H1 | tracking | supported | high | The conversion pixel stopped firing for most conversions after the deploy change recorded at 2026-10-03 22:15 UTC (change #3); real conversions did not drop. | E8, E3, E12 | - |
| H2 | traffic_source | ruled_out | medium | One traffic source caused the drop. | - | E4, E5 |
| H3 | landing_page | ruled_out | medium | One device (a broken landing page) caused the drop. | - | E6, E7 |

- H1 confidence rationale: A direct pixel/backend divergence and the trend agree; nothing contradicts it.
- H2 confidence rationale: The cited evidence contradicts it.
- H3 confidence rationale: The cited evidence contradicts it.

## Unknowns

- **Which page or template stopped sending the conversion event?** It is the fix target. How to resolve: Test the confirmation step with a tag debugger.

## Recommended actions

- (now) Restore the conversion tag on the page changed at 2026-10-03 22:15 UTC and verify that it fires. — The pixel misses most conversions. [H1]
- (now) Do not cut bids or budgets on pixel data until tracking is fixed; judge performance on backend-confirmed conversions. — Pixel data understates real conversions. [H1]
- (next) Alert on the pixel-to-backend conversion ratio. — Catches the next tracking break early. [H1]

## Limitations

- Produced by the deterministic policy (no AI): fixed rules and report templates applied to the tool results.

## Security notes

- none

## Evidence

- **E1** Baseline 2026-09-19…2026-10-02: 12,585 sessions, 527 tracked conversions, CR 4.19%, spend $31,363.3; current 2026-10-03…2026-10-16: 12,656 sessions, 233 tracked conversions, CR 1.84%, spend $31,709.82.
- **E2** Tracked CR changed from 4.19% (527 / 12,585 sessions, 2026-09-19…2026-10-02) to 1.84% (233 / 12,656 sessions, 2026-10-03…2026-10-16): −2.35 pp (−56.0%); two-proportion z-test p < 0.001, 95% CI of the difference [−2.77 pp, −1.93 pp] — significant; −21.0 tracked conversions/day.
- **E3** Daily conversion rate averaged 4.18% before 2026-10-04 and 1.67% from 2026-10-04 on (change point; 15 vs 13 days, −60.0%).
- **E4** No source explains the CR change out of proportion to its traffic: the largest contributor, google_search, accounts for 69% of the −2.35 pp change with 70.2% of baseline sessions.
- **E5** All 2 source segments changed CR by a similar relative amount (−57.3% to −55.5%); mix effect +0.00 pp, rate effect −2.35 pp.
- **E6** No device explains the CR change out of proportion to its traffic: the largest contributor, mobile, accounts for 55% of the −2.35 pp change with 54.9% of baseline sessions.
- **E7** All 2 device segments changed CR by a similar relative amount (−56.4% to −55.8%); mix effect −0.00 pp, rate effect −2.35 pp.
- **E8** The pixel recorded 97% of backend-confirmed conversions in the baseline (527 of 543) but only 42% of backend-confirmed conversions in the current period (233 of 550).
- **E9** Largest funnel step change: form_submit→lead_submitted 0.8378 → 0.3675 (−56.1%); other steps: page_view→form_start 0.1829 → 0.1825, form_start→form_submit 0.2788 → 0.28.
- **E10** Change #1 at 2026-09-22 09:30 UTC, category budget, by ppc-manager (text in untrusted content).
- **E11** Change #2 at 2026-09-30 14:00 UTC, category other, by ppc-manager (text in untrusted content).
- **E12** Change #3 at 2026-10-03 22:15 UTC, category deploy, by web-team (text in untrusted content).
- **E13** Change #4 at 2026-10-08 11:00 UTC, category traffic, by ppc-manager (text in untrusted content).
