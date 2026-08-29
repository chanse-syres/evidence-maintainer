import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { AgentRequest, AgentResult, AgentRunner } from "../src/agents/runner.ts";
import { sha256Text } from "../src/core/canonical-json.ts";
import {
  CaseOracleV4Schema,
  DecisionPackageSchema,
  PolicyV4Schema,
  SourceObservationSchema,
  type DecisionPackage,
} from "../src/core/schemas.ts";
import { runBaseline } from "../src/workflows/baseline.ts";

const CASE_ID = "baseline-v4-case";

const observation = SourceObservationSchema.parse({
  id: "obs-official",
  sourceId: "official-register",
  observedAt: "2026-08-29T19:30:00.000Z",
  effectiveAt: "2026-08-29T19:00:00.000Z",
  authorityScope: ["status"],
  subjectId: "subject-1",
  kind: "status-event",
  status: 200,
  contentType: "application/json",
  schemaFingerprint: "register-v1",
  facts: { status: "active" },
});

const policy = PolicyV4Schema.parse({
  schemaVersion: 2,
  cutoff: "2026-08-29T20:00:00.000Z",
  authorityByField: { status: "official-register" },
  authorityValidity: [{
    mode: "SNAPSHOT_MAX_AGE",
    sourceId: "official-register",
    authorityScope: "status",
    maxAgeMinutes: 60,
  }],
  retryLimit: 3,
  invariants: ["Stable identity is preserved"],
  rules: ["Use official authority"],
});

function noActionDecision(): DecisionPackage {
  return DecisionPackageSchema.parse({
    schemaVersion: 3,
    caseId: CASE_ID,
    action: "NO_ACTION",
    firstMaterialDivergence: "The official register controls the outcome.",
    failureOwner: "canonical-state",
    evidenceAssessments: [{
      evidenceId: "obs-official",
      factPath: "facts.status",
      disposition: "SUPPORT",
      reason: "The official source owns status.",
    }],
    affectedEntities: ["subject-1"],
    affectedFiles: [],
    operations: [],
    preservedInvariants: ["Stable identity is preserved"],
    unresolvedUncertainty: [],
    reviewRequest: null,
    retryPlan: null,
    summary: "No maintenance change is required.",
  });
}

async function writeCase(extraWorkspaceFiles: Record<string, string> = {}): Promise<string> {
  const caseDir = await mkdtemp(join(tmpdir(), "baseline-v4-case-"));
  const files: Record<string, string> = {
    "input/canonical.json": `${JSON.stringify([{ id: "subject-1", status: "active" }], null, 2)}\n`,
    "input/observations.json": `${JSON.stringify([observation], null, 2)}\n`,
    "input/policy.json": `${JSON.stringify(policy, null, 2)}\n`,
    ...extraWorkspaceFiles,
  };
  for (const [path, content] of Object.entries(files)) {
    const target = join(caseDir, "workspace", ...path.split("/"));
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  await writeFile(join(caseDir, "case.json"), `${JSON.stringify({
    schemaVersion: 1,
    id: CASE_ID,
    title: "Direct V4 baseline fixture",
    description: "A public case for the direct decision arm.",
    sourceClass: "SYNTHETIC",
    createdFrom: "Unit test",
    agentVisibleFiles: Object.keys(files).sort().map((path) => `workspace/${path}`),
    allowedWritePaths: [],
    requiredCommands: [],
    provenance: Object.entries(files).map(([path, content]) => ({
      sourceId: `fixture-${path.replaceAll("/", "-")}`,
      path: `workspace/${path}`,
      sourceClass: "SYNTHETIC",
      capturedAt: "2026-08-29T19:30:00.000Z",
      transformation: "Unit fixture",
      permissionBasis: "Created for this benchmark",
      sha256: sha256Text(content),
    })),
  }, null, 2)}\n`, "utf8");
  await writeFile(join(caseDir, "oracle.json"), `${JSON.stringify(CaseOracleV4Schema.parse({
    schemaVersion: 3,
    caseId: CASE_ID,
    expectedAction: "NO_ACTION",
    requiredEvidenceSourceBundles: [["official-register"]],
    forbiddenEvidenceClaims: [],
    allowedChangedFiles: [],
    expectedCommandExitCodes: {},
    hiddenProbePath: null,
    requiredAuthoritySources: ["official-register"],
  }), null, 2)}\n`, "utf8");
  return caseDir;
}

class InspectingRunner implements AgentRunner {
  readonly requests: AgentRequest<unknown>[] = [];
  private readonly output: DecisionPackage;

  constructor(output = noActionDecision()) {
    this.output = output;
  }

  async run<T>(request: AgentRequest<T>): Promise<AgentResult<T>> {
    this.requests.push(request as AgentRequest<unknown>);
    assert.equal(request.role, "baseline");
    assert.equal(request.outputSchemaPath, resolve("schemas", "decision-package.schema.json"));
    assert.doesNotMatch(request.prompt, /expectedAction|oracle\.json|allowedChangedFiles/);
    assert.match(request.prompt, /obs-official/);
    assert.match(request.prompt, /canonical/);
    assert.match(request.prompt, /authorityValidity/);
    await assert.rejects(() => access(join(request.workspace, "oracle.json")));
    const output = request.parse(this.output);
    const startedAt = "2026-08-29T20:01:00.000Z";
    const finishedAt = "2026-08-29T20:01:01.000Z";
    await mkdir(join(request.trajectoryPath, ".."), { recursive: true });
    await writeFile(request.trajectoryPath, `${JSON.stringify({
      type: "agent.output",
      role: request.role,
      output,
    })}\n`, "utf8");
    return {
      mode: "recorded",
      role: request.role,
      model: request.model,
      startedAt,
      finishedAt,
      durationMs: 1_000,
      exitCode: 0,
      output,
      trajectoryPath: request.trajectoryPath,
    };
  }
}

test("baseline source contains no challenge-arm adjudication path", async () => {
  const source = await readFile(resolve("src", "workflows", "baseline.ts"), "utf8");
  assert.doesNotMatch(source, /Challenger|oracle\.requiredChallenger|challenger-verdict/);
});

test("baseline runs one direct DecisionPackage session through the shared finalizer", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-baseline-"));
  const runner = new InspectingRunner();
  const run = await runBaseline({
    caseDir: await writeCase(),
    runRoot: root,
    runner,
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: true,
  });
  assert.deepEqual(runner.requests.map((request) => request.role), ["baseline"]);
  assert.equal(run.arm, "baseline");
  assert.equal(run.mode, "recorded");
  assert.equal(run.outcome, "PASS");
  const approval = JSON.parse(await readFile(join(root, "approval.json"), "utf8"));
  const gate = JSON.parse(await readFile(join(root, "gate.json"), "utf8"));
  const decision = JSON.parse(await readFile(join(root, "final-decision.json"), "utf8"));
  assert.equal(approval.decision, "APPROVED");
  assert.equal(gate.status, "PASS");
  assert.equal(decision.action, "NO_ACTION");
  assert.equal("arm" in decision, false);
  assert.equal("executedCommands" in decision, false);
  await assert.rejects(() => access(join(root, "baseline-result.json")));
  assert.ok(run.artifactSha256["gate.json"]);
  assert.ok(run.artifactSha256["final-decision.json"]);
  await access(join(root, "manifest.json"));
  await access(join(root, "before-tree.json"));
  await access(join(root, "after-tree.json"));
  await access(join(root, "trajectories", "baseline.jsonl"));
});

test("baseline approval remains withheld when the operator did not approve", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-baseline-no-approval-"));
  await runBaseline({
    caseDir: await writeCase(),
    runRoot: root,
    runner: new InspectingRunner(),
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: false,
  });
  const approval = JSON.parse(await readFile(join(root, "approval.json"), "utf8"));
  assert.equal(approval.decision, "NOT_REQUESTED");
});

test("baseline receives the complete agent-visible workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-baseline-workspace-snapshot-"));
  const runner = new InspectingRunner();
  await runBaseline({
    caseDir: await writeCase({
      "adapter.ts": "export function extractPlayers(value) { return value.roster; }\n",
      "adapter.test.ts": 'const fixture = { "roster": [] };\n',
    }),
    runRoot: root,
    runner,
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: true,
  });
  assert.match(runner.requests[0].prompt, /export function extractPlayers/);
  assert.match(runner.requests[0].prompt, /\\\"roster\\\"/);
  assert.match(runner.requests[0].prompt, /adapter\.test\.ts/);
});
