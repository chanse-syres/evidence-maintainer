# Agent Trajectory Index

The definitive live comparison contains **45 raw JSONL trajectories**: 15 direct-baseline sessions, 15 Maintainer sessions, and 15 Challenger sessions. Every final case has one baseline trajectory and two advanced trajectories under `artifacts/evaluation/final-v3/runs/<case>/trial-1/`.

All paths below are repository-relative. Advanced manifest prompt and schema hashes bind the Maintainer and Challenger pair; role-specific source hashes are recorded in [evaluation.md](evaluation.md). Token counts for advanced rows are combined run totals because the manifest is the signed unit of comparison; each raw trajectory also contains its role-specific `turn.completed.usage` record.

| Behavior | Role | Case and arm | Outcome | Duration ms | Run tokens in/out | Prompt SHA-256 | Output schema SHA-256 | Trajectory | Structured result |
| --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- |
| Evidence failure | Baseline | `noop-filtered-removal`, baseline | FAIL | 10,487 | 17,484 / 310 | `ab41a7884f03ff8f07fc3718f16fb4e5953a8f277baa09b84f22ec737f7ba197` | `54b82a2b67419b3b25268c1c93585f598e0e9dcf7a3dfdae7341505f6139869f` | [baseline.jsonl](../artifacts/evaluation/final-v3/runs/noop-filtered-removal/trial-1/baseline/trajectories/baseline.jsonl) | [baseline-result.json](../artifacts/evaluation/final-v3/runs/noop-filtered-removal/trial-1/baseline/baseline-result.json) |
| Correct no-action proposal | Maintainer | `noop-filtered-removal`, advanced | PASS | 20,502 | 36,346 / 556 | `479c8346ae8276bbe133df686274a7d939870f0717d4e7e638510445f29fcb41` | `a18a729f47eb7c4c3bf5061a759033278ab8fe3ae770f06fa79d602fcc2295b9` | [maintainer.jsonl](../artifacts/evaluation/final-v3/runs/noop-filtered-removal/trial-1/advanced/trajectories/maintainer.jsonl) | [maintainer-proposal.json](../artifacts/evaluation/final-v3/runs/noop-filtered-removal/trial-1/advanced/maintainer-proposal.json) |
| No-action confirmation | Challenger | `noop-filtered-removal`, advanced | PASS | 20,502 | 36,346 / 556 | `479c8346ae8276bbe133df686274a7d939870f0717d4e7e638510445f29fcb41` | `a18a729f47eb7c4c3bf5061a759033278ab8fe3ae770f06fa79d602fcc2295b9` | [challenger.jsonl](../artifacts/evaluation/final-v3/runs/noop-filtered-removal/trial-1/advanced/trajectories/challenger.jsonl) | [challenger-verdict.json](../artifacts/evaluation/final-v3/runs/noop-filtered-removal/trial-1/advanced/challenger-verdict.json) |
| Evidence-backed retry | Maintainer | `retry-partial-document`, advanced | PASS | 22,753 | 36,218 / 709 | `9b6880158282519e587270a6d71d8ed4220a53b5fe000fee8720644bc7b44543` | `a18a729f47eb7c4c3bf5061a759033278ab8fe3ae770f06fa79d602fcc2295b9` | [maintainer.jsonl](../artifacts/evaluation/final-v3/runs/retry-partial-document/trial-1/advanced/trajectories/maintainer.jsonl) | [maintainer-proposal.json](../artifacts/evaluation/final-v3/runs/retry-partial-document/trial-1/advanced/maintainer-proposal.json) |
| Adapter repair | Maintainer | `repair-json-nesting`, advanced | PASS | 26,386 | 37,499 / 937 | `a11c16d8f1b760a8ececd06e3ed9bad2b46ed11f07d295f8e7b5a1f8ac9f8563` | `a18a729f47eb7c4c3bf5061a759033278ab8fe3ae770f06fa79d602fcc2295b9` | [maintainer.jsonl](../artifacts/evaluation/final-v3/runs/repair-json-nesting/trial-1/advanced/trajectories/maintainer.jsonl) | [maintainer-proposal.json](../artifacts/evaluation/final-v3/runs/repair-json-nesting/trial-1/advanced/maintainer-proposal.json) |
| Human-review escalation | Maintainer | `review-name-collision`, advanced | PASS | 18,214 | 36,664 / 452 | `21ca4ed08c53c720075cb3d5e7919ff13f4b0a35a90a233ff48aa9ab8cce92d8` | `a18a729f47eb7c4c3bf5061a759033278ab8fe3ae770f06fa79d602fcc2295b9` | [maintainer.jsonl](../artifacts/evaluation/final-v3/runs/review-name-collision/trial-1/advanced/trajectories/maintainer.jsonl) | [maintainer-proposal.json](../artifacts/evaluation/final-v3/runs/review-name-collision/trial-1/advanced/maintainer-proposal.json) |
| Escalation validation | Challenger | `review-name-collision`, advanced | PASS | 18,214 | 36,664 / 452 | `21ca4ed08c53c720075cb3d5e7919ff13f4b0a35a90a233ff48aa9ab8cce92d8` | `a18a729f47eb7c4c3bf5061a759033278ab8fe3ae770f06fa79d602fcc2295b9` | [challenger.jsonl](../artifacts/evaluation/final-v3/runs/review-name-collision/trial-1/advanced/trajectories/challenger.jsonl) | [challenger-verdict.json](../artifacts/evaluation/final-v3/runs/review-name-collision/trial-1/advanced/challenger-verdict.json) |
| Conservative block | Challenger | `update-transfer-destination`, advanced | FAIL | 23,634 | 37,339 / 859 | `d25277a1080e1c033d4e32e189d6c560c412ecf01e701b461d9bde5fe98ba252` | `a18a729f47eb7c4c3bf5061a759033278ab8fe3ae770f06fa79d602fcc2295b9` | [challenger.jsonl](../artifacts/evaluation/final-v3/runs/update-transfer-destination/trial-1/advanced/trajectories/challenger.jsonl) | [challenger-verdict.json](../artifacts/evaluation/final-v3/runs/update-transfer-destination/trial-1/advanced/challenger-verdict.json) |

## Finding any trajectory

For a case named `<case-id>`:

- baseline trajectory: `artifacts/evaluation/final-v3/runs/<case-id>/trial-1/baseline/trajectories/baseline.jsonl`;
- Maintainer trajectory: `artifacts/evaluation/final-v3/runs/<case-id>/trial-1/advanced/trajectories/maintainer.jsonl`;
- Challenger trajectory: `artifacts/evaluation/final-v3/runs/<case-id>/trial-1/advanced/trajectories/challenger.jsonl`;
- hashes, duration, token totals, mode, model, and outcome: adjacent `manifest.json`;
- deterministic disposition: adjacent `gate.json` and `approval.json`.

Recorded-mode trajectories under `artifacts/evaluation/recorded-all/` are explicitly labeled `recorded` and exist for credential-free reproduction. They are not represented as live sessions.

