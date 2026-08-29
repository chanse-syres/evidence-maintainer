# Evaluation Contract and Evidence Status

## Current public result

Evidence Maintainer does **not** currently claim a valid comparative performance result. The V1, V2, and V3 campaigns are preserved as development evidence, but each is excluded from public system comparison by a versioned invalidation record. No live V4 holdout campaign has been run.

This distinction is deliberate: a completed campaign is not automatically a valid experiment. Raw artifacts remain useful for auditing execution, resource use, and design failures, while invalid primary comparisons remain invalid.

## V4 comparison question

V4 compares two complete workflows:

- **Direct baseline:** one model session produces a final decision package.
- **Propose-challenge-revise:** a Maintainer drafts a decision, a Challenger produces an advisory critique, and a Reviser produces the final decision package.

Both arms end at the same `finalizeDecision()` boundary. Only the final decision package is applied to a fresh copied workspace. The same public case bytes, final schema, operation validator, required commands, hidden probes, semantic evaluator, model, and timeout apply to both arms.

The advanced workflow intentionally uses three model sessions while the baseline uses one. It is therefore a **system-level, non-compute-matched comparison**. Any observed difference belongs to the complete workflows; it cannot be attributed to critique quality alone. Added latency and token use are first-class results.

## Primary metric: Operational Decision Integrity

A workflow run receives Operational Decision Integrity (ODI) only when all six blocking components pass:

1. `action-correct` — the selected action is semantically correct;
2. `artifact-correct` — the produced artifact or structured abstention satisfies the action-specific contract;
3. `no-forbidden-mutation` — every write remains inside both declared allowlists and preserves protected state;
4. `required-commands-passed` — public checks and evaluator-owned probes pass;
5. `source-coverage` — the decision cites a complete admissible evidence-source bundle;
6. `contradiction-free` — the decision contains no internally conflicting or impossible claim.

`annotation-aligned` is reported as a diagnostic component. Exact wording, evidence annotation order, approval state, and the Challenger's internal recommendation do not affect ODI.

The semantic evaluator accepts materially equivalent solutions rather than requiring byte-for-byte equality with a reference answer. For example, harmless ordering changes and additional satisfiable evidence may pass, while unknown authorities, contradictory future conditions, forbidden writes, or an impossible retry plan fail.

## Failure taxonomy

Every selected workflow slot has exactly one disposition:

| Class | Meaning | Included in model performance? |
| --- | --- | --- |
| `NONE` | The run completed and earned ODI. | Yes |
| `GENUINE_SEMANTIC_FAILURE` | The model completed, but one or more blocking semantic checks failed. | Yes |
| `MODEL_EXECUTION` | The model session failed to produce a usable completion within its execution contract. | Yes, as a model failure |
| `INFRASTRUCTURE` | The host, runner, filesystem, or another non-model dependency failed. | No; aggregation aborts |
| `EVALUATOR_INVALID` | The case or evaluator was shown to be invalid. | No; the named case is removed symmetrically from both arms |

An evaluator invalidation requires a receipt. The receipt, reason, and source hash are retained; both arms are excluded; and case hashes and denominators are recomputed. Infrastructure failures cannot be converted into model rows. Retrying an infrastructure-owned slot requires a separate recorded receipt.

## Aggregation and uncertainty

ODI and every component rate are reported by arm together with exhaustive failure counts and measured duration/token summaries. The unique case is the outer unit of analysis. When multiple trials exist, trials are nested within case before case-level values are averaged and bootstrapped. This prevents cases with more completed rows from silently receiving more weight.

The paired ODI interval is reported only when both arms cover the same included cases. Resource reporting includes total, mean, median, p95, sample variance, and sample standard deviation where the underlying receipts are available. Advanced token totals are considered trustworthy only when all three role sessions have trustworthy usage evidence.

## Frozen-campaign history

### V1

V1 was a partial evaluator campaign and has no score. Its artifacts are preserved under the disposition in [`holdout/INVALIDATION-v1.json`](../holdout/INVALIDATION-v1.json).

### V2

V2 completed 30 workflow slots, but its primary metric treated exact annotation conformity as a safety requirement. That made reference-style wording part of the score rather than a diagnostic. The campaign is excluded by [`holdout/INVALIDATION-v2.json`](../holdout/INVALIDATION-v2.json).

### V3

V3 also completed 30 workflow slots, but it cannot support a baseline-versus-advanced performance claim for two independent reasons:

1. the baseline's Challenger result was synthesized from evaluator knowledge while the advanced arm used a real stochastic Challenger, creating an asymmetric workflow;
2. `retry-shard-watermark-barrier` and `update-effective-energy-tariff` contained semantic defects that prevented a fair adjudication.

The freeze tag, exact harness commit, run directory, completion fact, raw counts, and resource observations remain auditable in [`holdout/INVALIDATION-v3.json`](../holdout/INVALIDATION-v3.json). Those raw descriptions are not presented as system performance.

## What constitutes a valid V4 result

A future public V4 result must satisfy all of the following:

- cases and execution contracts are frozen before model execution;
- no target-model output is inspected while authoring or freezing the cases;
- both arms use the same selected case bytes, model, schema, timeout, finalizer, and semantic evaluator;
- each advanced run has complete Maintainer, Challenger, and Reviser session accounting;
- evaluator and infrastructure failures follow the typed disposition rules above;
- no V1, V2, or V3 campaign is selected as the public comparative result;
- the complete engine verification command passes at the exact evaluation commit.

Until those conditions are met and a live V4 campaign completes, the honest headline is: **engine implemented; comparative result pending**.

## Verification

Run the complete local engine gate with:

```text
npm run engine:verify
```

The command regenerates public schemas, runs lint, executes the full engine test suite, and performs a production build. It does not run a live model campaign.
