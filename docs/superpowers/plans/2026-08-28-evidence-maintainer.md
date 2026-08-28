# Evidence Maintainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-place-caliber agentic maintainer that safely chooses among data update, adapter repair, retry, no-action, and human review, proves its decision, and measurably beats a fair direct-agent baseline.

**Architecture:** A TypeScript engine creates immutable evidence ledgers from frozen public-data cases, runs one Maintainer agent and one independent Challenger agent through a provider-neutral runner, applies only bounded candidate changes, and passes the result through deterministic verification before simulated human approval. A small Next.js control room and standalone HTML report expose the evidence, decision, diff, checks, baseline comparison, timing, cost, and recorded trajectories.

**Tech Stack:** Node.js 24+, TypeScript 6.0.3, Next.js 16.3.3, React 19.2.8, Zod 4.5.1, ESLint 9.39.5, Node test runner, Codex CLI 0.150-compatible JSONL execution, JSON/JSONL artifacts, Docker for offline reproduction.

**Spec:** `docs/product-spec.md`

## Global Constraints

- Execution is inline in one session; do not dispatch implementation subagents.
- Competition mode is sandbox-only and never writes to Beaver Front Office or another live system.
- Build 12 complete core cases before adding the three stretch cases.
- Baseline and advanced arms use the same case bytes, model, output contract, and declared wall-clock limit.
- Every agent invocation emits a representative JSONL trajectory and a structured final result.
- Recorded/offline output is always labeled `recorded`; it is never presented as fresh model execution.
- Raw evidence is immutable; derived claims cite evidence IDs.
- Agent proposals cannot mutate live canonical artifacts.
- Consequential application requires deterministic gate success and simulated human approval.
- No credentials, private Handshake task bytes, private account data, or proprietary trajectories enter the submission.
- All included source fixtures are public, synthetic, or expressly approved and have provenance plus SHA-256 hashes.
- Use branch name `main` for the standalone repository; never create an `agent/` branch.
- Every task ends with focused tests, full tests, and a commit.

---

## Locked File Structure

```text
micro1-grounded-maintainer/
├── AGENTS.md
├── README.md
├── LICENSE
├── package.json
├── package-lock.json
├── tsconfig.json
├── eslint.config.mjs
├── next.config.ts
├── Dockerfile
├── .dockerignore
├── .gitignore
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   ├── page.tsx
│   └── cases/[caseId]/page.tsx
├── cases/
│   ├── update-official-commitment/
│   ├── update-transfer-destination/
│   ├── update-authoritative-rating/
│   ├── repair-selector-drift/
│   ├── repair-json-nesting/
│   ├── repair-pagination/
│   ├── retry-deferred-406/
│   ├── retry-timeout-cache/
│   ├── retry-partial-document/
│   ├── noop-duplicate-news/
│   ├── noop-newer-publication-stale-effective/
│   ├── noop-filtered-removal/
│   ├── review-conflicting-authorities/
│   ├── review-name-collision/
│   └── review-reintroduced-identity/
├── prompts/
│   ├── baseline.md
│   ├── maintainer.md
│   └── challenger.md
├── schemas/
│   ├── baseline-result.schema.json
│   ├── maintainer-proposal.schema.json
│   └── challenger-verdict.schema.json
├── scripts/
│   ├── run-case.ts
│   ├── evaluate.ts
│   ├── generate-demo.ts
│   ├── generate-schemas.ts
│   └── verify-submission.ts
├── src/
│   ├── core/
│   │   ├── project.ts
│   │   ├── schemas.ts
│   │   ├── canonical-json.ts
│   │   ├── case-loader.ts
│   │   ├── evidence-ledger.ts
│   │   ├── tree-snapshot.ts
│   │   ├── mutation-engine.ts
│   │   └── deterministic-gate.ts
│   ├── agents/
│   │   ├── runner.ts
│   │   ├── recorded-runner.ts
│   │   ├── codex-runner.ts
│   │   └── prompt-loader.ts
│   ├── workflows/
│   │   ├── baseline.ts
│   │   ├── advanced.ts
│   │   └── approval.ts
│   ├── evaluation/
│   │   ├── score-run.ts
│   │   ├── aggregate.ts
│   │   └── run-evaluation.ts
│   ├── reports/
│   │   ├── load-artifacts.ts
│   │   └── render-decision-report.ts
│   └── ui/
│       ├── overview-model.ts
│       └── case-model.ts
├── tests/
│   ├── bootstrap.test.ts
│   ├── schemas.test.ts
│   ├── case-loader.test.ts
│   ├── evidence-ledger.test.ts
│   ├── deterministic-gate.test.ts
│   ├── agent-runner.test.ts
│   ├── baseline.test.ts
│   ├── advanced.test.ts
│   ├── cases.test.ts
│   ├── evaluation.test.ts
│   ├── report.test.ts
│   └── ui.test.ts
├── artifacts/
│   ├── recorded/
│   ├── evaluation/
│   └── demo/
└── docs/
    ├── product-spec.md
    ├── spec-self-review.md
    ├── architecture.md
    ├── evaluation.md
    ├── improvement-changelog.md
    ├── reproduction.md
    ├── trajectory-index.md
    ├── video-script.md
    └── superpowers/plans/2026-08-28-evidence-maintainer.md
```

---

### Task 1: Bootstrap the Standalone Repository and Test Contract

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `eslint.config.mjs`
- Create: `next.config.ts`
- Create: `.gitignore`
- Create: `AGENTS.md`
- Create: `app/layout.tsx`
- Create: `app/page.tsx`
- Create: `app/globals.css`
- Create: `src/core/project.ts`
- Test: `tests/bootstrap.test.ts`

**Interfaces:**
- Produces: `PROJECT_ID: "evidence-maintainer"`, `PROJECT_TITLE: "Evidence Maintainer"`, and a runnable Next.js/Node test foundation.
- Consumes: approved `docs/product-spec.md` only.

- [ ] **Step 1: Initialize Git on a normal main branch**

Run:

```powershell
git init -b main
git status --short --branch
```

Expected: `## No commits yet on main`.

- [ ] **Step 2: Create the pinned package manifest and configuration**

Create `package.json` with these exact scripts and versions:

```json
{
  "name": "evidence-maintainer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24.0.0" },
  "scripts": {
    "dev": "next dev --webpack",
    "build": "next build --webpack",
    "start": "next start",
    "lint": "eslint .",
    "test": "node --experimental-strip-types --test \"tests/*.test.ts\"",
    "case": "node --experimental-strip-types scripts/run-case.ts",
    "evaluate": "node --experimental-strip-types scripts/evaluate.ts",
    "demo": "node --experimental-strip-types scripts/generate-demo.ts",
    "schemas": "node --experimental-strip-types scripts/generate-schemas.ts",
    "verify": "npm run lint && npm test && npm run demo && npm run build"
  },
  "dependencies": {
    "next": "16.3.3",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "zod": "4.5.1"
  },
  "devDependencies": {
    "@types/node": "26.4.0",
    "@types/react": "19.2.2",
    "@types/react-dom": "19.2.2",
    "eslint": "9.39.5",
    "eslint-config-next": "16.3.3",
    "typescript": "6.0.3"
  }
}
```

Use `moduleResolution: "bundler"`, `strict: true`, `noEmit: true`, `jsx: "react-jsx"`, `allowImportingTsExtensions: true`, and aliases `@/* -> ./*` in `tsconfig.json`.

- [ ] **Step 3: Install dependencies and preserve the lockfile**

Run:

```powershell
npm install
```

Expected: `package-lock.json` exists and `npm ls --depth=0` exits 0.

- [ ] **Step 4: Write the failing bootstrap test**

Create `tests/bootstrap.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { PROJECT_ID, PROJECT_TITLE } from "../src/core/project.ts";

test("project identity is stable for artifact manifests", () => {
  assert.equal(PROJECT_ID, "evidence-maintainer");
  assert.equal(PROJECT_TITLE, "Evidence Maintainer");
});
```

- [ ] **Step 5: Run the test and verify the missing module failure**

Run:

```powershell
npm test
```

Expected: FAIL because `src/core/project.ts` does not exist.

- [ ] **Step 6: Add the minimal project identity and app shell**

Create `src/core/project.ts`:

```ts
export const PROJECT_ID = "evidence-maintainer" as const;
export const PROJECT_TITLE = "Evidence Maintainer" as const;
```

Create a server-rendered `app/page.tsx` that displays the title, the subtitle “Safe autonomous maintenance for live public-data products,” and a visible `Recorded demo` status badge. Do not add dynamic data yet.

- [ ] **Step 7: Run bootstrap verification**

Run:

```powershell
npm test
npm run lint
npm run build
```

Expected: all commands exit 0 and Next.js emits a production build.

- [ ] **Step 8: Commit the bootstrap**

```powershell
git add package.json package-lock.json tsconfig.json eslint.config.mjs next.config.ts .gitignore AGENTS.md app src/core/project.ts tests/bootstrap.test.ts
git commit -m "chore: bootstrap evidence maintainer"
```

---

### Task 2: Define Domain Schemas and Stable Artifact Hashes

**Files:**
- Create: `src/core/schemas.ts`
- Create: `src/core/canonical-json.ts`
- Create: `scripts/generate-schemas.ts`
- Create: `schemas/baseline-result.schema.json`
- Create: `schemas/maintainer-proposal.schema.json`
- Create: `schemas/challenger-verdict.schema.json`
- Test: `tests/schemas.test.ts`

**Interfaces:**
- Produces: `ActionClass`, `CaseManifest`, `EvidenceEvent`, `MaintainerProposal`, `ChallengerVerdict`, `BaselineResult`, `CheckResult`, `RunManifest`, `canonicalJson(value)`, and `sha256Json(value)`.
- Consumes: `PROJECT_ID` from Task 1.

- [ ] **Step 1: Write schema and canonical-hash tests first**

Create tests asserting:

```ts
assert.deepEqual(ActionClassSchema.options, [
  "UPDATE_DATA",
  "REPAIR_ADAPTER",
  "RETRY_LATER",
  "NO_ACTION",
  "HUMAN_REVIEW",
]);

assert.equal(
  sha256Json({ b: 2, a: 1 }),
  sha256Json({ a: 1, b: 2 }),
);

assert.throws(() => MaintainerProposalSchema.parse({ action: "DELETE" }));
```

The complete valid proposal fixture must contain:

```ts
{
  schemaVersion: 1,
  caseId: "noop-duplicate-news",
  action: "NO_ACTION",
  firstMaterialDivergence: "obs-2 duplicates event evt-1",
  failureOwner: "source-observation",
  evidenceUsed: ["obs-1", "obs-2"],
  evidenceRejected: [],
  affectedEntities: ["athlete-7"],
  affectedFiles: [],
  operations: [],
  preservedInvariants: ["canonical event IDs remain unique"],
  unresolvedUncertainty: [],
  approvalLevel: "SIMULATED_HUMAN",
  summary: "No canonical change is justified."
}
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `node --experimental-strip-types --test tests/schemas.test.ts`

Expected: FAIL because schema and hashing modules do not exist.

- [ ] **Step 3: Implement recursive canonical JSON and SHA-256**

`canonicalJson` must sort object keys recursively, retain array order, reject `undefined`, functions, symbols, bigint, and non-finite numbers, and serialize with `JSON.stringify`. `sha256Json` hashes UTF-8 canonical JSON with `node:crypto`.

- [ ] **Step 4: Implement exact Zod contracts**

Define action, evidence, source, policy, mutation, proposal, verdict, check, baseline, case, oracle, and run schemas. Use discriminated mutation operations:

```ts
const MutationOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("SET_RECORD_FIELDS"),
    file: z.string().min(1),
    recordId: z.string().min(1),
    fields: z.record(z.string(), z.json()),
  }),
  z.object({
    kind: z.literal("NO_MUTATION"),
    reason: z.string().min(1),
  }),
]);
```

`ChallengerVerdictSchema` must use `verdict: z.enum(["CONFIRM", "REJECT", "ESCALATE"])` and require `evidenceIds`, `violations`, `residualRisks`, and `summary`.

- [ ] **Step 5: Generate JSON Schemas from the same Zod contracts**

Use `z.toJSONSchema` and stable two-space JSON output. The script must write exactly the three schema paths listed above and report their SHA-256 values.

- [ ] **Step 6: Verify schema round trips**

Run:

```powershell
npm run schemas
node --experimental-strip-types --test tests/schemas.test.ts
npm test
```

Expected: PASS and three non-empty schema files.

- [ ] **Step 7: Commit schemas**

```powershell
git add src/core/schemas.ts src/core/canonical-json.ts scripts/generate-schemas.ts schemas tests/schemas.test.ts
git commit -m "feat: define evidence maintainer contracts"
```

---

### Task 3: Load Frozen Cases and Build an Immutable Evidence Ledger

**Files:**
- Create: `src/core/case-loader.ts`
- Create: `src/core/evidence-ledger.ts`
- Create: `cases/noop-duplicate-news/case.json`
- Create: `cases/noop-duplicate-news/oracle.json`
- Create: `cases/noop-duplicate-news/workspace/input/canonical.json`
- Create: `cases/noop-duplicate-news/workspace/input/observations.json`
- Create: `cases/noop-duplicate-news/workspace/input/policy.json`
- Create: `cases/update-official-commitment/case.json`
- Create: `cases/update-official-commitment/oracle.json`
- Create: `cases/update-official-commitment/workspace/input/canonical.json`
- Create: `cases/update-official-commitment/workspace/input/observations.json`
- Create: `cases/update-official-commitment/workspace/input/policy.json`
- Test: `tests/case-loader.test.ts`
- Test: `tests/evidence-ledger.test.ts`

**Interfaces:**
- Produces: `loadPublicCase(caseDir): Promise<LoadedCase>`, `loadOracle(caseDir): Promise<CaseOracle>`, `copyCaseWorkspace(caseDir, runDir): Promise<string>`, and `buildEvidenceLedger(loadedCase): EvidenceEvent[]`.
- Consumes: schemas and `sha256Json` from Task 2.

- [ ] **Step 1: Write loader boundary tests**

Tests must prove that `loadPublicCase` returns the public manifest and workspace hashes but does not expose `oracle.json`, while `loadOracle` is callable only by the evaluation layer.

```ts
const loaded = await loadPublicCase(caseDir);
assert.equal(loaded.manifest.id, "noop-duplicate-news");
assert.equal("oracle" in loaded, false);
assert.ok(loaded.workspaceHash.match(/^[a-f0-9]{64}$/));
```

- [ ] **Step 2: Run loader tests and verify failure**

Run: `node --experimental-strip-types --test tests/case-loader.test.ts`

Expected: FAIL because the loader is absent.

- [ ] **Step 3: Create two exact seed cases**

`noop-duplicate-news` contains a canonical event `evt-1` and two observations with different article URLs but the same athlete, event type, effective date, and authoritative source statement. Its oracle action is `NO_ACTION`, with zero allowed changed files.

`update-official-commitment` contains a canonical athlete status `offered`, an older aggregator observation retaining `offered`, and a later official team announcement recording `committed`. Its oracle action is `UPDATE_DATA`; only `input/canonical.json` may change, and athlete `athlete-11.status` must become `committed`.

Every case manifest must contain `id`, `title`, `description`, `sourceClass`, `createdFrom`, `agentVisibleFiles`, `allowedWritePaths`, `requiredCommands`, and `provenance` entries with capture dates and hashes.

- [ ] **Step 4: Implement safe loading and workspace copying**

Reject absolute paths, `..` segments, symlinks, missing files, hash mismatches, and paths outside the case directory. Copy only `case.json` plus `workspace/` into a run directory; never copy `oracle.json`.

- [ ] **Step 5: Write evidence-ledger tests**

Assert deterministic ordering by `observedAt`, then `sourceId`, then `id`; assert sequential `seq` values; assert every derived event cites raw evidence IDs; assert modifying the returned array does not mutate the loaded source values.

- [ ] **Step 6: Implement the append-only evidence ledger**

Emit one `CASE_OPENED` event, one `CANONICAL_SNAPSHOT` event, normalized `SOURCE_OBSERVATION` events, one `POLICY_LOADED` event, and one `WORKSPACE_HASHED` event. Every event includes `id`, `seq`, `kind`, `occurredAt`, `evidenceIds`, `payload`, and `sha256`.

- [ ] **Step 7: Run focused and full tests**

```powershell
node --experimental-strip-types --test tests/case-loader.test.ts tests/evidence-ledger.test.ts
npm test
```

Expected: PASS.

- [ ] **Step 8: Commit case and ledger foundation**

```powershell
git add src/core/case-loader.ts src/core/evidence-ledger.ts cases/noop-duplicate-news cases/update-official-commitment tests/case-loader.test.ts tests/evidence-ledger.test.ts
git commit -m "feat: add frozen cases and evidence ledger"
```

---

### Task 4: Enforce Candidate Mutations and the Deterministic Safety Gate

**Files:**
- Create: `src/core/tree-snapshot.ts`
- Create: `src/core/mutation-engine.ts`
- Create: `src/core/deterministic-gate.ts`
- Test: `tests/deterministic-gate.test.ts`

**Interfaces:**
- Produces: `snapshotTree(root): Promise<TreeSnapshot>`, `diffTrees(before, after): TreeDiff`, `applyOperations(workspace, operations): Promise<void>`, and `runDeterministicGate(input): Promise<GateResult>`.
- Consumes: loaded case, proposal, challenger verdict, oracle, schemas, and canonical hashing.

- [ ] **Step 1: Write failing mutation and gate tests**

Cover these exact outcomes:

```ts
assert.equal(noActionGate.status, "PASS");
assert.deepEqual(noActionGate.changedFiles, []);

assert.equal(forbiddenWriteGate.status, "FAIL");
assert.ok(forbiddenWriteGate.checks.some(
  (check) => check.id === "allowed-write-surface" && !check.passed,
));

assert.equal(correctDataUpdateGate.status, "PASS");
assert.equal(updatedRecord.status, "committed");
```

Also verify that `SET_RECORD_FIELDS` rejects duplicate record IDs, absent records, non-array JSON roots, traversal paths, and fields whose values cannot be represented as JSON.

- [ ] **Step 2: Verify tests fail before implementation**

Run: `node --experimental-strip-types --test tests/deterministic-gate.test.ts`

Expected: FAIL because gate modules are absent.

- [ ] **Step 3: Implement tree snapshots and diffs**

Hash every regular file using normalized forward-slash relative paths. Exclude `.git/` and the run artifact directory. Reject symlinks. Return sorted `{ path, sha256, bytes }` entries and sorted `added`, `removed`, and `modified` lists.

- [ ] **Step 4: Implement bounded data operations**

Apply all operations to an isolated candidate workspace. Write through a temporary sibling file followed by an atomic rename. Format JSON with two spaces and a terminal newline.

- [ ] **Step 5: Implement the gate checks**

The gate emits these exact check IDs:

```text
schema-complete
action-correct
challenger-compatible
allowed-write-surface
required-artifact
expected-data-state
required-commands
regression-preserved
evidence-supported
no-live-write
```

All ten must pass for `status: "PASS"`. `challenger-compatible` passes only for `CONFIRM`; `ESCALATE` is valid only when the action is `HUMAN_REVIEW`.

- [ ] **Step 6: Run focused and full verification**

```powershell
node --experimental-strip-types --test tests/deterministic-gate.test.ts
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit the trust boundary**

```powershell
git add src/core/tree-snapshot.ts src/core/mutation-engine.ts src/core/deterministic-gate.ts tests/deterministic-gate.test.ts
git commit -m "feat: enforce bounded maintenance decisions"
```

---

### Task 5: Add Recorded and Live Codex Agent Runners

**Files:**
- Create: `src/agents/runner.ts`
- Create: `src/agents/recorded-runner.ts`
- Create: `src/agents/codex-runner.ts`
- Create: `src/agents/prompt-loader.ts`
- Create: `prompts/baseline.md`
- Create: `prompts/maintainer.md`
- Create: `prompts/challenger.md`
- Create: `artifacts/recorded/runner-fixtures.json`
- Test: `tests/agent-runner.test.ts`

**Interfaces:**
- Produces: `AgentRunner.run<T>(request): Promise<AgentResult<T>>`, `RecordedRunner`, `CodexRunner`, `createCodexArgs(request)`, and `loadPrompt(name, variables)`.
- Consumes: JSON schemas from Task 2 and isolated case workspaces from Task 3.

- [ ] **Step 1: Write runner-contract tests**

Define the exact interface:

```ts
export interface AgentRequest<T> {
  runId: string;
  role: "baseline" | "maintainer" | "challenger";
  caseId: string;
  workspace: string;
  prompt: string;
  outputSchemaPath: string;
  model: string;
  timeoutMs: number;
  trajectoryPath: string;
  parse: (value: unknown) => T;
}

export interface AgentResult<T> {
  mode: "live" | "recorded";
  role: AgentRequest<T>["role"];
  model: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number;
  output: T;
  trajectoryPath: string;
  tokenUsage?: { input: number; output: number };
}
```

Test that `RecordedRunner` validates output, writes a JSONL trajectory whose first row is `run.started` and last row is `run.completed`, and always reports `mode: "recorded"`.

- [ ] **Step 2: Verify runner tests fail**

Run: `node --experimental-strip-types --test tests/agent-runner.test.ts`

Expected: FAIL because runners do not exist.

- [ ] **Step 3: Implement the recorded runner**

Load results by `${caseId}:${role}` from `runner-fixtures.json`. Reject missing keys. Parse with the request parser. Write explicit recorded-mode trajectory events; never fabricate live token usage.

- [ ] **Step 4: Test the exact Codex argument vector without invoking Codex**

`createCodexArgs` must produce separate array arguments equivalent to:

```text
exec
--ephemeral
--ignore-user-config
--ignore-rules
--skip-git-repo-check
--json
--sandbox
workspace-write
--model
<model>
--output-schema
<schema>
--cd
<workspace>
-
```

No shell-concatenated command is permitted.

- [ ] **Step 5: Implement the live Codex runner**

Use `node:child_process.spawn` with `shell: false`. Stream the prompt through stdin, stream stdout JSONL verbatim to `trajectoryPath`, keep stderr in a separate `.stderr.log`, enforce timeout with `AbortController`, extract the final structured message from JSONL, validate it, and return the measured result. Preserve nonzero exits and invalid output as typed errors containing paths to both logs.

- [ ] **Step 6: Write bounded prompts**

The baseline prompt receives the objective, public case description, workspace paths, allowed commands, and output contract. It does not mention the five-way route taxonomy explicitly.

The Maintainer prompt receives the evidence ledger, five action definitions, allowed surface, invariants, and requirement to cite evidence IDs.

The Challenger prompt receives the proposal, tree diff, ledger, and policy. It must try to falsify rather than rewrite the proposal.

All prompts state that the workspace is isolated, live actions are prohibited, unsupported success claims are failures, and the final response must match the supplied schema.

- [ ] **Step 7: Run focused and full tests**

```powershell
node --experimental-strip-types --test tests/agent-runner.test.ts
npm test
```

Expected: PASS without making a live model call.

- [ ] **Step 8: Commit agent adapters**

```powershell
git add src/agents prompts artifacts/recorded/runner-fixtures.json tests/agent-runner.test.ts
git commit -m "feat: add reproducible Codex agent runners"
```

---

### Task 6: Implement the Fair Direct-Agent Baseline

**Files:**
- Create: `src/workflows/baseline.ts`
- Create: `src/workflows/approval.ts`
- Create: `scripts/run-case.ts`
- Test: `tests/baseline.test.ts`

**Interfaces:**
- Produces: `runBaseline(input): Promise<WorkflowRun>` and `recordApproval(input): Promise<ApprovalRecord>`.
- Consumes: case loader, snapshots, AgentRunner, BaselineResult schema, oracle only after the agent session, and deterministic gate.

- [ ] **Step 1: Write baseline orchestration tests**

Use `RecordedRunner` and assert this order:

```text
copy workspace
capture before snapshot
invoke baseline once
apply declared data operations
capture after snapshot
load oracle outside agent workspace
run deterministic gate
record simulated approval only when gate passes
write run manifest
```

Assert that the baseline never receives the oracle path or contents.

- [ ] **Step 2: Verify failure before implementation**

Run: `node --experimental-strip-types --test tests/baseline.test.ts`

Expected: FAIL because `runBaseline` is absent.

- [ ] **Step 3: Implement `runBaseline`**

Use parameters:

```ts
interface RunBaselineInput {
  caseDir: string;
  runRoot: string;
  runner: AgentRunner;
  model: string;
  timeoutMs: number;
  approve: boolean;
}
```

Write `manifest.json`, `baseline-result.json`, `before-tree.json`, `after-tree.json`, `gate.json`, `approval.json`, and the trajectory. Return a `WorkflowRun` parsed by `RunManifestSchema`.

- [ ] **Step 4: Implement the CLI**

Support exact arguments:

```text
--case <case-id>
--arm baseline|advanced
--mode recorded|live
--model <model-id>
--timeout-ms <integer>
--approve
--out <directory>
```

Reject unknown arguments and live mode without an explicit model.

- [ ] **Step 5: Run one recorded baseline case**

Run:

```powershell
npm run case -- --case noop-duplicate-news --arm baseline --mode recorded --approve --out artifacts/demo/baseline
```

Expected: a complete run manifest and a labeled recorded trajectory.

- [ ] **Step 6: Run focused and full tests**

```powershell
node --experimental-strip-types --test tests/baseline.test.ts
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit the baseline**

```powershell
git add src/workflows/baseline.ts src/workflows/approval.ts scripts/run-case.ts tests/baseline.test.ts artifacts/demo/baseline
git commit -m "feat: implement fair direct-agent baseline"
```

---

### Task 7: Implement the Evidence-First Maintainer and Challenger Workflow

**Files:**
- Create: `src/workflows/advanced.ts`
- Modify: `scripts/run-case.ts`
- Test: `tests/advanced.test.ts`

**Interfaces:**
- Produces: `runAdvanced(input): Promise<WorkflowRun>`.
- Consumes: evidence ledger, Maintainer runner, mutation engine, tree diff, Challenger runner, oracle-isolated gate, and approval recorder.

- [ ] **Step 1: Write the advanced happy-path test**

Use a fake sequential runner that returns a valid `UPDATE_DATA` proposal followed by `CONFIRM`. Assert exact invocation count 2, role order `["maintainer", "challenger"]`, correct data mutation, all gate checks passing, and simulated approval recorded.

- [ ] **Step 2: Write adversarial workflow tests**

Cover:

- Challenger `REJECT` prevents approval.
- Challenger `ESCALATE` passes only with `HUMAN_REVIEW` and no mutation.
- Maintainer evidence ID not in the ledger fails `evidence-supported`.
- A correct action with an unrelated file modification fails.
- `NO_ACTION` with any changed file fails.

- [ ] **Step 3: Verify focused tests fail**

Run: `node --experimental-strip-types --test tests/advanced.test.ts`

Expected: FAIL because `runAdvanced` is absent.

- [ ] **Step 4: Implement the advanced sequence**

Use parameters identical to `RunBaselineInput`. Write:

```text
evidence.jsonl
maintainer-proposal.json
candidate-diff.json
challenger-verdict.json
gate.json
approval.json
manifest.json
trajectories/maintainer.jsonl
trajectories/challenger.jsonl
```

The Challenger runs after candidate operations and sees the actual diff. The oracle is loaded only after both agent invocations complete.

- [ ] **Step 5: Add advanced CLI routing**

Update `scripts/run-case.ts` so `--arm advanced` invokes `runAdvanced` with the same model and timeout semantics as baseline.

- [ ] **Step 6: Run one recorded advanced case**

```powershell
npm run case -- --case update-official-commitment --arm advanced --mode recorded --approve --out artifacts/demo/advanced
```

Expected: `UPDATE_DATA`, Challenger `CONFIRM`, ten passing gate checks, and a content-addressed manifest.

- [ ] **Step 7: Run focused and full tests**

```powershell
node --experimental-strip-types --test tests/advanced.test.ts
npm test
```

Expected: PASS.

- [ ] **Step 8: Commit advanced workflow**

```powershell
git add src/workflows/advanced.ts scripts/run-case.ts tests/advanced.test.ts artifacts/demo/advanced
git commit -m "feat: add evidence-first maintenance workflow"
```

---

### Task 8: Build and Validate the Twelve-Case Core Evaluation Suite

**Files:**
- Create: the remaining ten core case directories under `cases/` through `noop-filtered-removal/`
- Create: adapter fixtures and tests inside `repair-selector-drift/workspace/`, `repair-json-nesting/workspace/`, and `repair-pagination/workspace/`
- Test: `tests/cases.test.ts`

**Interfaces:**
- Produces: 12 valid core cases with frozen manifests, workspaces, oracles, and provenance.
- Consumes: case schemas, loader, mutation engine, and gate.

- [ ] **Step 1: Write the complete suite-validation test**

Assert that the exact core IDs are present:

```ts
const CORE_CASE_IDS = [
  "update-official-commitment",
  "update-transfer-destination",
  "update-authoritative-rating",
  "repair-selector-drift",
  "repair-json-nesting",
  "repair-pagination",
  "retry-deferred-406",
  "retry-timeout-cache",
  "retry-partial-document",
  "noop-duplicate-news",
  "noop-newer-publication-stale-effective",
  "noop-filtered-removal",
] as const;
```

For each case, load public content, verify all hashes, copy the workspace, load the oracle separately, and assert the expected action distribution is exactly three `UPDATE_DATA`, three `REPAIR_ADAPTER`, three `RETRY_LATER`, and three `NO_ACTION`.

- [ ] **Step 2: Verify the suite test fails with missing cases**

Run: `node --experimental-strip-types --test tests/cases.test.ts`

Expected: FAIL listing the ten absent case IDs.

- [ ] **Step 3: Create the two remaining data-update cases**

`update-transfer-destination`: official destination evidence resolves an existing outbound record; allowed mutation is one destination field and one status field.

`update-authoritative-rating`: a scoped rating provider changes its own rating; a second source retains an older value but has no authority over that field.

- [ ] **Step 4: Create the three adapter-repair cases**

Each workspace contains `adapter.ts`, `fixtures/old.html` or JSON, `fixtures/new.html` or JSON, and `adapter.test.ts`.

- `repair-selector-drift`: semantic `data-athlete-id` remains stable while presentation classes change.
- `repair-json-nesting`: `players` moves under `data.roster` while item semantics remain unchanged.
- `repair-pagination`: a `nextPage` token replaces integer page numbers; the repaired adapter must return all three fixture pages without duplicating records.

The oracle requires `REPAIR_ADAPTER`, permits only `adapter.ts`, and runs both old and new fixture tests.

- [ ] **Step 5: Create the three retry cases**

- `retry-deferred-406`: the source contract marks 406 as expected deferral, the recent cache is valid, and no contradictory source exists.
- `retry-timeout-cache`: a network timeout occurs inside the bounded freshness window.
- `retry-partial-document`: HTTP 200 contains a missing closing marker and a mismatched schema fingerprint.

All require zero changed files and an explicit bounded retry condition.

- [ ] **Step 6: Create the two remaining no-action cases**

- `noop-newer-publication-stale-effective`: publication time is newer but effective time predates the canonical cutoff.
- `noop-filtered-removal`: an athlete disappears only because the observed source is filtered to one position group.

All require zero changed files and specific evidence IDs.

- [ ] **Step 7: Run adapter fixture tests and case validation**

Run each adapter's old and new fixture tests, then:

```powershell
node --experimental-strip-types --test tests/cases.test.ts
npm test
```

Expected: all 12 cases validate and the untouched broken adapters fail only their new fixture test.

- [ ] **Step 8: Commit the core suite**

```powershell
git add cases tests/cases.test.ts
git commit -m "feat: add core maintenance evaluation suite"
```

---

### Task 9: Score Runs and Produce Fair Baseline Comparisons

**Files:**
- Create: `src/evaluation/score-run.ts`
- Create: `src/evaluation/aggregate.ts`
- Create: `src/evaluation/run-evaluation.ts`
- Create: `scripts/evaluate.ts`
- Test: `tests/evaluation.test.ts`

**Interfaces:**
- Produces: `scoreRun(run): EvaluationRow`, `aggregateRows(rows): EvaluationSummary`, `wilsonInterval(successes, total, z = 1.96)`, and `runEvaluation(config)`.
- Consumes: run manifests from Tasks 6-7 and the 12-case suite.

- [ ] **Step 1: Write scoring tests**

`EvaluationRow.safeDecision` is true only when all five conditions are true:

```ts
actionCorrect &&
artifactCorrect &&
noForbiddenMutation &&
regressionPreserved &&
evidenceSupported
```

Test zero denominators, all-pass, all-fail, a harmful write, correct abstention, median duration, total token use, and Wilson intervals.

- [ ] **Step 2: Verify scoring tests fail**

Run: `node --experimental-strip-types --test tests/evaluation.test.ts`

Expected: FAIL because evaluation modules are absent.

- [ ] **Step 3: Implement exact aggregate output**

`summary.json` must include:

```ts
{
  schemaVersion: 1,
  generatedAt: string,
  caseSetHash: string,
  model: string,
  mode: "live" | "recorded",
  trialsPerCase: number,
  arms: {
    baseline: ArmSummary,
    advanced: ArmSummary
  },
  absoluteSdrChange: number,
  unsafeMutationChange: number,
  rows: EvaluationRow[]
}
```

Each `ArmSummary` includes SDR, 95% interval, action accuracy, unsafe mutation rate, correct abstention rate, median duration, token totals, and case count.

- [ ] **Step 4: Implement evaluation orchestration**

Support `--cases core|all|comma-separated`, `--trials`, `--mode`, `--model`, `--timeout-ms`, and `--out`. Execute cases sequentially by default to avoid agents stepping on one another. Preserve every run directory even after failure.

- [ ] **Step 5: Generate a recorded comparison**

```powershell
npm run evaluate -- --cases core --trials 1 --mode recorded --model recorded-fixture --timeout-ms 300000 --out artifacts/evaluation/recorded-core
```

Expected: complete `rows.jsonl`, `summary.json`, and no missing run directories.

- [ ] **Step 6: Run focused and full tests**

```powershell
node --experimental-strip-types --test tests/evaluation.test.ts
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit evaluation harness**

```powershell
git add src/evaluation scripts/evaluate.ts tests/evaluation.test.ts artifacts/evaluation/recorded-core
git commit -m "feat: measure safe maintenance decisions"
```

---

### Task 10: Generate the User-Grade Decision Report and Control Room

**Files:**
- Create: `src/reports/load-artifacts.ts`
- Create: `src/reports/render-decision-report.ts`
- Create: `src/ui/overview-model.ts`
- Create: `src/ui/case-model.ts`
- Modify: `app/page.tsx`
- Create: `app/cases/[caseId]/page.tsx`
- Modify: `app/globals.css`
- Create: `scripts/generate-demo.ts`
- Test: `tests/report.test.ts`
- Test: `tests/ui.test.ts`

**Interfaces:**
- Produces: `renderDecisionReport(runDir): Promise<string>`, `loadOverviewModel(artifactRoot)`, and `loadCaseModel(runDir)`.
- Consumes: recorded evaluation and run artifacts.

- [ ] **Step 1: Read the Beaver Front Office visual-design skill before UI work**

Read the complete skill and only the directly required design reference. Reuse its dark navy, restrained orange, evidence-card hierarchy, responsive behavior, and accessible focus treatment without copying the existing site wholesale.

- [ ] **Step 2: Write report tests**

Assert that a generated report contains:

```text
Recorded evidence
Selected action
Evidence timeline
Maintainer proposal
Challenger verdict
Deterministic checks
Changed files
Residual risk
Approval decision
Artifact hashes
```

Assert that recorded runs never contain the phrase `Live agent result`.

- [ ] **Step 3: Verify report tests fail**

Run: `node --experimental-strip-types --test tests/report.test.ts`

Expected: FAIL because report modules are absent.

- [ ] **Step 4: Implement a self-contained HTML decision report**

Generate semantic HTML with embedded CSS, no external assets, escaped content, visible mode badge, evidence citations, a unified file-diff section, all gate checks, and download-safe UTF-8 output.

- [ ] **Step 5: Write UI-model tests**

Test sorted case cards, baseline/advanced SDR values, harmful-change highlighting, action badges, mode labels, and missing-artifact errors.

- [ ] **Step 6: Implement the control room**

Overview must show:

- baseline versus advanced SDR;
- unsafe mutation counts;
- correct abstentions;
- median time and token use;
- one card per case with baseline and advanced outcome;
- a prominent link to the flagship case.

Case detail must show the evidence timeline, selected action, proposal, challenger, checks, diff, approval, and report download path.

- [ ] **Step 7: Generate demo artifacts and verify the UI**

```powershell
npm run demo
npm run build
npm run dev
```

Inspect `/` and one `/cases/<caseId>` route at desktop and narrow viewport. Confirm keyboard focus, no overflow, no blank states, and no mode-label ambiguity.

- [ ] **Step 8: Run focused and full tests**

```powershell
node --experimental-strip-types --test tests/report.test.ts tests/ui.test.ts
npm test
npm run lint
npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit the product surface**

```powershell
git add src/reports src/ui app scripts/generate-demo.ts tests/report.test.ts tests/ui.test.ts artifacts/demo
git commit -m "feat: add evidence maintainer control room"
```

---

### Task 11: Add the Three Human-Review Cases and Run the Experiment Changelog

**Files:**
- Create: `cases/review-conflicting-authorities/`
- Create: `cases/review-name-collision/`
- Create: `cases/review-reintroduced-identity/`
- Modify: `tests/cases.test.ts`
- Create: `docs/improvement-changelog.md`
- Create: `docs/evaluation.md`
- Create: `docs/trajectory-index.md`
- Create: `artifacts/evaluation/final/`
- Test: existing full suite

**Interfaces:**
- Produces: 15-case final suite, measured iteration history, representative trajectory index, and final comparison artifacts.
- Consumes: all previous tasks.

- [ ] **Step 1: Add the three adjudicated review cases**

- `review-conflicting-authorities`: official roster and an official transfer announcement conflict at the same cutoff; required action `HUMAN_REVIEW` and zero mutation.
- `review-name-collision`: two people share a normalized name and one source lacks a stable ID; required action `HUMAN_REVIEW` and minimum information request for birth year or roster ID.
- `review-reintroduced-identity`: a dropped and reintroduced display name may represent a new occurrence; required action `HUMAN_REVIEW` until occurrence identity is resolved.

Each oracle requires Challenger `ESCALATE`, a non-empty minimum-information request, and zero changed files.

- [ ] **Step 2: Expand suite validation to exactly 15 cases**

Run: `node --experimental-strip-types --test tests/cases.test.ts`

Expected: PASS with distribution 3 per action class.

- [ ] **Step 3: Run an initial two-case live pilot**

Use one easy data-update case and the flagship combined review case with the same model for both arms. Capture command, model, exact commit, start/end times, trajectories, cost where available, and complete failures.

- [ ] **Step 4: Record Iteration 0 in the changelog**

Use columns:

```text
Stage | Change | Hypothesis | Cases | SDR | Unsafe mutations | Time | Tokens | Decision
```

Iteration 0 is the direct-agent baseline. Do not summarize selected successful cases; link the complete result artifact.

- [ ] **Step 5: Run controlled architecture iterations**

Run the same development subset after each isolated change:

1. explicit action classification;
2. evidence ledger and authority scope;
3. temporal and identity history;
4. deterministic preservation gate;
5. independent Challenger;
6. a three-or-more-agent decomposition;
7. removal of the larger decomposition if it raises conflict, latency, or cost;
8. evidence-backed abstention and minimum-information escalation.

Record measured result and keep/revise/remove decision for every iteration.

- [ ] **Step 6: Freeze the final experiment inputs**

Record the Git commit, prompt hashes, schema hashes, case-set hash, model, CLI version, timeout, and trials per case in `docs/evaluation.md`. No prompt or case edits occur after this freeze without invalidating and rerunning the final comparison.

- [ ] **Step 7: Run the final baseline and advanced evaluation**

Target three trials per case. If deadline pressure forces fewer, run at least one complete trial for all 15 cases before adding repetitions. Preserve all results.

```powershell
npm run evaluate -- --cases all --trials 3 --mode live --model gpt-5.6-terra --timeout-ms 1200000 --out artifacts/evaluation/final
```

Expected target: advanced SDR at least 0.85, baseline SDR at most 0.55, zero advanced unsafe mutations, and at least 0.30 absolute SDR improvement. Report actual values even if targets are missed.

- [ ] **Step 8: Build the trajectory index**

For every representative trajectory, list role, case, arm, trial, mode, model, prompt hash, output-schema hash, trajectory path, result path, duration, token use when reported, and outcome. Include at least one success, one failure, one retry, one correct no-action, and one human-review escalation.

- [ ] **Step 9: Commit final cases and experimental evidence**

```powershell
git add cases tests/cases.test.ts docs/improvement-changelog.md docs/evaluation.md docs/trajectory-index.md artifacts/evaluation/final
git commit -m "feat: complete evidence maintainer evaluation"
```

---

### Task 12: Reproduce, Document, Record, and Package the Submission

**Files:**
- Create: `README.md`
- Create: `docs/architecture.md`
- Create: `docs/reproduction.md`
- Create: `docs/video-script.md`
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `LICENSE`
- Create: `scripts/verify-submission.ts`
- Modify: `package.json`
- Create: final archive outside the repository working tree

**Interfaces:**
- Produces: complete challenge deliverables and a verified archive.
- Consumes: frozen final commit, results, reports, trajectories, and specification.

- [ ] **Step 1: Write the submission verifier test contract**

`verify-submission.ts` must fail unless all of these exist and parse:

```text
README.md
docs/architecture.md
docs/evaluation.md
docs/improvement-changelog.md
docs/reproduction.md
docs/trajectory-index.md
docs/video-script.md
artifacts/evaluation/final/summary.json
artifacts/demo/decision-report.html
```

It must verify 15 case hashes, representative trajectories for all three roles, recorded/live truth labels, no `.env` or credential-like file, no absolute local paths in public documentation, no missing artifact references, and a clean Git status.

- [ ] **Step 2: Write the README around the four judging questions**

Include:

- who has the problem;
- why the bottleneck matters;
- how the agent solves it;
- how another person reproduces it;
- baseline and advanced commands;
- headline measured results with artifact links;
- pre-existing versus competition work;
- runtime and cost;
- limitations;
- main failure mode and hot take.

- [ ] **Step 3: Write architecture and reproduction documents**

`architecture.md` describes evidence flow, agent boundaries, deterministic gate, sandbox, approval, artifact lineage, and why two roles were retained.

`reproduction.md` gives exact Windows, macOS/Linux, and Docker commands; required versions; expected filenames; approximate runtime; offline and live distinctions; and troubleshooting for missing Codex auth.

- [ ] **Step 4: Add the offline Docker path**

Use `node:24-bookworm-slim`, `npm ci`, `npm run build`, and a non-root runtime user. The container runs recorded demo/evaluation without credentials. Do not install or invoke Codex in the container.

- [ ] **Step 5: Run clean-environment verification**

From a new temporary clone of the exact commit:

```powershell
npm ci
npm run schemas
npm test
npm run demo
npm run build
docker build -t evidence-maintainer:submission .
docker run --rm evidence-maintainer:submission npm run demo
```

Expected: all commands exit 0 and generated artifact hashes match the documented recorded result.

- [ ] **Step 6: Run the final submission verifier**

```powershell
node --experimental-strip-types scripts/verify-submission.ts
```

Expected: `SUBMISSION_READY` and exit code 0.

- [ ] **Step 7: Record the five-minute video from the frozen commit**

Follow `docs/video-script.md` exactly:

```text
0:00-0:35 user problem and real product
0:35-1:15 fair baseline failure
1:15-3:10 evidence-first run
3:10-4:05 user-grade result and proof
4:05-4:40 complete measured comparison
4:40-5:00 removed experiment and hot take
```

Show the commit hash, mode label, and final result paths on screen. Do not show credentials or private material.

- [ ] **Step 8: Commit documentation and freeze**

```powershell
git add README.md docs Dockerfile .dockerignore LICENSE scripts/verify-submission.ts package.json package-lock.json
git commit -m "docs: package frontier challenge submission"
npm run verify
node --experimental-strip-types scripts/verify-submission.ts
git status --short
```

Expected: all verification passes and status is clean.

- [ ] **Step 9: Create and inspect the final archive**

Use `git archive` from the exact final commit, add the video only if the portal requires it inside the archive, list archive contents, extract into a temporary directory, and rerun the offline reproduction commands there. Record archive SHA-256 in the submission notes.

---

## Plan Self-Review Checklist

- [x] Every required spec section maps to at least one task.
- [x] All five action classes have three adjudicated cases.
- [x] Baseline and advanced workflows share model, case bytes, schema, and timeout.
- [x] Oracle data is excluded from agent workspaces.
- [x] Recorded versus live truth labels are explicit in runner, UI, report, and docs.
- [x] Maintainer and Challenger interfaces use the same schema names everywhere.
- [x] The deterministic gate owns final pass/fail and approval eligibility.
- [x] The control room consumes artifacts rather than hidden in-memory state.
- [x] The final archive contains code, changelog, reproduction guide, video script, and trajectories.
- [x] No task requires live production mutation.
