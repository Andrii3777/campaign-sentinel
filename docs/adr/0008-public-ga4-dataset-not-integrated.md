# ADR-0008: The public GA4 sample dataset is evaluated and not integrated

Status: accepted (2026-10-17)

## Context

The brief asked whether a public analytics dataset could replace or complement the synthetic demo data. The obvious candidate is Google's public GA4 e-commerce sample.

## Facts checked on 2026-10-17

Source: the Google Analytics "web e-commerce demo dataset" page on developers.google.com/analytics/bigquery.

- Dataset: `bigquery-public-data.ga4_obfuscated_sample_ecommerce`, events from 2020-11-01 to 2021-01-31, from the Google Merchandise Store.
- Access needs a Google Cloud project with the BigQuery API enabled (the free sandbox tier is enough).
- Google states the data is obfuscated, with placeholder values and limited internal consistency.
- The page's text is licensed CC BY 4.0 and its code samples Apache 2.0, but no dataset-specific redistribution licence is stated; the dataset is governed by the BigQuery public datasets programme. Therefore no extract is committed to this repository.

## Options considered

| Option | Verdict |
|---|---|
| Use the dataset as the demo data | Rejected: it needs Google credentials (the project must run with no account or key), and it holds no anomaly with a known cause, so a conclusion could not be checked. |
| Commit an extract | Rejected: redistribution terms are unclear. |
| **Keep the seeded synthetic dataset; document the evaluation** | **Chosen.** |

## Decision

Not integrated. The demo uses `synthetic-demo-v1`: five campaigns generated from a seeded PRNG (mulberry32, seed 20261017), each with a hidden, known cause, so the agent's answer can be compared with the truth. Every report and every campaign carries the provenance `synthetic-demo`. A real connector is a production next step (see the README), where the data would be the customer's own.

## Trade-offs

- Synthetic data is easier to explain and to verify but is not a measurement of real-world behaviour. No claim about accuracy on real traffic is made.
- The demo cannot show how the agent copes with real noise and unlabelled anomalies.

## How verified

This ADR records a documentation check, not an experiment: the facts above were read on the page named, on the date given. Nothing was downloaded or queried from BigQuery.
