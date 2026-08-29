# Five-Minute Demo Script

Target runtime: **4:45**. Record at 1080p. Keep the repository commit visible at the start, use the local application only, and never show credentials, account pages, private repositories, or terminal history outside this project.

## 0:00-0:25 — Problem and thesis

**Screen:** Repository README, title and hot take.

**Narration:**

“Public-data maintainers face a harder problem than applying updates. They must decide whether a new observation is an authoritative new fact, an adapter failure, a transient fetch, a duplicate, or a genuine conflict. A plausible wrong write can silently corrupt every downstream consumer. My project is Evidence Maintainer, and its thesis is simple: the safest autonomous maintainer is not the one that changes the most data. It is the one that can prove when a new observation is not yet a new fact.”

## 0:25-1:05 — Architecture

**Screen:** [Architecture diagram](architecture.md), then the application overview.

**Narration:**

“I compare two workflows on identical immutable case bytes. The direct baseline makes one schema-bound decision. The advanced workflow separates responsibilities: a Maintainer builds an evidence ledger and proposes one exact disposition; an independent Challenger tries to falsify authority, identity, temporal, regression, and approval claims; then a deterministic gate executes only inside a copied workspace, checks the hidden oracle, tree diff, regressions, evidence, and forbidden-write boundary. No agent can write to a live system, and the oracle is loaded only after model execution.”

## 1:05-1:45 — The task format

**Screen:** Open the `noop-filtered-removal` case page. Highlight the `recorded` mode label, action vocabulary, public observations, and evidence IDs.

**Narration:**

“The benchmark has 15 cases covering data updates, adapter repairs, transient retries, no-action decisions, and human escalation. Every public workspace file is provenance hashed. The agent must choose among five observable actions and support its claims with exact evidence IDs. Correct classification alone does not earn a Safe Decision. The artifact, mutation surface, regressions, and evidence must also be correct.”

## 1:45-2:25 — Concrete baseline failure

**Screen:** Baseline result for `noop-filtered-removal`, then the advanced report for the same case.

**Narration:**

“Here the source response is filtered, so an absent entity is not evidence of removal. In the frozen live run, the baseline chose the right high-level action, `NO_ACTION`, but failed to cite the evidence needed to support that conclusion. The advanced Maintainer grounded the same decision correctly, and the Challenger confirmed it. This distinction matters in production: a fluent explanation is not an evidence-backed maintenance decision.”

## 2:25-3:05 — Repair and conservative blocking

**Screen:** Show `repair-json-nesting`, its changed file and passing regression gate. Then show `update-transfer-destination` and the Challenger rejection.

**Narration:**

“The system also performs real isolated repairs. In this JSON-nesting case, it changes only the declared adapter, runs the regression command, and preserves the canonical data boundary. It is intentionally conservative. On one correct transfer update, the Maintainer declared an incomplete approval level. The Challenger rejected it, so the gate withheld simulated approval. I did not hide that result: primary Safe Decision Rate is 15 of 15, while approval-eligible completion is 14 of 15.”

## 3:05-3:50 — Measured improvement

**Screen:** Evaluation table in the README, then [frozen summary](../artifacts/evaluation/final-v3/summary.json).

**Narration:**

“The definitive comparison used `gpt-5.6-terra`, one trial on all 15 frozen cases, the same timeout, schemas, and agent-visible bytes. Safe Decision Rate improved from 12 of 15, or 80 percent, to 15 of 15, or 100 percent: plus 20 percentage points. Correct abstention improved by 20 points. Both arms made zero forbidden mutations and had zero execution errors. The reliability is not free: the Challenger increased total tokens by 72.7 percent and median time from 11.8 to 20.6 seconds. Those costs are reported directly.”

## 3:50-4:20 — Trajectories and reproducibility

**Screen:** [Trajectory index](trajectory-index.md), a raw JSONL trajectory, then terminal running `npm run demo` and `npm run submission:verify`.

**Narration:**

“The repository includes 45 raw live trajectories: 15 baseline, 15 Maintainer, and 15 Challenger sessions, plus structured outputs, prompt and schema hashes, token usage, gate results, and approvals. A credential-free recorded mode reproduces the complete harness. The submission verifier recalculates every case provenance hash, run artifact hash, report hash, documentation link, and trajectory count and rejects dirty or credential-bearing packages.”

## 4:20-4:45 — Close

**Screen:** Return to the overview and hot take.

**Narration:**

“Evidence Maintainer turns autonomous maintenance from ‘did the agent write something plausible?’ into ‘can it prove the safest correct disposition?’ The result is a measurable 20-point reliability gain, an auditable failure boundary, and a benchmark that rewards restraint as rigorously as action. That is the kind of autonomy I would trust with public data.”

## Recording checklist

- Show the final commit and a clean repository state.
- Keep the `recorded` label visible whenever the credential-free demo is shown.
- State that the frozen metrics come from the retained `live` bundle.
- Show the 14/15 approval-eligible nuance; do not imply the Challenger accepted every proposal.
- Keep total runtime under five minutes.
- Verify audio, readable text, and no notifications or private content before upload.
