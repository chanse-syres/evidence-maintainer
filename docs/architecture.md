# Architecture and Trust Boundaries

## Objective

Evidence Maintainer evaluates whether an agent can turn uncertain public observations into a correct maintenance disposition. The five actions are `UPDATE_DATA`, `REPAIR_ADAPTER`, `RETRY_LATER`, `NO_ACTION`, and `HUMAN_REVIEW`.

A correct action label is not sufficient. The final package must also produce the right action-specific artifact, remain inside the allowed write surface, pass required execution checks, cite an admissible evidence bundle, and avoid contradictory claims.

## Compared workflows

```text
Frozen public case bytes
  |
  +--> Direct baseline --> final DecisionPackage -------------------+
  |                                                               |
  +--> Maintainer --> draft --> Challenger --> critique --> Reviser +
                                                                  |
                                                                  v
                                                      finalizeDecision()
                                                        |-- fresh workspace copy
                                                        |-- declared operations only
                                                        |-- public commands
                                                        |-- hidden probes
                                                        |-- shared semantic evaluator
                                                        +-- immutable run evidence
```

### Direct baseline

The direct arm receives the frozen public snapshot and uses one model session to emit a final `DecisionPackage`. It never receives a Challenger artifact or hidden evaluator data.

### Propose-challenge-revise

The advanced arm receives the same public snapshot.

1. The Maintainer emits a draft `DecisionPackage` without mutating the workspace.
2. The Challenger reads the public bytes and draft, then emits an advisory critique.
3. The Reviser reads the same public bytes, draft, and critique, then emits the final `DecisionPackage`.

Only the revised final package reaches execution and scoring. The Challenger is a component of the advanced system, not an arm-specific evaluator. Changing only the critique while holding the final package fixed cannot change the external score.

## Shared finalization boundary

`finalizeDecision()` is the sole post-model execution boundary for both arms. It:

1. loads the public case and evaluator-owned oracle on the host;
2. creates a fresh copied workspace;
3. validates the final package and declared operations;
4. applies only permitted operations;
5. runs required public commands and hidden probes;
6. captures before and after trees plus command evidence;
7. invokes the same semantic evaluator;
8. writes the final package and deterministic evidence.

Neither workflow can provide a pre-mutated workspace or substitute precomputed command results.

## Semantic evaluation

Operational Decision Integrity is the conjunction of six blocking checks:

| Check | Question |
| --- | --- |
| `action-correct` | Is the selected maintenance action semantically correct? |
| `artifact-correct` | Does the action-specific artifact satisfy the public contract? |
| `no-forbidden-mutation` | Did every write remain inside the permitted surface and preserve protected state? |
| `required-commands-passed` | Did public commands and evaluator-owned probes pass? |
| `source-coverage` | Does the decision cite a complete admissible source bundle? |
| `contradiction-free` | Is the package internally consistent and satisfiable? |

`annotation-aligned` is diagnostic only. The evaluator accepts materially equivalent artifacts instead of requiring byte-for-byte equality with one reference serialization.

## Authority and future evidence

Policies express authority using one of three explicit modes:

- `SNAPSHOT_MAX_AGE` for observations whose authority expires after a stated age;
- `EFFECTIVE_UNTIL_SUPERSEDED` for signed or effective-dated entries;
- `EVENT_AT_CUTOFF` for state determined at a declared event boundary.

Cross-subject authority requires an agent-visible applicability binding.

Retry plans identify future evidence with semantic selectors—source, subject, optional kind, fact path, operator, and expected value—rather than requiring a future observation to reuse a current immutable evidence ID.

## Isolation boundaries

| Boundary | Model can read | Model can write | Enforcement |
| --- | --- | --- | --- |
| Public case | Declared case bytes | Nothing | Manifest and provenance loader |
| Draft and critique | Role-appropriate public process artifacts | Structured output only | Role schema |
| Candidate workspace | None before finalization | Declared operations through the finalizer | Operation validation and tree diff |
| Oracle and hidden probes | Nothing | Nothing | Evaluator-owned host load after model execution |
| External services | None required | Never | Offline case design and runner contract |

## Failure ownership

Every selected slot has one disposition:

- `NONE` for a completed ODI pass;
- `GENUINE_SEMANTIC_FAILURE` for a completed package that fails a blocking check;
- `MODEL_EXECUTION` for a model-owned failure to produce a usable completion;
- `INFRASTRUCTURE` for a host or service failure, which aborts aggregation;
- `EVALUATOR_INVALID` for an invalid case or grader, excluded symmetrically from both arms with a retained receipt.

No evaluator defect may be repaired in place and silently rescored. A corrected case requires a new version and freeze.

## Provenance and reporting

Run manifests bind the case, arm, model, timeout, role trajectories, structured outputs, runtime image, artifact hashes, duration, and trustworthy token receipts. The advanced arm requires complete Maintainer, Challenger, and Reviser accounting.

The unique case is the outer statistical unit. Repeated trials remain nested within case so an uneven row count cannot silently reweight the comparison.

The public selector in [`config/public-comparison.json`](../config/public-comparison.json) is the only authority for a headline comparison. It selects the adjudicated V4 attempt-2 summary, whose four included cases are distinct from the one evaluator-invalid case retained in the same campaign record.
