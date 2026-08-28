# Evidence Maintainer

**Safe autonomous maintenance for live public-data products**

Status: Design specification for user review  
Competition: micro1 Frontier Engineering Challenge 2026  
Primary objective: First place / 100-point submission  
Implementation window: August 28-31, 2026  

## 1. Decision Summary

Evidence Maintainer is an agentic workflow for teams that operate public-data products whose inputs change continuously. It observes new source evidence, determines what kind of event occurred, chooses the safest action, verifies that action in an isolated workspace, and presents a publishable evidence packet for human approval.

The system must distinguish five materially different outcomes:

1. `UPDATE_DATA` - reality changed and the canonical dataset should change.
2. `REPAIR_ADAPTER` - the source interface changed but the underlying fact did not.
3. `RETRY_LATER` - the source is temporarily unavailable or incomplete.
4. `NO_ACTION` - the observation is expected, stale, duplicate, or non-authoritative.
5. `HUMAN_REVIEW` - evidence conflicts or the consequences exceed automatic authority.

The flagship demonstration uses a frozen, submission-safe version of the Beaver Front Office recruiting and roster-maintenance workflow. The product itself is domain-portable: its contracts describe sources, entities, observations, policies, actions, and verification evidence rather than Oregon State-specific objects.

## 2. Why This Project Can Win

Most hackathon agent projects begin with a prompt and end with a generated artifact. Evidence Maintainer begins with a production bottleneck and ends with a controlled operational decision that another person can reproduce.

It has four defensible advantages:

- A real intended user: the maintainer of a continuously changing public-data product.
- A real operating history: source adapters, audit results, review queues, maintenance logs, and production verification.
- A nontrivial agent decision: deciding whether to change data, repair code, defer, abstain, or escalate.
- A clean experiment: compare a direct agent baseline against an evidence-first workflow on the same fixed case suite.

The project is not a generic scraper, generic RAG application, generic coding agent, or generic multi-agent dashboard.

## 3. User and Bottleneck

### 3.1 Intended user

The primary user is a developer, analyst, or small operations team responsible for a public-facing data product assembled from multiple external sources.

Representative products include:

- recruiting and roster dashboards;
- public research trackers;
- pricing or availability monitors;
- civic-data applications;
- grant, regulation, or policy trackers;
- market or competitor intelligence products.

### 3.2 Current workflow

The maintainer periodically fetches external sources, compares them with a canonical dataset, investigates discrepancies, repairs broken adapters, updates records, runs contract tests, reviews diffs, and publishes.

The difficult part is not fetching more data. It is deciding what an observation means.

A missing row might mean that a person left a roster, that the source is incomplete, that pagination changed, that an entity was renamed, or that a request was blocked. A newer page may contain older-effective information. Two correct sources can disagree because they describe different points in time. A successful HTTP response can still contain the wrong document.

### 3.3 User harm

A naive automated maintainer can silently:

- delete valid records;
- merge distinct identities;
- revive stale facts;
- overwrite authoritative data with a popular but weaker source;
- patch production code in response to an infrastructure event;
- publish a change that passes one check while violating another contract.

Manual review avoids some of this harm but does not scale and is difficult to reproduce.

## 4. Product Promise

Given a canonical snapshot, source observations, maintenance policy, and repository workspace, Evidence Maintainer will produce:

- a classified maintenance decision;
- an evidence-linked explanation;
- a proposed data or code diff when appropriate;
- independent verification results;
- an explicit confidence and residual-risk statement;
- a human approval checkpoint before consequential application;
- an immutable run bundle sufficient to reproduce the decision.

The product never claims that a model-generated explanation is proof. Proof consists of source locators, hashes, timestamps, diffs, deterministic checks, and execution results.

## 5. Scope

### 5.1 Required for submission

- Standalone local application and CLI.
- Frozen public or synthetic case pack with at least 12 cases.
- Direct-agent baseline.
- Advanced evidence-first agent workflow.
- Codex CLI adapter with JSONL trajectory capture.
- Deterministic offline demo mode for judges without credentials.
- Interactive control-room view of runs, evidence, decisions, diffs, and verification.
- Human approval simulation for all writes.
- Reproducible evaluation producing machine-readable and HTML reports.
- Improvement changelog tied to actual experimental results.
- Up-to-five-minute demonstration video.

### 5.2 Explicit non-goals

- Unattended mutation of the live Beaver Front Office repository.
- General web-scale fact checking.
- Proving that any external source is universally truthful.
- Training or fine-tuning a new model.
- Supporting every agent provider during the competition.
- Building a large multi-agent swarm.
- Releasing private Handshake task bytes, credentials, private account data, or proprietary trajectories.

## 6. System Architecture

The advanced workflow uses two agent roles and deterministic tooling.

### 6.1 Observation and deterministic evidence layer

The evidence layer loads a frozen case workspace and records:

- canonical snapshot and hash;
- source observations and capture times;
- source authority tier and scope;
- entity identifiers and historical aliases;
- response status, content type, and schema fingerprint;
- repository commit and allowed mutation surface;
- policy and invariant definitions;
- baseline tests and expected outputs.

It normalizes these records into an append-only evidence ledger. Raw evidence remains immutable. Derived conclusions refer to ledger identifiers.

### 6.2 Maintainer agent

The Maintainer receives the goal, normalized evidence, policies, relevant repository context, and deterministic tool results. It must return a structured proposal containing:

- selected action;
- first material divergence;
- failure owner;
- evidence used and evidence rejected;
- affected entities and files;
- proposed mutation or retry condition;
- preserved invariants;
- unresolved uncertainty;
- requested approval level.

For `REPAIR_ADAPTER`, the Maintainer may invoke a coding-agent workspace to implement a bounded repair against frozen source fixtures.

### 6.3 Challenger agent

The Challenger is independent of the Maintainer's hidden reasoning. It receives the proposal, declared evidence, policy, diff, and deterministic results. It attempts to falsify the proposal by searching for:

- stronger conflicting evidence;
- stale or future-dated authority;
- identity collisions;
- incorrect action class;
- violations of preserved behavior;
- overfitting to one fixture;
- unsupported claims;
- changes outside the allowed mutation surface.

It returns `CONFIRM`, `REJECT`, or `ESCALATE`, with evidence-linked reasons.

### 6.4 Deterministic verification gate

The gate, not an LLM judge, determines whether an action may be presented for approval. It verifies:

- JSON schema and output completeness;
- source and artifact hashes;
- allowed-file policy;
- canonical data contracts;
- scenario-specific invariants;
- before/after regression tests;
- clean-workspace reproducibility;
- correspondence between claimed and executed commands;
- absence of live writes in submission mode.

### 6.5 Human approval checkpoint

The control room presents the evidence, decision, diff, challenger result, checks, uncertainty, and recommended next step. The user may approve, reject, or request review. Approval applies only to the isolated case workspace in the competition build.

### 6.6 Run bundle

Each run produces a content-addressed directory containing:

- `manifest.json`;
- `evidence.jsonl`;
- `maintainer-proposal.json`;
- `challenger-verdict.json`;
- `before/` and `after/` hashes;
- `patch.diff` or proposed data diff;
- deterministic check outputs;
- `trajectory.jsonl` for every live agent invocation;
- `decision-report.html`;
- cost and timing summary.

## 7. Action Contract

Every case has one adjudicated action class and one required result contract.

### `UPDATE_DATA`

Required result: the exact canonical record change, evidence lineage, schema-valid dataset, and zero unrelated modifications.

### `REPAIR_ADAPTER`

Required result: a code patch that restores extraction on all relevant fixtures, preserves previous fixtures, and changes no canonical facts directly.

### `RETRY_LATER`

Required result: no repository mutation, a bounded retry condition, and evidence that the observation is temporarily non-diagnostic.

### `NO_ACTION`

Required result: no repository mutation and a precise explanation of why the observation does not justify a change.

### `HUMAN_REVIEW`

Required result: no automatic mutation, explicit conflicting evidence, the unresolved decision, and the smallest information request that would resolve it.

## 8. Evaluation Case Pack

The minimum release suite contains 15 frozen cases across five action classes. Each case includes a canonical snapshot, one or more source observations, repository fixture, policy, hidden adjudication file, and deterministic verifier.

### 8.1 Data-update cases

1. Official commitment announcement supersedes an older recruiting-board status.
2. Confirmed transfer destination updates an unresolved outbound record.
3. Correct rating change arrives from the scoped authoritative source.

### 8.2 Adapter-repair cases

4. CSS selector drift returns an empty list while the content still exists.
5. Embedded JSON changes nesting but preserves semantic fields.
6. Pagination changes and a naive repair reads only the first page.

### 8.3 Retry cases

7. Expected access deferral such as a controlled 406 response.
8. Temporary timeout with a valid recent cache and no contradictory evidence.
9. Partial document response whose schema fingerprint is incomplete.

### 8.4 No-action cases

10. Duplicate news reporting restates an already-recorded event.
11. Newer publication date contains information effective before the canonical cutoff.
12. Apparent removal is caused by a source filter rather than a real-world departure.

### 8.5 Human-review cases

13. Official roster and transfer reporting conflict at the same cutoff.
14. Two athletes share a normalized name and one source omits stable identifiers.
15. A dropped and later reintroduced record reuses a display name but may represent a different entity occurrence.

At least one case must combine multiple mechanisms so that every local observation appears plausible while the global decision differs.

## 9. Baseline

The baseline is intentionally reasonable, not intentionally weak.

It receives the same case workspace, agent model, top-level objective, maximum wall-clock budget, and output schema. It uses one direct prompt and basic repository tools. It may inspect files, run tests, and propose a change. It does not receive the advanced evidence ledger, explicit action routing, independent challenger, or preservation gate.

Resource differences must be reported. The evaluation will include tokens, wall-clock time, and estimated cost so improved reliability is not presented as free.

## 10. Primary Metric

The primary metric is **Safe Decision Rate (SDR)**.

A case scores 1 only when all of the following are true:

1. The selected action class matches the adjudicated action.
2. The required artifact for that action is correct.
3. No forbidden or unrelated mutation occurs.
4. All preservation and regression checks pass.
5. The final claim is supported by the submitted evidence.

Otherwise the case scores 0.

`SDR = fully safe and correct cases / total evaluated cases`

This deliberately prevents a patch from receiving credit merely because one visible test turned green.

## 11. Supporting Metrics

- Unsafe Mutation Rate.
- Action Classification Accuracy.
- Regression-Free Artifact Rate.
- Evidence Citation Precision and Recall.
- Unsupported Success Claim Rate.
- Correct Abstention Rate.
- Human Review Load.
- Median wall-clock time.
- Median token use and estimated cost.
- Run-to-run consistency across repeated trials.

The target outcome is:

- advanced SDR at least 0.85;
- baseline SDR at most 0.55 on the same cases;
- zero unsafe mutations in the advanced system;
- at least a 30-percentage-point absolute SDR improvement;
- complete reproduction from a clean environment.

## 12. Experimental Design

### 12.1 Fixed comparison

- Use at least 12 final cases, targeting all 15.
- Run baseline and advanced workflow on identical case versions.
- Use three independent trials per case when compute and deadline permit.
- Pin model name, Codex CLI version, prompts, repository commit, seed where supported, and case hashes.
- Preserve every result, including failures and timeouts.
- Compute confidence intervals for aggregate rates when repeated trials are available.

### 12.2 Holdout discipline

Case contracts and public fixtures are visible to the workflow. Expected actions and exact adjudication logic remain outside the agent-visible workspace. Development uses a training subset; final metrics are reported on a frozen holdout subset that is not edited after the final prompts are frozen.

### 12.3 Required challenging case

The flagship difficult case combines a plausible source disappearance, an expected deferred adapter response, a same-name identity collision, and a newer-but-stale article. A latest-source-wins baseline should make a harmful deletion. Evidence Maintainer should choose `HUMAN_REVIEW` or `NO_ACTION`, identify the missing decisive evidence, and leave the canonical dataset untouched.

## 13. Improvement Changelog Plan

The changelog must reflect real measurements. The expected experimental sequence is:

1. Direct-agent baseline.
2. Add action classification.
3. Add immutable evidence ledger and source authority.
4. Add temporal and identity history.
5. Add deterministic preservation gate.
6. Add independent Challenger.
7. Test a larger multi-agent decomposition.
8. Remove that decomposition if it increases duplication, conflict, latency, or cost.
9. Add evidence-backed abstention and minimum-information escalation.
10. Freeze the final architecture and run the holdout evaluation.

No stage may be reported as an improvement without evidence from the same evaluation method.

## 14. Interface Design

The local control room has five principal surfaces:

### 14.1 Overview

Shows baseline versus advanced SDR, unsafe mutations, correct abstentions, time, cost, and case status.

### 14.2 Case inbox

Lists observed incidents with source status, proposed action, confidence, and approval state.

### 14.3 Evidence timeline

Displays source observations in event time and publication time, with authority tier, hashes, entity binding, and conflicts.

### 14.4 Decision and diff

Displays the Maintainer proposal, Challenger verdict, proposed patch or data diff, preserved invariants, and deterministic checks.

### 14.5 Approval and proof

Allows simulated approve/reject/escalate action and downloads the immutable run bundle and standalone decision report.

The UI must label observed, inferred, and unresolved statements distinctly. It must never display deterministic replay, offline demo output, or model fallback as a live model result.

## 15. Technology Direction

- TypeScript runtime for the engine and case tooling.
- Local web control room using the smallest practical React/Next.js surface.
- Codex CLI 0.150-compatible adapter using `codex exec --json` and structured output schemas.
- Provider-neutral agent interface so deterministic fixtures can replace live model calls.
- Node test runner for unit, contract, case-verifier, and end-to-end tests.
- Dockerfile for clean reproduction where time permits; native `npm ci` path remains mandatory.
- JSON and JSONL for all evidence, decisions, trajectories, and evaluation outputs.

## 16. Trust and Safety Boundaries

- Competition mode is sandbox-only and never writes to live systems.
- Network is optional; the complete judging path runs on frozen fixtures.
- Raw source evidence is immutable.
- Agent proposals cannot write directly to canonical artifacts.
- Application requires deterministic gate success and simulated human approval.
- Credentials and private identifiers are excluded from the repository and video.
- Dynamo knowledge may shape taxonomies and synthetic cases, but confidential task bytes and private trajectories are not submitted.
- All third-party data included in the case pack must be public, synthetic, or expressly approved and must retain attribution where required.

### 16.1 Submission provenance

The submission must distinguish competition work from pre-existing assets. Beaver Front Office, its historical maintainer, and its public-data operating history existed before the competition. The standalone Evidence Maintainer engine, normalized case contract, two-role agent workflow, comparison harness, control room, evaluation suite, reports, and competition documentation are the new work being judged.

Every included fixture must have a provenance entry describing its source class, capture date, transformation or anonymization, license or permission basis, and integrity hash. The public submission must not imply that pre-existing production outcomes were created during the hackathon.

## 17. Reproduction Contract

A judge starting from a clean environment must be able to run:

1. dependency installation;
2. full automated tests;
3. one deterministic offline demonstration;
4. baseline evaluation;
5. advanced evaluation;
6. report generation;
7. local control room.

The README will provide exact commands, expected outputs, versions, approximate runtime, and optional live-agent configuration. A golden deterministic result will remain available when the judge does not possess an API account.

Offline mode will replay previously captured, hash-identified competition runs and deterministic tool responses. It must label those results as recorded evidence rather than presenting them as fresh agent execution.

The final archive must include representative **agent trajectories for every agent used**, covering the initial instruction, tool requests and responses, feedback, retries, human checkpoints, final structured result, runtime, token use where available, and outcome. A trajectory index will map each submitted run to its model, case, role, artifact hashes, and evaluation result.

## 18. Five-Minute Video Story

### 0:00-0:35 - The user problem

Show Beaver Front Office and explain why changing public sources make automatic maintenance dangerous.

### 0:35-1:15 - Baseline failure

Run a plausible latest-source/direct-agent workflow that confidently proposes a harmful deletion or irrelevant adapter patch.

### 1:15-3:10 - Evidence Maintainer execution

Show the same case moving through evidence normalization, action classification, proposal, challenge, deterministic verification, and approval.

### 3:10-4:05 - User-grade result

Show the evidence timeline, no-harm decision or verified diff, and downloadable proof report.

### 4:05-4:40 - Measured improvement

Show the complete baseline-versus-advanced evaluation, not a selected anecdote.

### 4:40-5:00 - Changelog and hot take

Explain the most valuable change, one removed experiment, and the final insight.

## 19. Hot Take

**The safest autonomous maintainer is not the one that changes the most data. It is the one that can prove when a new observation is not yet a new fact.**

Supporting lesson:

Adding more agents is not automatically an improvement. Reliability came from separating proposal from challenge, grounding both in immutable evidence, and making abstention a first-class successful outcome.

## 20. Three-Day Delivery Plan

### Day 1 - Product spine and baseline

- Freeze project scope and schemas.
- Build case format, evidence ledger, action contract, deterministic gate, and report model.
- Implement direct-agent baseline and offline runner.
- Build six representative cases and establish baseline results.
- Create the first control-room surfaces.

### Day 2 - Advanced workflow and evaluation

- Implement Maintainer and Challenger adapters.
- Implement bounded adapter-repair workspace.
- Complete at least 12 cases, targeting 15.
- Run iterative experiments and maintain the evidence-backed changelog.
- Complete the user-grade decision report and approval flow.

### Day 3 - Freeze, reproduce, and submit

- Freeze prompts, schemas, cases, and holdout hashes.
- Run final baseline and advanced trials.
- Verify from a clean environment.
- Finalize README, reproduction guide, changelog, trajectory index, and results.
- Record the five-minute video.
- Audit the submission against every rubric line and package the final archive.

## 21. 100-Point Acceptance Matrix

### Problem and User Value - 15/15 target

- Clearly named maintainer persona.
- Production-derived bottleneck and concrete harms.
- Demonstrable value in saved review time and prevented unsafe updates.

### Agent Solution and Engineering - 30/30 target

- Agent use is necessary for evidence interpretation and bounded code repair.
- Roles have non-overlapping responsibilities.
- Deterministic gates constrain agent authority.
- Every design choice is tied to an observed failure or experiment.

### End-to-End Quality - 20/20 target

- One realistic case completes from evidence intake through approval and proof report.
- Output is polished enough for a real maintainer to use.
- Offline mode is explicitly labeled and fully functional.

### Measured Improvement - 15/15 target

- Fair baseline and advanced comparison.
- At least 12 cases and complete results.
- Every changelog entry has evidence and a decision.
- One removed experiment is shown honestly.

### Reproducibility - 15/15 target

- Clean-install instructions and exact commands.
- Frozen fixtures and versioned case hashes.
- Machine-readable output and deterministic demo.
- Runtime and cost disclosed.

### Hot Take and Insights - 5/5 target

- Insight arises from a demonstrated failure mode.
- Practical consequence for future agent design is explicit.

## 22. Stop Conditions

The project must be narrowed rather than expanded if any of the following occur:

- the complete offline path cannot be reproduced by the end of Day 1;
- adapter repair consumes time needed for the core decision workflow;
- the evaluation lacks adjudicated cases;
- the interface hides rather than clarifies evidence;
- live integration creates credential or availability risk;
- a new feature cannot improve a scored rubric item.

The protected core is: fixed cases, fair baseline, safe action routing, evidence-linked proposal, independent challenge, deterministic gate, approval, proof report, and measured improvement.
