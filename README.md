# Evidence Maintainer

Evidence Maintainer is an agentic evaluation system for a narrow but consequential maintenance decision: whether a new public observation justifies changing canonical data.

The system supports five dispositions:

- `UPDATE_DATA` when agent-visible authority supports an exact canonical change;
- `REPAIR_ADAPTER` when a source is valid but ingestion logic is wrong;
- `RETRY_LATER` when future evidence can resolve an incomplete observation;
- `NO_ACTION` when the apparent change is not a new authoritative fact;
- `HUMAN_REVIEW` when the missing decision-bearing facts require human resolution.

## Research question

Does a bounded propose-challenge-revise workflow produce more correct final maintenance decisions than a direct single-agent workflow when both receive the same case bytes and are scored by the same external evaluator?

The experiment must be able to return a negative result. The repository does not assume that the advanced workflow wins.

## Evaluation design

V4 compares two complete systems:

1. The **direct baseline** uses one model session to produce a final `DecisionPackage`.
2. **Propose-challenge-revise** uses a Maintainer to draft a package, a Challenger to provide advisory criticism, and a Reviser to produce the final package.

Both arms submit the same final schema to one `finalizeDecision()` boundary. That boundary applies only declared operations to a fresh copied workspace, runs the same required commands and hidden probes, and invokes the same semantic evaluator. The Challenger is part of the advanced workflow, not part of its grader.

The advanced arm intentionally uses three model sessions while the baseline uses one. This is a system-level, non-compute-matched comparison; latency and token use are therefore part of the result.

See [Architecture and trust boundaries](docs/architecture.md) and [Evaluation contract and evidence status](docs/evaluation.md).

## Primary metric

The V4 primary metric is **Operational Decision Integrity (ODI)**. A run earns ODI only when all six blocking checks pass:

- correct action;
- semantically correct action-specific artifact;
- no forbidden mutation;
- required public commands and evaluator-owned probes pass;
- complete admissible source coverage;
- no contradictory or impossible claim.

Exact annotation wording and order are diagnostic only. They do not affect ODI.

## Current evidence status

**A live V4 comparison is selected, with no measured correctness advantage for the advanced workflow.**

V1, V2, and V3 are preserved as development evidence, but each is excluded from system-performance claims by a versioned invalidation record. V3 completed its planned workflow slots, yet its arms were asymmetric and two cases were semantically invalid. Its raw artifacts can support audit and resource accounting; they cannot support a claim that one system outperformed the other.

V4 attempt 2 ran five frozen cases with three trials per arm on `gpt-5.6-terra`. Post-run audit found that one retry case could not be represented or scored faithfully by the declared schema, so its six rows were classified `EVALUATOR_INVALID` and excluded symmetrically. The receipt and raw evidence remain preserved.

On the four included cases, the direct baseline and propose-challenge-revise workflow each earned ODI on **12/12** runs, a **0 percentage-point difference**. The advanced workflow used **1,098,554 ms** and **519,289 tokens**, versus **412,010 ms** and **170,263 tokens** for the baseline: about **2.67× the total duration** and **3.05× the tokens**, with no measured correctness gain.

This is a descriptive result from a small frozen holdout. It is not evidence of workflow equivalence, population-level generalization, or production safety. [`config/public-comparison.json`](config/public-comparison.json) selects the adjudicated campaign and [`artifacts/evaluation/holdout-v4-attempt-2/summary.json`](artifacts/evaluation/holdout-v4-attempt-2/summary.json) contains the exact result.

## Verify the engine

Requirements: Node.js 24 or newer and npm.

```bash
npm ci
npm run engine:verify
```

`engine:verify` regenerates public schemas, runs lint and the complete engine test suite, and performs a production build. It does not call a live model and does not create performance evidence.

For a local inspection:

```bash
npm run dev
```

Then open `http://localhost:3000`. The interface reads only the campaign named by the public comparison selector; historical recorded fixtures remain engineering evidence.

See [Reproduction guide](docs/reproduction.md) for the credential-free verification boundary and selected-evidence checks.

## Evidence map

- [Architecture and trust boundaries](docs/architecture.md)
- [Evaluation contract and evidence status](docs/evaluation.md)
- [Improvement and invalidation changelog](docs/improvement-changelog.md)
- [Historical trajectory index](docs/trajectory-index.md)
- [Reproduction guide](docs/reproduction.md)
- [Result-aware video script](docs/video-script.md)
- [V1 invalidation](holdout/INVALIDATION-v1.json)
- [V2 invalidation](holdout/INVALIDATION-v2.json)
- [V3 invalidation](holdout/INVALIDATION-v3.json)
- [Public comparison selector](config/public-comparison.json)

## Scope and limits

The repository evaluates isolated maintenance decisions over frozen synthetic or public-data-derived cases. It does not prove production safety. Agents cannot write to a live product or external service, and hidden oracle bytes remain evaluator-owned.

The selected result covers four valid frozen cases and three repeated trials per arm. Its case-level ceiling result and small sample do not establish equivalence or generalization. The excluded retry case requires a new schema, evaluator, version, and freeze before it can re-enter a future comparison.

The domain patterns came from public-data maintenance experience. No production repository, private task bytes, private account data, live credentials, or proprietary trajectories are included.

## License

[MIT](LICENSE)
