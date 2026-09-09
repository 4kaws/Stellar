# Pilot results

Completed: 2026-09-07T16:13:17.731Z

Overall: **passed**

| Run | Status | Evidence |
|---|---|---|
| Baseline, 20 components | accepted-for-pilot | [receipt](../artifacts/2026-09-07T16-11-53-103Z-full-93e7ce24/report.json) |
| Refactor and v2 requirements | passed | [evolution](../artifacts/2026-09-07T16-12-07-339Z-evolution-0df3066a/evolution.json) |
| 19 adversarial checks | passed | [attacks](../artifacts/2026-09-07T16-12-37-887Z-attacks-b13b890b/attacks.json) |

These results establish behavior on the authored pilot tasks under the recorded trust assumptions. They are not a production certification or a model success-rate estimate.

## Per-component compiled checks

| Component | Examples and generated cases | Encoding/error checks |
|---|---:|---:|
| discount | 170 | 12 |
| add_tax | 170 | 12 |
| prorate | 171 | 12 |
| ceil_div | 169 | 12 |
| clamp | 169 | 12 |
| saturating_sub | 169 | 12 |
| transfer_remaining | 169 | 12 |
| shipping_fee | 169 | 12 |
| loyalty_points | 169 | 12 |
| tier_rate | 171 | 12 |
| late_fee | 172 | 12 |
| refund_cap | 169 | 12 |
| inventory_available | 169 | 12 |
| reorder_quantity | 169 | 12 |
| interval_overlap | 173 | 12 |
| within_window | 170 | 12 |
| leap_year | 172 | 12 |
| days_in_month | 176 | 12 |
| max_of_three | 170 | 12 |
| median_of_three | 174 | 12 |

## Adversarial checks

- impossible-precondition: passed
- overrestricted-precondition: passed
- vacuous-domain: passed
- tautological-postcondition: passed
- wrong-definition: passed
- contract-edit-in-submission: passed
- missing-component: passed
- assumption-injection: passed
- skipped-verification: passed
- foreign-code: passed
- demonstrate-vacuous-proof: passed
- universal-domain-coverage: passed
- audit-zero-exit-with-findings: passed
- timeout-is-unknown: passed
- rare-bugs-evade-finite-tests: passed
- formal-gate-rejects-rare-bugs: passed
- full-gate-rejects-rare-bugs: passed
- incorrect-rounding-implementation: passed
- stale-package-binding: passed
