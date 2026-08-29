# V4 Symmetric Evaluation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the asymmetric v3 evaluator with a v4 engine in which the direct and propose-challenge-revise arms emit the same final `DecisionPackage` and are scored by the same semantic evaluator.

**Architecture:** Both workflows end in one `finalizeDecision()` boundary. That boundary validates a final package, applies only its declared operations to a fresh copied workspace, runs public commands and hidden probes, and calls one Challenger-independent semantic evaluator. The advanced arm's critique is advisory process evidence; only its revised final package reaches the shared boundary.

**Tech Stack:** TypeScript 6, Node.js 24.18.0, Zod 4, Node test runner, Docker, Next.js 16.

**Spec:** `docs/superpowers/specs/2026-08-29-v4-symmetric-evaluation-design.md`

## Global Constraints

- Work on `v4-evaluation-contract`; do not push during this plan.
- Preserve unrelated generated artifacts and the existing dirty tree. Stage only files named by the active task.
- Do not read any target-model output while authoring or freezing v4 cases.
- Do not retain compatibility aliases that let the baseline consume a Challenger artifact.
- Do not count exact explanation wording, approval state, or internal critique outcome in ODI.
- Run the focused red test before implementation and the named green test after each change.
- End every task with the specified focused commit; never use `git add -A`.

---

## Task 1: Restore a Green Starting Build Around the ODI Rename

**Files:**
- Modify: `app/page.tsx`
- Modify: `tests/ui.test.ts`

- [ ] Add a source-level UI test that rejects the removed SDR property names:

```ts
test("overview page renders ODI rather than legacy SDR", async () => {
  const page = await readFile("app/page.tsx", "utf8");
  assert.match(page, /Operational Decision Integrity/);
  assert.doesNotMatch(page, /absoluteSdrChange|\.sdr\b|Safe Decision Rate/);
});
```

- [ ] Run `npm test -- --test-name-pattern="overview page renders ODI"` and confirm it fails on the current `app/page.tsx`.
- [ ] Make the minimum compile-restoring migration: replace `absoluteSdrChange` with `absoluteOdiChange`, `.sdr` with `.odi`, `safeDecisions` with `operationalDecisions`, and the visible metric label with `Operational Decision Integrity`. Do not redesign the page in this task.
- [ ] Run `npm test -- --test-name-pattern="overview page renders ODI|overview exposes"`.
- [ ] Run `npm run build` and confirm the current partial ODI migration no longer breaks compilation.
- [ ] Commit only `app/page.tsx`, `src/ui/overview-model.ts`, and `tests/ui.test.ts`:

```powershell
git add -- app/page.tsx src/ui/overview-model.ts tests/ui.test.ts
git commit -m "migrate overview contract to ODI"
```

## Task 2: Define the Shared Decision, Critique, Authority, and Retry Contracts

**Files:**
- Modify: `src/core/schemas.ts`
- Modify: `src/agents/runner.ts`
- Modify: `src/agents/prompt-loader.ts`
- Modify: `scripts/generate-schemas.ts`
- Modify: `tests/schemas.test.ts`
- Modify: `tests/agent-runner.test.ts`
- Create: `schemas/decision-package.schema.json`
- Create: `schemas/challenger-critique.schema.json`
- Delete: `schemas/baseline-result.schema.json`
- Delete: `schemas/maintainer-proposal.schema.json`
- Delete: `schemas/challenger-verdict.schema.json`

- [ ] Replace the role-specific final schemas with these public concepts:

```ts
export const ObservationSelectorSchema = z.object({
  sourceId: z.string().min(1),
  subjectId: z.string().min(1),
  kind: z.string().min(1).optional(),
  factPath: z.string().regex(/^facts(?:\.[A-Za-z0-9_-]+)+$/),
}).strict();

export const FutureConditionSchema = z.object({
  selector: ObservationSelectorSchema,
  operator: z.enum(["EQUALS", "NOT_EQUALS", "GREATER_THAN_OR_EQUAL", "LESS_THAN_OR_EQUAL", "EXISTS"]),
  expectedValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
}).strict().superRefine((condition, ctx) => {
  if (condition.operator !== "EXISTS" && condition.expectedValue === undefined) {
    ctx.addIssue({ code: "custom", message: "A comparison condition requires expectedValue" });
  }
  if (condition.operator === "EXISTS" && condition.expectedValue !== undefined) {
    ctx.addIssue({ code: "custom", message: "EXISTS does not accept expectedValue" });
  }
});

export const RetryPlanSchema = z.object({
  notBefore: TimestampSchema,
  maxAttempts: z.number().int().positive(),
  escalateAfterAttempt: z.number().int().positive(),
  preserveRecordIds: z.array(z.string().min(1)),
  acceptanceConditions: z.array(FutureConditionSchema).min(1),
}).strict().refine((plan) => plan.escalateAfterAttempt <= plan.maxAttempts, {
  message: "Escalation cannot occur after the retry budget",
});
```

- [ ] Add explicit policy validity instead of one global freshness interpretation:

```ts
export const AuthorityValiditySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("SNAPSHOT_MAX_AGE"), sourceId: z.string().min(1),
    authorityScope: z.string().min(1), maxAgeMinutes: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    mode: z.literal("EFFECTIVE_UNTIL_SUPERSEDED"), sourceId: z.string().min(1),
    authorityScope: z.string().min(1), applicabilityFactPath: z.string().regex(/^facts\./),
  }).strict(),
  z.object({
    mode: z.literal("EVENT_AT_CUTOFF"), sourceId: z.string().min(1),
    authorityScope: z.string().min(1), eventFactPath: z.string().regex(/^facts\./),
  }).strict(),
]);
```

`PolicySchema` becomes schema version 2 and contains `authorityValidity: z.array(AuthorityValiditySchema).min(1)`. Remove `freshnessWindowMinutes`; no fallback validity mode is allowed.

- [ ] Rename `MaintainerProposalSchema` to `DecisionPackageSchema`, keep its five action-discriminated branches, set `schemaVersion: 3`, and export one `DecisionPackageOutputContractSchema` for both arms.
- [ ] Replace `ChallengerVerdictSchema` with an advisory `ChallengerCritiqueSchema`:

```ts
export const ChallengerCritiqueSchema = z.object({
  schemaVersion: z.literal(2),
  caseId: z.string().min(1),
  recommendation: z.enum(["ACCEPT_DRAFT", "REVISE_DRAFT"]),
  evidenceIds: z.array(z.string().min(1)),
  critiqueCategories: z.array(z.enum([
    "ACTION", "AUTHORITY", "IDENTITY", "TEMPORAL", "APPLICABILITY",
    "ARTIFACT", "WRITE_SURFACE", "REGRESSION", "UNCERTAINTY",
  ])),
  findings: z.array(z.string().min(1)),
  summary: z.string().min(1),
}).strict();
```

- [ ] Extend `AgentRole` and all token/runtime role enums to include `reviser`. The advanced manifest must expect exactly `maintainer`, `challenger`, and `reviser` sessions.
- [ ] Generate only `decision-package.schema.json` and `challenger-critique.schema.json`.
- [ ] Test that baseline, maintainer draft, and reviser outputs all parse through the exact same `DecisionPackageSchema`; test future-condition validation; test all three authority modes; test the `reviser` role.
- [ ] Run `npm run schemas`, then `npm test -- --test-name-pattern="decision package|future condition|authority validity|reviser"`.
- [ ] Commit the contract migration:

```powershell
git add -- src/core/schemas.ts src/agents/runner.ts src/agents/prompt-loader.ts scripts/generate-schemas.ts tests/schemas.test.ts tests/agent-runner.test.ts schemas
git commit -m "define symmetric v4 decision contracts"
```

## Task 3: Add Deterministic Authority and Future-Selector Evaluation

**Files:**
- Create: `src/core/fact-path.ts`
- Create: `src/core/authority-validity.ts`
- Create: `src/core/future-conditions.ts`
- Create: `tests/authority-validity.test.ts`
- Create: `tests/future-conditions.test.ts`

- [ ] Extract a shared `readFactPath(value, path)` helper that distinguishes a missing path from a present `null` value.
- [ ] Write table tests proving:
  - `SNAPSHOT_MAX_AGE` compares `observedAt` with the policy cutoff;
  - `EFFECTIVE_UNTIL_SUPERSEDED` accepts an older signed entry until a later applicable entry exists;
  - `EVENT_AT_CUTOFF` chooses the event state at or before cutoff;
  - an observation for a different subject cannot silently authorize a target without an agent-visible applicability binding.
- [ ] Implement `evaluateAuthorityValidity(policy, observations)` returning `{ validObservationIds, violations }` with stable, sorted violation strings.
- [ ] Write future-selector tests using a satisfying fixture and three near misses: wrong source, wrong subject, and insufficient value.
- [ ] Implement:

```ts
export function conditionMatches(
  condition: FutureCondition,
  observations: readonly SourceObservation[],
): boolean;

export function evaluateFutureConditions(
  conditions: readonly FutureCondition[],
  observations: readonly SourceObservation[],
): { passed: boolean; matchedConditionIndexes: number[] };
```

Multiple observations may match a selector; a condition passes if at least one matched observation satisfies the comparison. Numeric operators reject nonnumeric operands.
- [ ] Run `npm test -- tests/authority-validity.test.ts tests/future-conditions.test.ts`.
- [ ] Commit:

```powershell
git add -- src/core/fact-path.ts src/core/authority-validity.ts src/core/future-conditions.ts tests/authority-validity.test.ts tests/future-conditions.test.ts
git commit -m "evaluate authority and future retry conditions"
```

## Task 4: Replace Exact Oracle Equality With Semantic Action Predicates

**Files:**
- Modify: `src/core/schemas.ts`
- Create: `src/core/semantic-evaluator.ts`
- Modify: `src/core/deterministic-gate.ts`
- Modify: `tests/deterministic-gate.test.ts`
- Create: `tests/semantic-evaluator.test.ts`

- [ ] Change `CaseOracleSchema` to schema version 3 with action-specific semantic requirements:

```ts
const OracleCommon = {
  schemaVersion: z.literal(3),
  caseId: z.string().min(1),
  expectedAction: ActionClassSchema,
  requiredEvidenceSourceBundles: z.array(z.array(z.string().min(1)).min(1)).min(1),
  forbiddenEvidenceClaims: z.array(EvidenceAssessmentSchema),
  allowedChangedFiles: z.array(RelativePathSchema),
  expectedCommandExitCodes: z.record(z.string(), z.number().int()),
  hiddenProbePath: RelativePathSchema.nullable(),
} as const;
```

Add `requiredRecordProperties` plus `preservedRecordProperties` for updates; public/hidden execution requirements for repairs; `requiredFutureConditions`, one satisfying observation fixture, and near-miss fixtures for retries; `requiredAuthoritySources` for no-action; and `reviewRequirements` with required fact paths for human review.

- [ ] Write tests proving semantic equivalence:
  - reordered conditions score the same;
  - duplicate harmless evidence or an additional condition satisfied by every declared satisfying fixture does not fail;
  - a contradictory condition, unknown source, impossible `notBefore`, or unsatisfiable selector fails;
  - a human-review request may ask for extra relevant facts but may not omit a required decision-bearing fact;
  - update records may preserve harmless extra fields but may not alter declared preserved fields;
  - exact annotation mismatch stays diagnostic and nonblocking.
- [ ] Implement `evaluateDecisionPackage(input)` returning:

```ts
export interface SemanticEvaluation {
  actionCorrect: boolean;
  artifactCorrect: boolean;
  noForbiddenMutation: boolean;
  requiredCommandsPassed: boolean;
  sourceCoverage: boolean;
  contradictionFree: boolean;
  annotationAligned: boolean;
  checks: CheckResult[];
  operationalDecisionIntegrity: boolean;
}
```

`operationalDecisionIntegrity` is the conjunction of the first six booleans; `annotationAligned` is excluded.
- [ ] Remove `challenger` from `GateInput`, delete `challenger-compatible` and `challenger-evidence-supported`, and make `runDeterministicGate()` a thin compatibility wrapper around `evaluateDecisionPackage()` until call sites are migrated.
- [ ] Run `npm test -- tests/semantic-evaluator.test.ts tests/deterministic-gate.test.ts`.
- [ ] Commit:

```powershell
git add -- src/core/schemas.ts src/core/semantic-evaluator.ts src/core/deterministic-gate.ts tests/semantic-evaluator.test.ts tests/deterministic-gate.test.ts
git commit -m "score final decisions with semantic predicates"
```

## Task 5: Create the One Shared Finalization Boundary

**Files:**
- Create: `src/workflows/finalize-decision.ts`
- Create: `tests/finalize-decision.test.ts`
- Modify: `src/core/candidate-validation.ts`

- [ ] Write a test that sends equivalent baseline and advanced final packages through `finalizeDecision()` and asserts byte-identical gate checks, changed-file lists, command evidence, and ODI.
- [ ] Write rejection tests for a forbidden operation, invalid JSON mutation, hidden-probe failure, and an operation outside both allowlists.
- [ ] Implement this sole post-model boundary:

```ts
export interface FinalizeDecisionInput {
  caseDir: string;
  runRoot: string;
  package: DecisionPackage;
  submissionMode: true;
  liveWriteAttempted: false;
}

export async function finalizeDecision(input: FinalizeDecisionInput): Promise<{
  gate: GateResult;
  commandResults: Record<string, CommandResult>;
  before: TreeSnapshot;
  after: TreeSnapshot;
}>;
```

The function must load the public case and hidden oracle on the host, copy a fresh workspace, validate operations, apply only final-package operations, run commands/probes, snapshot the result, evaluate the package, and write `final-decision.json`, trees, commands, and `gate.json`.
- [ ] Ensure workflows cannot supply a pre-mutated workspace or precomputed command result.
- [ ] Run `npm test -- tests/finalize-decision.test.ts`.
- [ ] Commit:

```powershell
git add -- src/workflows/finalize-decision.ts src/core/candidate-validation.ts tests/finalize-decision.test.ts
git commit -m "centralize final decision execution and scoring"
```

## Task 6: Rebuild the Direct Baseline on the Shared Contract

**Files:**
- Modify: `src/workflows/baseline.ts`
- Modify: `prompts/baseline.md`
- Modify: `tests/baseline.test.ts`
- Modify: `scripts/run-case.ts`

- [ ] Test that the baseline uses `schemas/decision-package.schema.json`, writes `final-decision.json`, runs exactly one `baseline` session, and has no code path or artifact containing `challenger`.
- [ ] Add a source assertion:

```ts
const source = await readFile("src/workflows/baseline.ts", "utf8");
assert.doesNotMatch(source, /Challenger|oracle\.requiredChallenger|challenger-verdict/);
```

- [ ] Refactor `runBaseline()` to gather the public snapshot, call the direct model, and pass its parsed `DecisionPackage` to `finalizeDecision()`. Hidden oracle loading must occur only inside the finalizer.
- [ ] Remove `arm` and `executedCommands` from the agent output contract; arm identity belongs to the manifest, not the final decision.
- [ ] Update the prompt to request one final decision without naming hidden tests, functions, or preferred implementation.
- [ ] Run `npm test -- tests/baseline.test.ts tests/agent-runner.test.ts`.
- [ ] Commit:

```powershell
git add -- src/workflows/baseline.ts prompts/baseline.md tests/baseline.test.ts scripts/run-case.ts
git commit -m "route direct baseline through shared finalizer"
```

## Task 7: Implement Propose-Challenge-Revise Without Critique-Based Scoring

**Files:**
- Modify: `src/workflows/advanced.ts`
- Modify: `prompts/maintainer.md`
- Modify: `prompts/challenger.md`
- Create: `prompts/revision.md`
- Modify: `tests/advanced.test.ts`

- [ ] Test the exact role order `maintainer`, `challenger`, `reviser` and artifacts `draft-decision.json`, `challenger-critique.json`, `final-decision.json`.
- [ ] Test that changing only the critique while holding the final package fixed produces the same external gate result.
- [ ] Test that a revision may differ from the draft and that only revision operations are applied.
- [ ] Test that all three role sessions receive identical public case bytes; Challenger and reviser additionally receive process artifacts, never hidden oracle bytes.
- [ ] Refactor the workflow:
  1. run Maintainer against the shared decision schema without mutating the workspace;
  2. run Challenger against public bytes plus the draft using the critique schema, read-only;
  3. run reviser against public bytes plus draft and critique using the shared decision schema;
  4. pass only the revised package to `finalizeDecision()`.
- [ ] Remove candidate execution, command results, and candidate diff from the pre-critique stage. They are consequences of the final package, not inputs to the Challenger.
- [ ] Bind all three trajectories and usage receipts into the advanced manifest.
- [ ] Mark the experiment as a system-level, non-compute-matched comparison: the advanced method intentionally uses three model sessions and the baseline uses one. Report the added latency and tokens; do not attribute any observed difference to critique quality alone.
- [ ] Run `npm test -- tests/advanced.test.ts tests/token-usage-accounting.test.ts`.
- [ ] Commit:

```powershell
git add -- src/workflows/advanced.ts prompts/maintainer.md prompts/challenger.md prompts/revision.md tests/advanced.test.ts tests/token-usage-accounting.test.ts
git commit -m "implement propose challenge revise workflow"
```

## Task 8: Make ODI and Failure Taxonomy the Only Comparative Result

**Files:**
- Modify: `src/evaluation/score-run.ts`
- Modify: `src/evaluation/aggregate.ts`
- Modify: `src/evaluation/run-evaluation.ts`
- Modify: `src/evaluation/statistics.ts`
- Modify: `src/evaluation/token-usage-accounting.ts`
- Modify: `tests/evaluation.test.ts`
- Modify: `tests/token-usage-accounting.test.ts`

- [ ] Remove `safeDecision`, approval, review-ready, estimated-human-touch, and legacy SDR comparison fields from new v4 rows and summaries.
- [ ] Add explicit row fields `artifactCorrect`, `requiredCommandsPassed`, `sourceCoverage`, `contradictionFree`, `annotationAligned`, and `failureClass`.
- [ ] Use this exhaustive classification:

```ts
type FailureClass =
  | "NONE"
  | "MODEL_EXECUTION"
  | "INFRASTRUCTURE"
  | "EVALUATOR_INVALID"
  | "GENUINE_SEMANTIC_FAILURE";
```

- [ ] Make infrastructure failures abort before aggregation. An exact-slot retry requires a separate recorded receipt; do not convert it to a model row.
- [ ] Add an evaluator-invalidations input that excludes the named case from both arms while retaining the frozen receipts and recalculating denominators symmetrically.
- [ ] Keep the unique case as the outer bootstrap unit and trials nested within case. Add tests with unbalanced trial values that would fail under naive row bootstrap.
- [ ] Update advanced token accounting to require three sessions and make totals null if any session lacks a trustworthy receipt.
- [ ] Run `npm test -- tests/evaluation.test.ts tests/token-usage-accounting.test.ts`.
- [ ] Commit:

```powershell
git add -- src/evaluation/score-run.ts src/evaluation/aggregate.ts src/evaluation/run-evaluation.ts src/evaluation/statistics.ts src/evaluation/token-usage-accounting.ts tests/evaluation.test.ts tests/token-usage-accounting.test.ts
git commit -m "report v4 ODI and typed failures"
```

## Task 9: Record V3 Invalidation and Verify the Engine

**Files:**
- Create: `holdout/INVALIDATION-v3.json`
- Modify: `docs/evaluation.md`
- Modify: `tests/cases.test.ts`
- Modify: `package.json`

- [ ] Add a machine-readable v3 invalidation naming both defects: synthesized baseline Challenger and the two semantically invalid cases. Preserve the freeze tag, freeze commit, run directory, 30-slot completion fact, and raw descriptive counts without presenting them as system performance.
- [ ] Add `engine:verify` to run schema generation, lint, all engine tests, and build.
- [ ] Test that invalidation records are immutable versioned disclosures and that no v1-v3 result is selected as the public comparative result.
- [ ] Run `npm run engine:verify`.
- [ ] Inspect `git diff --check` and `git status --short`; verify only intended source/test/doc changes are staged.
- [ ] Commit:

```powershell
git add -- holdout/INVALIDATION-v3.json docs/evaluation.md tests/cases.test.ts package.json package-lock.json
git commit -m "invalidate asymmetric v3 comparison"
```

## Engine Completion Gate

- [ ] `npm ci` succeeds under Node 24.18.0.
- [ ] `npm run schemas`, `npm run lint`, `npm test`, and `npm run build` pass.
- [ ] A recorded baseline and recorded advanced run emit the same final schema and pass through the same finalizer.
- [ ] `rg -n "requiredChallenger|evaluatorVerdict|challenger-compatible|safeDecision|absoluteSdrChange" src scripts tests app` returns no v4 execution-path hits.
- [ ] No live `gpt-5.6-terra` holdout execution has occurred.
