# Investigation report: Fitness App Trial · Paid Social (fitness-trial-social)

- Verdict: **likely_cause** · Severity: **high** — The tracked conversion rate changed by −35.2%; the loss is concentrated in one source.
- Run `cmvcmte9f0020s0xfe004ehwh` · mode demo · runtime deterministic (model deterministic-policy-v1) · provenance synthetic-demo
- Question: Why did the conversion rate change between the baseline and current period?

## Summary

The tracked conversion rate went from 3.98% to 2.58% (−35.2%) between 2026-09-19…2026-10-02 vs 2026-10-03…2026-10-16. One source explains most of it: native_network_a grew from 20.2% to 47.3% of sessions while its conversion rate fell from 2.98% to 0.70%, starting with the traffic change recorded at 2026-10-05 08:00 UTC (change #2). Lower-quality traffic from native_network_a is the likely cause.

## What changed

CR 3.98% → 2.58% [E2]; native_network_a explains most of the change [E4].

## Key metrics (computed by the server from tool evidence)

```json
{
  "ci95": [
    -0.017572,
    -0.010485
  ],
  "pValue": 5.95e-16,
  "current": {
    "period": {
      "end": "2026-10-16",
      "start": "2026-10-03"
    },
    "sessions": 25429,
    "conversions": 656,
    "conversionRate": 0.025797
  },
  "baseline": {
    "period": {
      "end": "2026-10-02",
      "start": "2026-09-19"
    },
    "sessions": 16773,
    "conversions": 668,
    "conversionRate": 0.039826
  },
  "isSignificant": true,
  "absoluteChange": -0.014029,
  "relativeChange": -0.3522,
  "conversionsPerDayDifference": -0.9
}
```

## Observations

- Between 2026-09-19…2026-10-02 vs 2026-10-03…2026-10-16 the tracked conversion rate went from 3.98% to 2.58% (−35.2%); the change is statistically significant (p < 0.001). [E2]
- Daily conversion rate averaged 4.00% before 2026-10-05 and 2.42% from 2026-10-05 on (change point; 16 vs 12 days, −39.4%). [E3]
- native_network_a explains 96% of the tracked CR change (−1.35 pp of −1.40 pp): share of sessions 20.2% → 47.3%, CR 2.98% → 0.70%, clicks→sessions 0.919 → 0.559. [E4]
- CR changes differ across source segments (−76.5% to +1.0%); mix effect −0.34 pp, rate effect −1.06 pp. [E5]
- Change #2 at 2026-10-05 08:00 UTC, category traffic, by media-buyer (text in untrusted content). [E7]

## Hypotheses

| id | category | status | confidence | statement | supporting | contradicting |
|---|---|---|---|---|---|---|
| H1 | traffic_source | supported | high | Traffic from native_network_a grew and converts far worse (clicks→sessions 0.919 → 0.559), pulling the overall rate down. | E4, E3, E7 | - |

- H1 confidence rationale: A direct segment decomposition plus the trend (and an aligned change) agree; nothing contradicts it.

## Unknowns

- **Is tracking healthy for native_network_a?** Tracking was not checked because the source decomposition was conclusive. How to resolve: Run the tracking-health check for this campaign.

## Recommended actions

- (now) Pause or restrict the native_network_a placements that grew after 2026-10-05 and exclude low-quality placements. — native_network_a converts far below its baseline. [H1]
- (next) Review native_network_a click quality (clicks→sessions) with the network. — Many clicks never become sessions. [H1]

## Limitations

- Produced by the deterministic policy (no AI): fixed rules and report templates applied to the tool results.

## Security notes

- none

## Evidence

- **E1** Baseline 2026-09-19…2026-10-02: 16,773 sessions, 668 tracked conversions, CR 3.98%, spend $12,081.49; current 2026-10-03…2026-10-16: 25,429 sessions, 656 tracked conversions, CR 2.58%, spend $18,373.1.
- **E2** Tracked CR changed from 3.98% (668 / 16,773 sessions, 2026-09-19…2026-10-02) to 2.58% (656 / 25,429 sessions, 2026-10-03…2026-10-16): −1.40 pp (−35.2%); two-proportion z-test p < 0.001, 95% CI of the difference [−1.76 pp, −1.05 pp] — significant; −0.9 tracked conversions/day.
- **E3** Daily conversion rate averaged 4.00% before 2026-10-05 and 2.42% from 2026-10-05 on (change point; 16 vs 12 days, −39.4%).
- **E4** native_network_a explains 96% of the tracked CR change (−1.35 pp of −1.40 pp): share of sessions 20.2% → 47.3%, CR 2.98% → 0.70%, clicks→sessions 0.919 → 0.559.
- **E5** CR changes differ across source segments (−76.5% to +1.0%); mix effect −0.34 pp, rate effect −1.06 pp.
- **E6** Change #1 at 2026-09-25 13:00 UTC, category other, by social-team (text in untrusted content).
- **E7** Change #2 at 2026-10-05 08:00 UTC, category traffic, by media-buyer (text in untrusted content).
- **E8** Change #3 at 2026-10-07 09:00 UTC, category budget, by media-buyer (text in untrusted content).
- **E9** Change #4 at 2026-10-10 16:00 UTC, category deploy, by web-team (text in untrusted content).
