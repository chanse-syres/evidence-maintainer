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

**No valid public comparative result has been selected.**

V1, V2, and V3 are preserved as development evidence, but each is excluded from system-performance claims by a versioned invalidation record. V3 completed its planned workflow slots, yet its arms were asymmetric and two cases were semantically invalid. Its raw artifacts can support audit and resource accounting; they cannot support a claim that one system outperformed the other.

No live V4 holdout campaign has been run. [`config/public-comparison.json`](config/public-comparison.json) therefore remains `PENDING_VALID_V4_CAMPAIGN` with no selected campaign or summary.

The current public headline is: **engine implemented; comparative result pending**.

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

Then open `http://localhost:3000`. Any recorded fixture or invalidated campaign shown in the interface is engineering evidence, not a selected model result.

See [Reproduction guide](docs/reproduction.md) for the credential-free verification boundary and the requirements for a future live V4 campaign.

## Evidence map

- [Architecture and trust boundaries](docs/architecture.md)
- [Evaluation contract and evidence status](docs/evaluation.md)
- [Improvement and invalidation changelog](docs/improvement-changelog.md)
- [Historical trajectory index](docs/trajectory-index.md)
- [Reproduction guide](docs/reproduction.md)
- [Pending-result video script](docs/video-script.md)
- [V1 invalidation](holdout/INVALIDATION-v1.json)
- [V2 invalidation](holdout/INVALIDATION-v2.json)
- [V3 invalidation](holdout/INVALIDATION-v3.json)
- [Public comparison selector](config/public-comparison.json)

## Scope and limits

The repository evaluates isolated maintenance decisions over frozen synthetic or public-data-derived cases. It does not prove production safety. Agents cannot write to a live product or external service, and hidden oracle bytes remain evaluator-owned.

A valid public result still requires a new frozen V4 case pack, complete execution receipts, typed treatment of model, infrastructure, and evaluator failures, and post-run audit without in-place repair of invalid cases.

The domain patterns came from public-data maintenance experience. No production repository, private task bytes, private account data, live credentials, or proprietary trajectories are included.

## License

[MIT](LICENSE)
