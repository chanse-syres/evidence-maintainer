# V4 Blinded Holdout Campaign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, preaudit, freeze, and run a ten-case v4 holdout with two cases per action and three trials per arm, then audit every nonpass without tuning the frozen experiment.

**Architecture:** The campaign uses two locks. `SYSTEM_FREEZE.json` binds prompts, schemas, evaluator, runner, measurement code, model, timeout, and Docker image before case authoring. `FREEZE.json` then binds the ten audited case trees. A blind-run wrapper verifies both locks, executes all 60 slots without displaying intermediate outcomes, and opens results only after reconciliation.

**Tech Stack:** TypeScript 6, Node.js 24.18.0, Docker, `gpt-5.6-terra`, SHA-256 content locks, JSON/JSONL evidence, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-29-v4-symmetric-evaluation-design.md`

## Global Constraints

- Start only after the engine completion gate passes.
- Do not reuse v1-v3 case IDs, record IDs, observation IDs, values, fixtures, prose, or serialized oracle objects.
- Do not call `gpt-5.6-terra` during case design, control generation, or preaudit.
- Do not inspect target-model trajectories, final packages, gate files, rows, or partial aggregates until all non-infrastructure run slots are complete.
- Do not edit frozen bytes. A defect creates `v5` or a versioned replacement campaign; it is never silently repaired inside v4.
- Treat `EVALUATOR_INVALID` symmetrically: exclude the case from both arms and preserve every frozen receipt.
- Stage only files named by the active task and commit after every task.

---

## Task 1: Freeze the V4 System Before Case Authoring

**Files:**
- Create: `scripts/freeze-v4-system.ts`
- Create: `tests/v4-freeze.test.ts`
- Create: `holdout/v4/SYSTEM_FREEZE.json`
- Modify: `package.json`

- [ ] Test that the system lock rejects a changed prompt, schema, evaluator file, runner file, measurement file, model, timeout, or Docker image ID.
- [ ] Define the bound execution paths exactly:

```ts
const V4_SYSTEM_PATHS = [
  "package.json", "package-lock.json", "scripts/evaluate.ts",
  "src/agents", "src/core", "src/evaluation", "src/workflows",
  "prompts", "schemas", "docker", "config/pricing-gpt-5.6-terra-2026-08-28.json",
] as const;
```

- [ ] Generate `SYSTEM_FREEZE.json` with schema version 1, status `FROZEN_BEFORE_CASE_AUTHORING`, exact Git commit, Node version `24.18.0`, model `gpt-5.6-terra`, timeout `1200000`, three trials, both arms, prompt/schema hashes, evaluation-tree hash, and the resolved Docker image ID.
- [ ] Fail if the worktree is dirty within any bound path. Unrelated artifact dirt outside the bound path may exist but must be listed in the lock receipt.
- [ ] Add `holdout:v4:system-freeze` to `package.json`.
- [ ] Run `npm test -- tests/v4-freeze.test.ts`, `npm run engine:verify`, then `npm run holdout:v4:system-freeze`.
- [ ] Commit and tag the system freeze:

```powershell
git add -- scripts/freeze-v4-system.ts tests/v4-freeze.test.ts holdout/v4/SYSTEM_FREEZE.json package.json package-lock.json
git commit -m "freeze v4 evaluation system"
git tag holdout-v4-system-freeze
```

## Task 2: Author Two New Cases Per Action

**Files:**
- Create: `scripts/generate-holdout-v4-cases.ts`
- Create: `holdout/v4/cases/**`
- Modify: `tests/cases.test.ts`
- Modify: `package.json`

- [ ] Encode these ten case concepts; use fresh identifiers and values throughout:

| Action | Case ID | Determined public crux | Required negative path |
|---|---|---|---|
| `UPDATE_DATA` | `update-bound-capacity-allocation` | A signed capacity register applies to an asset only through an explicit facility-to-class binding; update the bounded canonical fields while preserving identity and status. | Applying a valid register entry to the wrong class must fail. |
| `UPDATE_DATA` | `update-cutoff-refund-entitlement` | Event-at-cutoff authority combines a finalized return event with the policy version effective at that event. | Using the newest publication instead of the cutoff-effective policy must fail. |
| `REPAIR_ADAPTER` | `repair-epoch-changefeed-restart` | A changefeed restarts at a new epoch; only one complete, causally linked epoch may materialize. | Mixing pre-restart and post-restart records must fail hidden probes. |
| `REPAIR_ADAPTER` | `repair-framed-variant-export` | A stream contains two frame variants with different length/checksum semantics; both must decode without corrupting record boundaries. | A one-variant parser and a checksum-skipping parser must each fail separate probes. |
| `RETRY_LATER` | `retry-checkpoint-quorum-fence` | Publication waits for future per-region checkpoint observations at one generation and minimum offset. | Current IDs cannot satisfy the future conditions; wrong region/generation/offset are near misses. |
| `RETRY_LATER` | `retry-attestation-activation-barrier` | Activation waits for a future signed attestation and a separate registry state for the same subject. | An attestation for another subject and an unsigned matching record must fail. |
| `NO_ACTION` | `noop-future-capacity-revision` | A signed revision is authoritative but not effective at the declared cutoff; the existing canonical value remains correct. | Treating publication time as effective time must produce an incorrect update. |
| `NO_ACTION` | `noop-replayed-status-lineage` | A newer-looking status belongs to a retired lineage; the active lineage remains unchanged. | Name matching without immutable lineage identity must produce an incorrect mutation. |
| `HUMAN_REVIEW` | `review-unbound-service-tier` | Two authoritative tier schedules exist, but the public snapshot lacks the subject-to-tier binding needed to choose one. | Guessing either tier or requesting unrelated information must fail. |
| `HUMAN_REVIEW` | `review-colliding-registry-subject` | Two live registry subjects share a display key and neither observation contains the disambiguating immutable coordinate. | Choosing the most recent observation or display-name match must fail. |

- [ ] For each case, make the public contract fully deterministic: state authority mode, cutoff, subject identity, applicability rule, allowed writes, invariants, and required commands without revealing a function-to-rule recipe.
- [ ] Each `UPDATE_DATA` case includes a visible applicability chain and oracle predicates for changed and preserved fields.
- [ ] Each `REPAIR_ADAPTER` case includes public tests plus at least two evaluator-only probes: one valid unseen shape and one malformed boundary.
- [ ] Each `RETRY_LATER` case includes selector-based required conditions, one satisfying future-observation fixture, and at least three near misses.
- [ ] Each `NO_ACTION` case requires zero operations and names the authority sources needed to justify preservation.
- [ ] Each `HUMAN_REVIEW` case names the minimum decision-bearing fact paths; semantically relevant supersets remain accepted.
- [ ] Test the generator creates exactly ten cases, two per action, with no overlap against any earlier case/record/observation ID and byte-identical output on two runs.
- [ ] Add `holdout:v4:cases` to `package.json`, run it twice into separate temporary directories, and compare tree hashes.
- [ ] Run `npm test -- tests/cases.test.ts`.
- [ ] Commit:

```powershell
git add -- scripts/generate-holdout-v4-cases.ts holdout/v4/cases tests/cases.test.ts package.json package-lock.json
git commit -m "author balanced v4 holdout cases"
```

## Task 3: Build Deterministic Reference and Negative Controls

**Files:**
- Create: `src/evaluation/case-controls.ts`
- Create: `scripts/run-v4-controls.ts`
- Create: `tests/v4-controls.test.ts`
- Create: `holdout/v4/controls/**`
- Modify: `package.json`

- [ ] Define four universal controls per case: semantic reference, no-op, malformed package, and wrong-action package.
- [ ] Add action-specific controls:
  - update: wrong applicability binding and preserved-field corruption;
  - repair: one-path patch and malformed-boundary patch;
  - retry: stale-ID condition, unsatisfiable selector, and near-miss future fixture;
  - no-action: tempting mutation and unsupported justification;
  - review: guessed decision and vague information request.
- [ ] Execute every control through the exact shared finalizer used by model runs. Direct helper calls into a lower-level predicate are insufficient.
- [ ] Require each reference to earn ODI and every named negative control to fail the intended check ID. Record stable receipts with package hash, case hash, check IDs, and ODI.
- [ ] Ensure retry satisfying fixtures pass all required future conditions and every near miss fails at least one named condition.
- [ ] Add `holdout:v4:controls` and run it twice; receipts must be byte-identical except for no timestamps, which should not be stored.
- [ ] Run `npm test -- tests/v4-controls.test.ts` and `npm run holdout:v4:controls`.
- [ ] Commit:

```powershell
git add -- src/evaluation/case-controls.ts scripts/run-v4-controls.ts tests/v4-controls.test.ts holdout/v4/controls package.json package-lock.json
git commit -m "prove v4 case controls"
```

## Task 4: Perform the Model-Free Semantic Preaudit

**Files:**
- Create: `src/evaluation/preaudit.ts`
- Create: `scripts/preaudit-v4.ts`
- Create: `tests/v4-preaudit.test.ts`
- Create: `holdout/v4/PREAUDIT.json`
- Modify: `package.json`

- [ ] Implement a preaudit that rejects a case unless all of these are explicit and machine-checkable:
  - exactly one action under public bytes;
  - at least one complete evidence-source bundle;
  - authority validity for every decision-bearing source;
  - explicit cross-subject binding where subjects differ;
  - satisfiable retry conditions;
  - action-specific positive and negative controls;
  - allowed write surface no broader than necessary;
  - no public reference to oracle paths, hidden probes, implementation functions, or test inventory.
- [ ] Add a recipe-leak scan for preferred libraries, pseudocode blocks, function names from oracle probes, patch locations, and clause-to-function mapping language. It is a packaging check, not a difficulty score.
- [ ] Add mutation tests that deliberately remove one binding, validity rule, retry fixture, and negative control; each must make preaudit fail with a stable code.
- [ ] Generate `PREAUDIT.json` containing ten passing case receipts, control hashes, and zero target-model calls.
- [ ] Run `npm test -- tests/v4-preaudit.test.ts` and `npm run holdout:v4:preaudit`.
- [ ] Manually read all ten public case descriptions and policies once, looking only for ambiguity and recipe leakage. Record factual notes in `PREAUDIT.json`; do not add marketing judgments.
- [ ] Commit:

```powershell
git add -- src/evaluation/preaudit.ts scripts/preaudit-v4.ts tests/v4-preaudit.test.ts holdout/v4/PREAUDIT.json package.json package-lock.json
git commit -m "preaudit v4 holdout semantics"
```

## Task 5: Freeze the Complete V4 Case Set

**Files:**
- Create: `scripts/freeze-v4-cases.ts`
- Create: `holdout/v4/FREEZE.json`
- Modify: `tests/v4-freeze.test.ts`
- Modify: `package.json`

- [ ] Extend freeze tests to bind all ten case-tree hashes, the controls tree, preaudit receipt, system-lock hash, model, timeout, trials, a deterministic blocked-randomization seed, the resulting 60-slot order, and evaluator-invalid policy.
- [ ] Require status `FROZEN_BEFORE_MODEL_EXECUTION` and a clean Git state for every system/case/control/preaudit path.
- [ ] Generate `FREEZE.json`; verify it names exactly 60 slots (`10 cases × 3 trials × 2 arms`) and the exact `gpt-5.6-terra` target. Within each case/trial pair, randomize which arm runs first using the frozen seed; keep the two arms adjacent so time drift is blocked rather than confounded with one arm.
- [ ] Run `npm run holdout:v4:freeze`, then immediately run `npm test -- tests/v4-freeze.test.ts` against the generated lock.
- [ ] Commit and tag:

```powershell
git add -- scripts/freeze-v4-cases.ts holdout/v4/FREEZE.json tests/v4-freeze.test.ts package.json package-lock.json
git commit -m "freeze v4 holdout before model execution"
git tag holdout-v4-freeze
```

- [ ] Record the exact freeze commit and tag in an external operator note before executing the model.

## Task 6: Implement a Blind, Resumable 60-Slot Runner

**Files:**
- Create: `src/evaluation/campaign-receipts.ts`
- Create: `scripts/run-blind-v4.ts`
- Create: `tests/v4-campaign.test.ts`
- Modify: `package.json`

- [ ] Test that the wrapper verifies both locks before opening the first slot.
- [ ] Test that normal stdout reports only lock verification, completed-slot count, typed infrastructure interruption, and final reconciliation—never actions, scores, critique, or per-arm outcomes.
- [ ] Test that execution follows the frozen slot schedule exactly and rejects a caller-supplied reorder.
- [ ] Write slot receipts before and after each run with case, trial, arm, freeze hash, start/finish state, and artifact-root hash.
- [ ] On `MODEL_EXECUTION`, preserve the typed error and continue; it counts against that arm.
- [ ] On `INFRASTRUCTURE`, stop immediately before inspecting any result. Permit one exact-slot resume only when `--resume-receipt` names the frozen slot and the receipt proves no execution inputs changed.
- [ ] Never auto-retry a semantic failure, invalid output, or timeout classified as model execution.
- [ ] Reconcile exactly one terminal receipt for each of 60 slots before creating `CAMPAIGN_COMPLETE.json`.
- [ ] Add `holdout:v4:run` to execute:

```powershell
npm run holdout:v4:run -- --lock holdout/v4/FREEZE.json --out artifacts/evaluation/holdout-v4
```

- [ ] Run only recorded/mock campaign tests before the real campaign: `npm test -- tests/v4-campaign.test.ts`.
- [ ] Commit the runner before any live execution:

```powershell
git add -- src/evaluation/campaign-receipts.ts scripts/run-blind-v4.ts tests/v4-campaign.test.ts package.json package-lock.json
git commit -m "add blinded v4 campaign runner"
```

## Task 7: Execute the Frozen Campaign Without Intermediate Inspection

**Files:**
- Create during execution: `artifacts/evaluation/holdout-v4/**`

- [ ] Confirm `git rev-parse HEAD`, `git status --short` for bound paths, Docker image ID, model, timeout, and both lock hashes match the freeze.
- [ ] Close UI/report processes that might watch or summarize the artifact directory.
- [ ] Run `npm run holdout:v4:run -- --lock holdout/v4/FREEZE.json --out artifacts/evaluation/holdout-v4` in one terminal.
- [ ] Do not open `runs/`, `rows.jsonl`, `summary.json`, trajectories, packages, gate files, or partial logs while the run is active.
- [ ] If infrastructure interrupts, preserve the receipt, verify unchanged locks, execute only the exact resume command emitted by the wrapper, and continue blind.
- [ ] Wait for `CAMPAIGN_COMPLETE.json` to report 60 terminal slots.
- [ ] Hash the full raw artifact tree immediately after completion and store it in `RAW_BUNDLE.json` before opening results.

## Task 8: Audit Every Nonpass and Apply Symmetric Invalidation

**Files:**
- Create: `src/evaluation/audit-nonpasses.ts`
- Create: `scripts/audit-v4.ts`
- Create: `tests/v4-audit.test.ts`
- Create: `artifacts/evaluation/holdout-v4/audit.json`
- Modify: `artifacts/evaluation/holdout-v4/summary.json`
- Modify: `package.json`

- [ ] Only after the 60-slot receipt exists, enumerate every ODI nonpass and every typed model error.
- [ ] Assign one evidence-backed class to each nonpass: `MODEL_EXECUTION`, `INFRASTRUCTURE`, `EVALUATOR_INVALID`, or `GENUINE_SEMANTIC_FAILURE`.
- [ ] For evaluator-invalid findings, identify the exact public ambiguity, contradiction, impossibility, asymmetry, or incorrect predicate. Exclude that case from both arms and all three trials; never exclude an isolated unfavorable run.
- [ ] Preserve the raw summary unchanged as `summary.raw.json`; generate `summary.json` from raw rows plus explicit invalidation records.
- [ ] Test that a one-arm invalidation is rejected and that corrected case bytes cannot enter v4.
- [ ] Record action accuracy, artifact accuracy, source coverage, contradiction rate, forbidden mutation rate, command/probe pass rate, latency, and token accounting for retained rows.
- [ ] Run `npm test -- tests/v4-audit.test.ts` and `npm run holdout:v4:audit`.
- [ ] Commit code and canonical audit/summary/rows only; do not commit the raw run tree:

```powershell
git add -- src/evaluation/audit-nonpasses.ts scripts/audit-v4.ts tests/v4-audit.test.ts artifacts/evaluation/holdout-v4/audit.json artifacts/evaluation/holdout-v4/summary.raw.json artifacts/evaluation/holdout-v4/summary.json artifacts/evaluation/holdout-v4/rows.jsonl package.json package-lock.json
git commit -m "audit frozen v4 campaign"
```

## Campaign Completion Gate

- [ ] Both locks verify against their exact commits and tags.
- [ ] All ten cases have passing deterministic references and intended failing negative controls.
- [ ] `CAMPAIGN_COMPLETE.json` reconciles exactly 60 frozen slots.
- [ ] Every nonpass has one auditable classification.
- [ ] Any evaluator-invalid case is excluded symmetrically from both arms.
- [ ] The retained summary reports the observed result, including zero or negative advanced-arm lift.
- [ ] No prompts, schemas, evaluator code, runtime image, case bytes, or measurement code changed after freeze.
