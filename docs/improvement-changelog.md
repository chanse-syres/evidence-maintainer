# Improvement and Invalidation Changelog

This changelog records what the evaluation process learned without converting invalid campaigns into performance claims.

**Current status:** no V1, V2, or V3 campaign is eligible for public comparison, and no live V4 campaign has been run. The public selector remains unassigned in [`config/public-comparison.json`](../config/public-comparison.json).

## Versioned campaign dispositions

| Campaign | Execution fact | Why it is invalid | Public disposition |
| --- | --- | --- | --- |
| V1 | 16 complete and 1 partial workflow out of 30 planned | The evaluator mixed adjudicated evidence, hidden lexical requirements, Challenger citations, and an invalid retry case into scoring. | No score. Preserve only as evaluator-debugging evidence. |
| V2 | 30 workflows completed with no infrastructure or evaluator process errors | The primary metric required exact oracle-authored evidence annotations even when actions and artifacts were semantically correct. | Do not use the raw arm rates as performance. Preserve as evidence that annotation conformity is not operational correctness. |
| V3 | 30 of 30 workflow slots completed with no infrastructure or evaluator process errors | The baseline received a Challenger result synthesized from hidden oracle data while the advanced arm used a real Challenger; two cases were also semantically invalid. | Do not aggregate or compare the arm rates. Preserve the freeze and raw receipts for audit and resource accounting. |
| V4 | Engine implemented; no live holdout campaign completed | A valid result requires a new frozen case pack and symmetric execution under the shared final-decision contract. | Comparative result pending. |

The governing records are [V1 invalidation](../holdout/INVALIDATION-v1.json), [V2 invalidation](../holdout/INVALIDATION-v2.json), and [V3 invalidation](../holdout/INVALIDATION-v3.json).

## V3 raw observations

The following values are retained because they are useful for auditing the completed execution. They are **not** valid estimates of either workflow's performance.

| Raw observation | Direct arm | Advanced arm |
| --- | ---: | ---: |
| Completed workflow slots | 15 | 15 |
| Action marked correct by the V3 evaluator | 15 | 15 |
| Source-coverage check passed | 15 | 15 |
| Forbidden mutations | 0 | 0 |
| V3 operational-integrity check passed | 15 | 14 |
| Exact annotation alignment passed | 5 | 3 |
| Median duration | 27,147 ms | 51,545 ms |
| Total tokens | 248,071 | 418,843 |

These values cannot be interpreted as a baseline win, an advanced-workflow loss, or an effect size. The arm asymmetry prevents causal comparison, and the invalid cases prevent a sound common denominator.

## Corrections carried into V4

V4 makes four structural changes:

1. Both arms emit the same final `DecisionPackage`.
2. Both arms pass through the same finalizer and semantic evaluator.
3. The Challenger is advisory process evidence; its recommendation does not directly determine the score.
4. Operational Decision Integrity measures six semantic and execution outcomes. Exact annotation alignment remains diagnostic only.

V4 also uses explicit authority-validity modes, satisfiable future retry selectors, exhaustive failure classes, symmetric evaluator invalidation, and case-balanced uncertainty estimation.

## What remains unmeasured

- Whether propose-challenge-revise improves ODI over the direct workflow.
- Whether any observed difference persists across repeated trials and new cases.
- The latency and token tradeoff for a complete valid V4 campaign.
- Generalization beyond the frozen maintenance domain.

Those questions remain open until a valid V4 campaign is frozen, executed, audited, and selected by the public comparison record.
