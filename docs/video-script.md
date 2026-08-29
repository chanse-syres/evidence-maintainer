# Five-Minute Demo Script

Target runtime: **4:30-4:50**. Record at 1080p. Keep credentials, account pages, private repositories, and unrelated terminal history off screen.

This script reflects the current evidence state: the V4 engine is implemented, but no valid comparative result has been selected.

## 0:00-0:30 — The maintenance decision

**Screen:** Repository README, then the five dispositions.

**Narration:**

“Public-data maintenance is not simply an update problem. A new observation may be an authoritative fact, an adapter defect, an incomplete fetch, a duplicate, or a real conflict. Evidence Maintainer evaluates whether an agent can choose the right disposition before it changes canonical data: update, repair, retry, do nothing, or request human review.”

## 0:30-1:15 — The comparison

**Screen:** [Architecture diagram](architecture.md), moving from both arms into the shared finalizer.

**Narration:**

“V4 compares two complete workflows. The direct baseline uses one model session to produce a final decision package. The advanced workflow uses three sessions: a Maintainer drafts, a Challenger provides advisory criticism, and a Reviser produces the final package. Both arms receive the same public case bytes and end at the same finalizer. Only the final package is applied, and both arms face the same commands, hidden probes, mutation rules, and semantic evaluator.”

## 1:15-1:55 — What the evaluator measures

**Screen:** [Evaluation contract](evaluation.md), highlighting the six ODI components.

**Narration:**

“The primary metric is Operational Decision Integrity. A run earns it only if the action and action-specific artifact are correct, writes stay inside the permitted surface, required commands and hidden probes pass, source coverage is complete, and the decision is contradiction-free. Exact wording and annotation order are reported separately. They do not decide operational correctness.”

## 1:55-2:35 — One concrete case shape

**Screen:** A credential-free case page showing public observations, authority rules, a final decision package, and deterministic checks. Keep any recorded or historical label visible.

**Narration:**

“Consider a source response in which an entity is absent because the request was filtered. Absence alone does not prove a real-world removal. A sound no-action decision must identify the relevant source and subject, apply the visible authority and time rules, avoid mutation, and state a consistent reason. The evaluator checks the semantics of that outcome rather than requiring one reference sentence.”

## 2:35-3:25 — Why the old result was withdrawn

**Screen:** [`holdout/INVALIDATION-v3.json`](../holdout/INVALIDATION-v3.json), then [`config/public-comparison.json`](../config/public-comparison.json).

**Narration:**

“The repository also records when its own evaluation was wrong. V3 completed all 30 planned workflow slots, but audit found that the baseline received a Challenger result synthesized from hidden oracle data while the advanced arm used a real Challenger that could reject its proposal. Two cases were also semantically invalid. I preserved the freeze, receipts, raw counts, latency, and token use, but withdrew the comparison. The public selector is deliberately empty. There is no valid performance headline yet.”

## 3:25-4:05 — Reproducibility and failure handling

**Screen:** [Reproduction guide](reproduction.md), then run `npm run engine:verify`.

**Narration:**

“The engine gate regenerates schemas, runs lint and the complete test suite, and builds the application without model credentials. Future runs use an exhaustive failure taxonomy. Model execution failures count against the workflow. Infrastructure failures abort aggregation. Evaluator-invalid cases are removed from both arms with a retained receipt. A broken evaluator cannot be silently repaired and rescored under the same version.”

## 4:05-4:40 — What comes next

**Screen:** Return to the README current-status section and V4 requirements.

**Narration:**

“The next experiment is a newly frozen V4 case pack with repeated trials and complete three-session accounting for the advanced arm. The unique case remains the statistical unit, and latency and tokens are first-class results because this is not a compute-matched comparison. Evidence Maintainer is ready to measure the question. It is not claiming an answer before the evidence exists.”

## Recording checklist

- Show the exact repository commit and a clean intended release tree.
- Keep `recorded`, `historical`, and `invalidated` labels visible whenever those artifacts appear.
- Do not quote V1-V3 arm rates as performance.
- State plainly that no live V4 comparison has run.
- Show the empty public comparison selector.
- Verify audio, readable text, and the absence of notifications or private content before upload.
