# Architecture and Trust Boundaries

## Objective

Evidence Maintainer evaluates whether an agent can convert uncertain public observations into a safe maintenance disposition. It is not a generic coding benchmark and it is not a maximally active update bot. The core problem is deciding what kind of event has occurred before choosing whether any mutation is legitimate.

The five valid actions are `UPDATE_DATA`, `REPAIR_ADAPTER`, `RETRY_LATER`, `NO_ACTION`, and `HUMAN_REVIEW`. A correct label alone is insufficient: the resulting artifact, changed-file surface, regression state, and cited evidence must also be correct.

## Data flow

```text
Frozen case directory
  |-- public manifest + provenance hashes
  |-- immutable agent-visible workspace bytes
  |-- evaluator-only oracle
  |
  +--> Direct baseline agent ------------------------------+
  |                                                        |
  +--> Maintainer --> structured proposal --> Challenger --+--> deterministic gate
                                                               |-- action adjudication
                                                               |-- evidence support
                                                               |-- allowed mutation surface
                                                               |-- before/after tree
                                                               |-- regression commands
                                                               +-- simulated approval
                                                                    |
                                                                    +--> immutable run bundle
                                                                         |-- manifest + hashes
                                                                         |-- raw trajectories
                                                                         |-- structured decisions
                                                                         |-- gate and approval
                                                                         +-- rendered report
```

## Components

### Frozen cases

Each directory under [cases](../cases) contains:

- `case.json`, the public manifest, visible file list, policy, and SHA-256 provenance;
- `workspace/`, the only bytes shown to agents and the only candidate workspace copied for execution;
- `oracle.json`, evaluator-only expected behavior loaded after the agent finishes.

The loader rejects absolute paths, path traversal, symlinks, undeclared visible files, duplicate provenance entries, and hash mismatches. The complete frozen case-set hash is derived from the sorted `(caseId, workspaceHash)` pairs.

### Baseline

The direct baseline receives the complete agent-visible snapshot and returns a schema-bound result in one model session. It has the same public evidence, candidate bytes, action vocabulary, hidden oracle, timeout, and downstream deterministic checks as the advanced arm. It does not receive a Challenger.

### Maintainer

The Maintainer must first ground the observation in an append-only evidence ledger, then produce exactly one structured proposal. The proposal declares:

- the intended action and rationale;
- evidence IDs supporting observable claims;
- exact mutations, if any;
- expected changed files;
- regression commands and invariants;
- confidence and required approval level.

This separates reasoning from mutation. No proposed write is applied during the model session.

### Challenger

The Challenger receives the same frozen evidence plus the Maintainer proposal. It cannot edit the candidate. Its job is to seek disconfirming evidence across five failure surfaces: source authority, temporal semantics, identity continuity, regression risk, and process/approval completeness. It returns a structured accept-or-reject verdict with reason codes.

This role is intentionally independent. It can reduce throughput by blocking a correct proposal, as happened once in the final comparison. That cost is reported rather than hidden.

### Mutation engine and deterministic gate

Only declared mutations are applied, and only inside the copied case workspace. The gate then verifies:

1. the proposal and Challenger outputs satisfy their schemas;
2. the adjudicated action matches the hidden oracle;
3. the resulting artifact or abstention is exact;
4. changed files are within the allowed action-specific surface;
5. regression commands complete successfully;
6. required invariants remain true;
7. evidence IDs support the submitted claims;
8. no external or live write occurred.

The simulated approval step is downstream of the gate. It is evidence that the benchmark workflow reached its authorization boundary, not authorization to mutate a production system.

## Isolation boundaries

| Boundary | Agent can read | Agent can write | Enforced by |
| --- | --- | --- | --- |
| Public case | Declared workspace bytes | Nothing | Manifest and provenance loader |
| Candidate run | Copied workspace | Declared candidate files only | Mutation engine and tree diff |
| Oracle | Nothing during execution | Nothing | Evaluator-only load after session |
| Challenger | Evidence and proposal | Structured verdict only | Separate role schema |
| External services | None required | Never | Offline case design and runner contract |
| Approval | Gate result | Simulated record only | Deterministic approval module |

Shell-independent input is a reliability feature, not privileged context. Both arms receive identical immutable file bytes already declared in `case.json`; the actual candidate still executes inside the isolated workspace. This removed host-shell policy as an accidental variable in the final experiment.

## Artifact lineage

Every run bundle has a `manifest.json` that binds case, arm, truth-labeled mode, model, timeout, rendered prompt hash, output schema hash, trajectory paths, artifact hashes, timing, tokens when available, and final outcome. The raw JSONL trajectories remain adjacent to their structured outputs.

The aggregate summary binds the sorted case-set hash and one row per arm and case. The credential-free demo produces HTML reports whose hashes are recorded in its own manifest. The submission verifier independently recalculates case, artifact, report, trajectory, documentation, and repository-integrity checks before release.

## Live versus recorded truth labels

- `live` means a fresh model session was executed and its raw trajectory was retained.
- `recorded` means a deterministic fixture was replayed to prove the harness without credentials or compute.

Recorded results are never presented as live evidence. The UI, manifests, reports, evaluation documentation, and reproduction guide preserve this distinction.

## Why two agents instead of a swarm

The observed failures were evidence and contract failures, not a lack of parallel ideation. A Maintainer and one adversarial Challenger provide non-overlapping responsibilities while keeping causality and cost measurable. A larger swarm was considered but was neither implemented nor measured, so the submission makes no claim that additional agents would improve reliability.
