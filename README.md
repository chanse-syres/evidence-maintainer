# Evidence Maintainer

Evidence Maintainer is an agentic reliability system for a deceptively dangerous maintenance problem: deciding whether a new observation justifies changing canonical public data.

Most autonomous maintainers optimize for successful writes. This project optimizes for **Safe Decision Rate**: make the right change when the evidence is authoritative, repair the ingestion path when the adapter is broken, wait when retrieval is incomplete, escalate genuine ambiguity, and do nothing when a new observation is not a new fact.

> **Hot take:** The safest autonomous maintainer is not the one that changes the most data. It is the one that can prove when a new observation is not yet a new fact.

## Why this matters

Public-data products repeatedly ingest noisy, delayed, duplicated, filtered, and structurally drifting sources. A plausible but incorrect update can survive ordinary tests and silently corrupt every downstream consumer. Human maintainers therefore spend too much time reconstructing source authority, temporal semantics, identity, and adapter behavior before they can decide whether any write is justified.

Evidence Maintainer turns that bottleneck into an auditable workflow. It supports five explicit dispositions:

- `UPDATE_DATA` when public authority justifies an exact canonical change;
- `REPAIR_ADAPTER` when the source is valid but ingestion logic has drifted;
- `RETRY_LATER` when the observation is incomplete or transient;
- `NO_ACTION` when the apparent change is not a new authoritative fact;
- `HUMAN_REVIEW` when authorities or identities genuinely conflict.

## The system

The comparison is deliberately asymmetric but fair:

1. A **direct baseline agent** receives the same immutable case workspace and returns one decision.
2. The advanced **Maintainer** builds an evidence ledger, proposes one disposition, and declares its exact write surface.
3. An independent **Challenger** tests authority, identity, time, regression, and approval claims without editing the candidate.
4. A deterministic gate executes the candidate in an isolated workspace, compares before/after trees, checks evidence support and regressions, and withholds simulated approval on any failed invariant.

The hidden oracle is loaded only after agent execution. Neither arm can write to a live product or external service. See the [architecture and trust boundaries](docs/architecture.md).

## Measured result

The frozen live comparison used `gpt-5.6-terra`, the same 15 cases, one trial per case, the same schemas, the same 1,200,000 ms per-agent timeout, and identical agent-visible workspace bytes.

| Metric | Direct baseline | Evidence Maintainer | Change |
| --- | ---: | ---: | ---: |
| Safe Decision Rate | 12/15 (80.0%) | 15/15 (100%) | **+20.0 pp** |
| Approval-eligible completion | 12/15 (80.0%) | 14/15 (93.3%) | **+13.3 pp** |
| Correct abstention | 40.0% | 60.0% | **+20.0 pp** |
| Unsafe mutation rate | 0% | 0% | 0 pp |
| Execution errors | 0 | 0 | 0 |
| Median duration | 11.841 s | 20.627 s | +8.786 s |
| Total tokens | 327,479 | 565,671 | +72.7% |

Safe Decision Rate requires all five of: correct action, correct artifact, no forbidden mutation, preserved regressions, and evidence-supported claims. The Challenger is not retroactively included in that preregistered metric. It conservatively blocked one otherwise correct advanced proposal because the Maintainer declared an incomplete approval level, so approval-eligible completion is reported separately as 14/15.

The three baseline misses all chose the correct high-level action but failed exact evidence support. The advanced workflow recovered all three. Full methods, confidence intervals, failure analysis, and limitations are in [the evaluation report](docs/evaluation.md). Raw live evidence is frozen in [the final evaluation bundle](artifacts/evaluation/final-v3).

## Run the credential-free demo

Requirements: Node.js 24 or newer and npm.

```bash
npm ci
npm run schemas
npm test
npm run demo
npm run build
```

`npm run demo` replays truth-labeled **recorded** fixtures, writes 15 decision reports, and never calls a model or external service. Open the generated report index through the Next.js interface:

```bash
npm run dev
```

Then visit `http://localhost:3000`. Recorded fixtures are reproducibility controls, not fresh model evidence.

To prove the complete package after cloning:

```bash
npm run submission:verify
```

The verifier checks all case provenance hashes, the frozen case-set hash, 30 live rows, 60 run manifests across live and recorded comparisons, 90+ artifact hashes, all 45 live role trajectories, 15 rendered report hashes, documentation links, credential-like filenames, and a clean Git tree.

See [reproduction.md](docs/reproduction.md) for Windows, macOS/Linux, Docker, recorded evaluation, and optional live-model commands.

## Evidence map

- [Architecture](docs/architecture.md)
- [Evaluation method and frozen results](docs/evaluation.md)
- [Improvement changelog](docs/improvement-changelog.md)
- [Trajectory index](docs/trajectory-index.md)
- [Reproduction guide](docs/reproduction.md)
- [Five-minute video script](docs/video-script.md)
- [Frozen live summary](artifacts/evaluation/final-v3/summary.json)
- [One live result row per case and arm](artifacts/evaluation/final-v3/rows.jsonl)
- [Recorded demo manifest](artifacts/demo/manifest.json)

## What was built during the challenge

The submission includes the case schema and provenance contract, 15 benchmark cases, direct baseline, Maintainer and Challenger roles, structured output schemas, isolated mutation engine, evidence ledger, deterministic safety gate, simulated approval boundary, recorded runner, live Codex runner, evaluation harness, aggregate metrics, HTML decision reports, Next.js evidence browser, tests, container, artifact verifier, and the complete iteration history.

The domain patterns came from prior public-data maintenance experience. No production repository, private task bytes, private account data, live credentials, or proprietary trajectories are included. Every consequential action in this repository is sandboxed to a copied case workspace.

## Limits and next experiment

The final result has one live trial per case and therefore substantial sampling uncertainty. Cases are frozen and synthetic or public-data-derived. The advanced arm also costs more time and tokens. The next honest experiment is at least three trials per frozen case on the exact commit, followed by a new holdout pack authored without changing prompts.

## License

[MIT](LICENSE)
