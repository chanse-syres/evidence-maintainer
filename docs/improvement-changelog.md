# Improvement Changelog

This changelog records what was actually run while building Evidence Maintainer. Rows are historical experiments, not a post-hoc ablation study: case subsets and implementation commits changed between some stages. Only `final-v3` is the frozen headline comparison.

Safe Decision Rate (SDR) requires the correct action, correct artifact, no forbidden mutation, preserved regressions, and evidence-supported claims. Approval-eligible completion is reported separately because the independent Challenger can block an otherwise safe proposal.

| Stage | Change and hypothesis | Cases | Baseline SDR | Advanced SDR | Unsafe mutations (B/A) | Median time ms (B/A) | Tokens (B/A) | Decision |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `recorded-core` | Deterministic fixtures tested the evidence ledger, action routing, Challenger, and gate before spending live compute. | 12 | 16.7% | 100% | 16.7% / 0% | 5.5 / 6.5 | 0 / 0 | Keep as an offline control only; recorded output is not live-model evidence. |
| `live-pilot` | First live two-case runner check. Hypothesis: both arms can complete identical schema-bound sessions without infrastructure errors. | 2 | 100% | 100% | 0% / 0% | 10,618 / 17,929 | 35,543 / 73,153 | Keep the runner; subset was too easy to measure improvement. |
| `final` | First complete live suite. The early advanced contract required process evidence that did not yet exist and coupled acceptance to brittle wording. | 15 | 40.0% | 26.7% | 0% / 0% | 11,259 / 20,920 | 335,081 / 621,217 | Reject the architecture version. The advanced system underperformed by 13.3 points. |
| `live-pilot-v2` | Three-case diagnostic after the first correction. Hypothesis: clearer process timing was sufficient. | 3 | 100% | 33.3% | 0% / 0% | 10,966 / 19,379 | 52,795 / 108,929 | Revise. It exposed missing public authority for `ratingAsOf` and underdefined action routing. |
| `recorded-all` | Replayed all 15 adjudicated cases after adding behavioral action definitions and complete public authority. | 15 | 13.3% | 100% | 33.3% / 0% | 9 / 8 | 0 / 0 | Keep as deterministic regression coverage, not a model result. |
| `live-pilot-v3` | Live check of the corrected decision contract on three previously diagnostic cases. | 3 | 100% | 100% | 0% / 0% | 10,183 / 16,315 | 52,814 / 109,264 | Keep the contract correction; proceed to a complete run. |
| `final-v2` | Complete live comparison after the contract correction. | 15 | 66.7% | 80.0% | 0% / 0% | 11,281 / 17,909 | 282,487 / 437,385 | Do not use as headline evidence. Four adapter rows were contaminated by host policy blocking read-only PowerShell inspection. |
| `live-repair-pilot` | Embedded the same immutable agent-visible workspace bytes in both prompts so reasoning no longer depended on terminal policy. | 3 | 100% | 100% | 0% / 0% | 23,611 / 21,611 | 110,290 / 115,252 | Keep. All six gates passed, all six approvals were eligible, and execution errors fell to zero. |
| `final-v3` | Frozen full comparison on the shell-independent harness. | 15 | 80.0% | 100% | 0% / 0% | 11,841 / 20,627 | 327,479 / 565,671 | Final primary result. SDR improved by 20 points with zero errors and zero unsafe mutations. |

## What changed the outcome

Three changes mattered:

1. **Behavioral action routing replaced process-shaped guessing.** The agent was told what each action means in the maintenance domain, while adjudicated answers remained hidden.
2. **Every proposed field change needed public authority.** The case contract now exposes the evidence necessary to justify observable behavior without revealing the oracle.
3. **Agent-visible inputs became shell independent.** Baseline, Maintainer, and Challenger receive identical immutable file bytes already declared in the public case manifest. The deterministic gate still executes the actual candidate and regressions in an isolated workspace.

The final baseline chose the right action in all 15 cases, but three abstention decisions cited insufficient evidence. The advanced workflow grounded those same decisions correctly. Its Challenger also rejected one factually correct update because the Maintainer marked its own approval level `NONE`; this reduced approval-eligible completion to 14/15 while preventing an unsupported process transition.

## What was not claimed

- The recorded runs are reproducibility controls, not fresh model evaluations.
- `final-v2` is retained as failure evidence but excluded from headline metrics.
- A larger agent swarm was considered but not implemented or measured. The project retained two non-overlapping roles because the observed failures were contract and evidence failures, not a shortage of parallel agents.
- One trial per case does not establish population-level superiority. It is a complete, frozen 15-case result under the competition deadline; repeated trials are the first follow-up experiment.

## Evidence

- [Frozen final summary](../artifacts/evaluation/final-v3/summary.json)
- [Frozen final rows](../artifacts/evaluation/final-v3/rows.jsonl)
- [Shell-independent repair pilot](../artifacts/evaluation/live-repair-pilot/summary.json)
- [Disqualified shell-interfered run](../artifacts/evaluation/final-v2/summary.json)
- [Initial underperforming architecture](../artifacts/evaluation/final/summary.json)

