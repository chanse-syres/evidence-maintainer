# V4 Symmetric Evaluation Design

## Status

Approved design direction. Implementation has not started.

## Why V4 is required

The v1 and v2 campaigns treated exact field-level evidence annotations as a safety result. Manual review showed that the check rejected semantically valid alternatives, so those campaigns were invalidated for comparative system claims.

V3 separated operational correctness from exact annotation alignment and ran a frozen five-case holdout three times per arm. The artifacts are mechanically intact, but semantic audit found two additional defects:

1. The direct baseline received a Challenger verdict synthesized from the hidden oracle, while the advanced arm received a real model-generated Challenger that could veto its proposal. Approval, review-readiness, and human-touch measures were therefore not comparable across arms.
2. Two holdout cases were unsound. One retry oracle required future agreement checks against an immutable stale observation. One update case relied on tariff evidence outside its stated freshness window and did not bind the account to the tariff class.

V3 remains evaluator-validation evidence. It is not a valid baseline-versus-advanced performance result.

## Research question

Does a bounded propose-challenge-revise workflow improve the correctness of final maintenance decisions over a direct single-agent workflow when both receive identical case bytes and are scored by the same external deterministic evaluator?

The experiment must be able to return a negative result. No release text, chart, or interface may assume that the advanced workflow wins.

## Goals

- Compare two workflows under one final output contract and one evaluator.
- Measure operational outcomes rather than conformity to one explanation.
- Preserve source provenance, sandbox isolation, write-surface enforcement, and regression execution.
- Represent future retry conditions without binding them to observations that do not yet exist.
- Make source freshness and effective-dated authority explicit.
- Freeze and run a new holdout without inspecting intermediate outcomes.
- Publish invalidations, unfavorable results, uncertainty, latency, and token use.

## Non-goals

- Proving production safety from synthetic cases.
- Using an LLM judge as the primary grader.
- Claiming population generalization from ten cases.
- Tuning prompts or case bytes after any v4 model output is observed.
- Preserving the previous marketing narrative.

## Compared workflows

### Direct baseline

The baseline receives the frozen agent-visible snapshot and emits one final `DecisionPackage`. It does not receive hidden oracle data, a synthetic Challenger result, or feedback from the evaluator.

### Propose-challenge-revise workflow

The advanced arm receives the same frozen snapshot.

1. A Maintainer emits a draft `DecisionPackage`.
2. A Challenger receives the public case bytes and draft, then emits an advisory critique.
3. A revision step receives the same public bytes, the draft, and the critique, then emits the final `DecisionPackage`.

The Challenger is part of the advanced method, not part of its grader. A rejection does not automatically fail the run. Only the revised final package is scored.

### Shared final contract

Both arms submit the same schema. The package contains:

- one action from `UPDATE_DATA`, `REPAIR_ADAPTER`, `RETRY_LATER`, `NO_ACTION`, or `HUMAN_REVIEW`;
- source-linked evidence assessments;
- declared operations and affected files;
- preserved invariants and unresolved uncertainty;
- an action-specific artifact: mutations, retry conditions, or review request.

Role-specific process artifacts remain available for analysis, but they cannot change the external score.

## Shared evaluator

The same evaluator bytes score both final packages after model execution. It never receives or constructs an arm-specific Challenger verdict.

The primary result, Operational Decision Integrity (ODI), requires:

1. correct action;
2. semantically correct action-specific artifact or abstention;
3. no forbidden write;
4. passing required commands and hidden probes;
5. coverage of required source evidence with no contradictory citation.

Exact field/disposition annotation agreement remains a nonblocking diagnostic. It is not part of ODI.

### Semantic action artifacts

The verifier uses explicit predicates rather than equality with one serialized oracle object.

- Data updates are checked against the required final record properties and preserved fields.
- Adapter repairs are checked through allowed paths, public tests, and evaluator-only probes.
- No-action decisions require no mutation and the required authority/temporal justification sources.
- Human-review requests must request the missing decision-bearing facts; wording and ordering are not graded.
- Retry plans must express timing, bounded attempts, preservation requirements, and future acceptance conditions.

Harmless supersets are allowed. Unknown evidence, contradictory conditions, forbidden writes, missing required properties, and conditions that can never become true are rejected.

### Future retry selectors

Retry conditions must not refer only to current observation IDs. A future condition identifies the expected observation semantically:

- `sourceId`;
- `subjectId`;
- optional `kind`;
- `factPath`;
- comparison operator;
- expected value.

Existing evidence IDs may explain why a retry is necessary, but future acceptance conditions use selectors that a later observation can satisfy.

### Authority validity

Each policy declares validity by source or field:

- `SNAPSHOT_MAX_AGE`: the observation must fall within a stated age;
- `EFFECTIVE_UNTIL_SUPERSEDED`: a signed effective-dated entry remains authoritative until a later applicable entry supersedes it;
- `EVENT_AT_CUTOFF`: authority is determined at the declared event or cutoff.

No generic freshness window may silently override an effective-dated register. Cross-subject authority requires an explicit binding in agent-visible evidence.

## Holdout design

### Size and balance

V4 contains ten unique cases, two per action class. Each case runs three times per arm with `gpt-5.6-terra` under the same timeout and runtime image.

The unique case is the statistical unit. Repeated trials measure stochastic stability and remain nested under their case in resampling.

### Construction order

1. Freeze prompts, schemas, evaluator code, runtime image, and measurement code.
2. Author ten new cases that do not reuse v1-v3 identifiers, values, or serialized artifacts.
3. Run deterministic reference, no-op, malformed-output, and action-specific controls.
4. Perform semantic preflight review without running the target model.
5. Freeze case bytes and the complete execution lock.
6. Execute all baseline and advanced workflows without inspecting intermediate results.
7. Audit every nonpass after all workflows finish.

### Case quality requirements

Every case must have:

- one fully determined action under the public contract;
- enough agent-visible evidence to reach that action;
- explicit authority, time, identity, and applicability rules;
- at least one plausible but incorrect decision path;
- a semantic reference control;
- action-specific negative controls;
- no clause-to-function or test-inventory recipe in agent-facing text.

Adapter cases require evaluator-only probes covering both expected behavior and malformed boundary conditions. Retry cases require at least one satisfiable future observation fixture and one near-miss fixture. Update cases require an explicit subject/applicability chain.

## Failure taxonomy and invalidation

- `MODEL_EXECUTION`: a model session fails to return a valid package within the frozen budget. It counts against that workflow.
- `INFRASTRUCTURE`: the model service, container, proxy, or runner fails independently of the candidate. The exact frozen run slot may be retried with a recorded receipt before results are inspected.
- `EVALUATOR_INVALID`: the task or grader is ambiguous, contradictory, impossible, asymmetric, or incorrect. The case is excluded from both arms. Its bytes and receipt remain frozen.
- `GENUINE_SEMANTIC_FAILURE`: a valid final package fails a sound shared predicate.

No task or evaluator defect may be repaired in place and silently rescored. Any corrected case belongs to a new version and requires a new freeze.

## Metrics and reporting

Primary:

- ODI by arm, reported as successes over total repeated workflows;
- per-case stability across three trials;
- paired nested-case bootstrap interval for the arm difference.

Secondary:

- action accuracy;
- action-specific artifact accuracy;
- source coverage and contradiction rate;
- forbidden mutation rate;
- required-command and hidden-probe pass rate;
- median and distribution of latency;
- measured input, cached-input, output, and total tokens.

Diagnostic only:

- exact annotation alignment;
- Challenger confirmation rate;
- revision acceptance rate;
- critique categories.

Approval and estimated-human-touch metrics are removed from the arm comparison unless both arms later receive the same external review process.

## Isolation and provenance

- Candidate execution remains in an unprivileged Docker container with network disabled, a read-only source mount, and a writable copied workspace.
- The model credential remains outside the candidate container behind the existing restricted gateway.
- Hidden oracle and probe bytes are loaded only by the host evaluator after model execution.
- The freeze binds the model, timeout, prompts, schemas, evaluator, runtime image, case tree, package lock, and measurement code.
- Run manifests bind role trajectories, structured outputs, token accounting, runtime image, and artifact hashes.

## Testing strategy

Implementation follows test-first development.

Required tests include:

- both arms are accepted by the same `DecisionPackage` schema;
- the baseline path cannot create or consume a Challenger verdict;
- internal Challenger output cannot directly change the external score;
- revision changes only the advanced final package;
- semantically equivalent plans with reordered or additional harmless checks score equally;
- contradictory or impossible retry selectors fail;
- future selector fixtures distinguish a satisfying observation from near misses;
- source validity modes behave differently and deterministically;
- subject/applicability gaps fail updates;
- generator output is byte-for-byte reproducible;
- freeze verification rejects any changed bound input;
- all 60 expected run slots reconcile with manifests and rows;
- release verification fails on secrets, absolute local paths, stale claims, missing evidence, or a dirty tree.

## Public repository and presentation

The public repository is rebuilt only after the v4 audit.

It will lead with the research question, contract, outcome, evaluator corrections, and limitations. It will not contain a giant delta card, “hot take,” simulated-signature language, invented precision, or claims of superiority unsupported by v4.

Internal implementation plans, agent-control files, rubric-gaming notes, stale campaigns, and bulk generated artifacts are excluded from the public head. Canonical results remain tracked; complete raw bundles become checksummed release assets.

The video is rewritten after the result is known. It must show the result that occurred, including a negative result or invalidation.

## Acceptance criteria

Implementation is ready for the v4 run only when:

- both arms emit the same final schema;
- one shared evaluator scores both arms;
- no synthesized baseline Challenger exists;
- retry selectors can describe satisfiable future evidence;
- source validity and cross-subject applicability are explicit;
- ten cases pass deterministic and semantic preflight;
- the execution lock is frozen before any target-model run;
- the repository test, lint, build, Docker, and package checks pass.

The public release is ready only when every nonpass is audited, all invalid cases are disclosed symmetrically, the narrative matches the retained evidence, and a clean clone reproduces the credential-free verification path.
