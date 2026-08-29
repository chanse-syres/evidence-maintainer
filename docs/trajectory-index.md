# Historical Agent Trajectory Index

> **Invalidated development evidence:** The trajectories indexed here use pre-V4 contracts and are not the selected baseline-versus-advanced comparison. Their `PASS` and `FAIL` fields are historical gate outputs, not current performance labels. The selected V4 evidence is under [`artifacts/evaluation/holdout-v4-attempt-2`](../artifacts/evaluation/holdout-v4-attempt-2/summary.json).

The retained `final-v3` development bundle contains 45 raw JSONL trajectories: 15 direct-baseline sessions, 15 Maintainer sessions, and 15 Challenger sessions. The name `final-v3` is historical; it does not mean the campaign is a valid final result.

The subsequent frozen `holdout-v3` campaign is separately excluded by [the V3 invalidation record](../holdout/INVALIDATION-v3.json) because its arms were asymmetric and two cases were semantically invalid. V1 and V2 are excluded by their own versioned records.

All paths below are repository-relative. The table preserves selected raw process receipts so reviewers can inspect the old failure modes and artifact lineage.

| Historical behavior | Role | Case and arm | Legacy gate label | Duration ms | Run tokens in/out | Prompt SHA-256 | Output schema SHA-256 | Trajectory | Structured result |
| --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- |
| Evidence annotation mismatch | Baseline | `noop-filtered-removal`, baseline | `FAIL` | 10,487 | 17,484 / 310 | `ab41a7884f03ff8f07fc3718f16fb4e5953a8f277baa09b84f22ec737f7ba197` | `54b82a2b67419b3b25268c1c93585f598e0e9dcf7a3dfdae7341505f6139869f` | [baseline.jsonl](../artifacts/evaluation/final-v3/runs/noop-filtered-removal/trial-1/baseline/trajectories/baseline.jsonl) | [baseline-result.json](../artifacts/evaluation/final-v3/runs/noop-filtered-removal/trial-1/baseline/baseline-result.json) |
| No-action proposal | Maintainer | `noop-filtered-removal`, advanced | `PASS` | 20,502 | 36,346 / 556 | `479c8346ae8276bbe133df686274a7d939870f0717d4e7e638510445f29fcb41` | `a18a729f47eb7c4c3bf5061a759033278ab8fe3ae770f06fa79d602fcc2295b9` | [maintainer.jsonl](../artifacts/evaluation/final-v3/runs/noop-filtered-removal/trial-1/advanced/trajectories/maintainer.jsonl) | [maintainer-proposal.json](../artifacts/evaluation/final-v3/runs/noop-filtered-removal/trial-1/advanced/maintainer-proposal.json) |
| No-action confirmation | Challenger | `noop-filtered-removal`, advanced | `PASS` | 20,502 | 36,346 / 556 | `479c8346ae8276bbe133df686274a7d939870f0717d4e7e638510445f29fcb41` | `a18a729f47eb7c4c3bf5061a759033278ab8fe3ae770f06fa79d602fcc2295b9` | [challenger.jsonl](../artifacts/evaluation/final-v3/runs/noop-filtered-removal/trial-1/advanced/trajectories/challenger.jsonl) | [challenger-verdict.json](../artifacts/evaluation/final-v3/runs/noop-filtered-removal/trial-1/advanced/challenger-verdict.json) |
| Retry proposal | Maintainer | `retry-partial-document`, advanced | `PASS` | 22,753 | 36,218 / 709 | `9b6880158282519e587270a6d71d8ed4220a53b5fe000fee8720644bc7b44543` | `a18a729f47eb7c4c3bf5061a759033278ab8fe3ae770f06fa79d602fcc2295b9` | [maintainer.jsonl](../artifacts/evaluation/final-v3/runs/retry-partial-document/trial-1/advanced/trajectories/maintainer.jsonl) | [maintainer-proposal.json](../artifacts/evaluation/final-v3/runs/retry-partial-document/trial-1/advanced/maintainer-proposal.json) |
| Adapter repair proposal | Maintainer | `repair-json-nesting`, advanced | `PASS` | 26,386 | 37,499 / 937 | `a11c16d8f1b760a8ececd06e3ed9bad2b46ed11f07d295f8e7b5a1f8ac9f8563` | `a18a729f47eb7c4c3bf5061a759033278ab8fe3ae770f06fa79d602fcc2295b9` | [maintainer.jsonl](../artifacts/evaluation/final-v3/runs/repair-json-nesting/trial-1/advanced/trajectories/maintainer.jsonl) | [maintainer-proposal.json](../artifacts/evaluation/final-v3/runs/repair-json-nesting/trial-1/advanced/maintainer-proposal.json) |
| Human-review proposal | Maintainer | `review-name-collision`, advanced | `PASS` | 18,214 | 36,664 / 452 | `21ca4ed08c53c720075cb3d5e7919ff13f4b0a35a90a233ff48aa9ab8cce92d8` | `a18a729f47eb7c4c3bf5061a759033278ab8fe3ae770f06fa79d602fcc2295b9` | [maintainer.jsonl](../artifacts/evaluation/final-v3/runs/review-name-collision/trial-1/advanced/trajectories/maintainer.jsonl) | [maintainer-proposal.json](../artifacts/evaluation/final-v3/runs/review-name-collision/trial-1/advanced/maintainer-proposal.json) |
| Conservative rejection | Challenger | `update-transfer-destination`, advanced | `FAIL` | 23,634 | 37,339 / 859 | `d25277a1080e1c033d4e32e189d6c560c412ecf01e701b461d9bde5fe98ba252` | `a18a729f47eb7c4c3bf5061a759033278ab8fe3ae770f06fa79d602fcc2295b9` | [challenger.jsonl](../artifacts/evaluation/final-v3/runs/update-transfer-destination/trial-1/advanced/trajectories/challenger.jsonl) | [challenger-verdict.json](../artifacts/evaluation/final-v3/runs/update-transfer-destination/trial-1/advanced/challenger-verdict.json) |

## How to interpret these files

The table can answer historical process questions such as which prompt ran, which schema was bound, how long a session took, and what artifact it emitted. It cannot answer whether propose-challenge-revise outperformed the direct workflow.

Do not reuse the old `challenger-verdict.json`, approval, or exact-annotation gate as V4 evaluation evidence. V4 uses a shared final `DecisionPackage`, an advisory critique, a Reviser session, and one semantic evaluator for both arms.

Recorded-mode trajectories under `artifacts/evaluation/recorded-all/` are credential-free engineering fixtures. They are not live sessions or performance evidence.

## Governing status

- [Public comparison selector](../config/public-comparison.json)
- [Evaluation contract and evidence status](evaluation.md)
- [V1 invalidation](../holdout/INVALIDATION-v1.json)
- [V2 invalidation](../holdout/INVALIDATION-v2.json)
- [V3 invalidation](../holdout/INVALIDATION-v3.json)
