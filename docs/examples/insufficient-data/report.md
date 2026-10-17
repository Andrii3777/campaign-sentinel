# Investigation report: Language Course Trial · Affiliate (language-course-affiliate)

- Verdict: **inconclusive** · Severity: **low** — The change is not significant; acting on it now would be acting on noise.
- Run `cmvcmtg3c005us0xfj5l1lnh1` · mode demo · runtime deterministic (model deterministic-policy-v1) · provenance synthetic-demo
- Question: Why did the conversion rate change between the baseline and current period?

## Summary

The tracked conversion rate went from 4.29% to 2.12% (−50.5%) between 2026-09-19…2026-10-02 vs 2026-10-03…2026-10-16, but with only 18 and 7 conversions the difference is not statistically significant (p = 0.101) and 3 day(s) of data are missing. The change cannot be told apart from noise yet.

## What changed

CR 4.29% → 2.12%, not significant [E3, E7, E4].

## Key metrics (computed by the server from tool evidence)

```json
{
  "ci95": [
    -0.046482,
    0.003192
  ],
  "pValue": 0.101,
  "current": {
    "period": {
      "end": "2026-10-16",
      "start": "2026-10-03"
    },
    "sessions": 330,
    "conversions": 7,
    "conversionRate": 0.021212
  },
  "baseline": {
    "period": {
      "end": "2026-10-02",
      "start": "2026-09-19"
    },
    "sessions": 420,
    "conversions": 18,
    "conversionRate": 0.042857
  },
  "isSignificant": false,
  "absoluteChange": -0.021645,
  "relativeChange": -0.5051,
  "conversionsPerDayDifference": -0.6
}
```

## Observations

- Between 2026-09-19…2026-10-02 vs 2026-10-03…2026-10-16 the tracked conversion rate went from 4.29% to 2.12% (−50.5%); the change is not statistically significant (p = 0.101). [E3]
- Daily conversion rate averaged 5.19% before 2026-09-28 and 2.29% from 2026-09-28 on (change point; 9 vs 16 days, −55.8%). [E6]
- No data for 3 date(s) in the analysed periods: 2026-10-10, 2026-10-11, 2026-10-12. [E7]
- Low sample: 18 baseline and 7 current tracked conversions; detecting 4.29% vs 2.12% reliably needs about 1,038 sessions per period, available 420 and 330. [E4]
- Pixel and backend agree: the pixel recorded 100% of backend-confirmed conversions in the baseline (18 of 18) and 100% in the current period (7 of 7). [E8]

## Hypotheses

| id | category | status | confidence | statement | supporting | contradicting |
|---|---|---|---|---|---|---|
| H1 | data_quality | plausible | low | The sample is too small (and incomplete) to show whether the conversion rate really changed. | E3, E7, E4 | - |

- H1 confidence rationale: Low sample and missing days; the test is not significant.

## Unknowns

- **Is the conversion-rate change real or noise?** The sample is too small: 18 baseline and 7 current conversions give p = 0.101. How to resolve: Collect about 1038 sessions per period, or compare longer periods.
- **What happened on 2026-10-10, 2026-10-11, 2026-10-12?** Those days have no data, so the current period is incomplete. How to resolve: Restore the missing export days and rerun the investigation.

## Recommended actions

- (now) Restore the missing data for 2026-10-10, 2026-10-11, 2026-10-12. — The gap biases the current period. [H1]
- (next) Keep the campaign unchanged and rerun once both periods have enough conversions. — A non-significant change does not justify changes. [H1]

## Limitations

- Produced by the deterministic policy (no AI): fixed rules and report templates applied to the tool results.

## Security notes

- none

## Evidence

- **E1** Baseline 2026-09-19…2026-10-02: 420 sessions, 18 tracked conversions, CR 4.29%, spend $237.35; current 2026-10-03…2026-10-16: 330 sessions, 7 tracked conversions, CR 2.12%, spend $186.19.
- **E2** No data for 3 date(s) in the analysed periods: 2026-10-10, 2026-10-11, 2026-10-12.
- **E3** Tracked CR changed from 4.29% (18 / 420 sessions, 2026-09-19…2026-10-02) to 2.12% (7 / 330 sessions, 2026-10-03…2026-10-16): −2.16 pp (−50.5%); two-proportion z-test p = 0.101, 95% CI of the difference [−4.65 pp, +0.32 pp] — not significant; −0.6 tracked conversions/day.
- **E4** Low sample: 18 baseline and 7 current tracked conversions; detecting 4.29% vs 2.12% reliably needs about 1,038 sessions per period, available 420 and 330.
- **E5** No data for 3 date(s) in the analysed periods: 2026-10-10, 2026-10-11, 2026-10-12.
- **E6** Daily conversion rate averaged 5.19% before 2026-09-28 and 2.29% from 2026-09-28 on (change point; 9 vs 16 days, −55.8%).
- **E7** No data for 3 date(s) in the analysed periods: 2026-10-10, 2026-10-11, 2026-10-12.
- **E8** Pixel and backend agree: the pixel recorded 100% of backend-confirmed conversions in the baseline (18 of 18) and 100% in the current period (7 of 7).
- **E9** Largest funnel step change: form_start→form_submit 0.2632 → 0.1034 (−60.7%); other steps: page_view→form_start 0.181 → 0.1758, form_submit→lead_submitted 0.9 → 1.1667.
