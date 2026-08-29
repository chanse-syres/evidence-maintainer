import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentRequest, AgentResult, AgentRunner } from "../src/agents/runner.ts";
import { sha256Text } from "../src/core/canonical-json.ts";
import {
  CaseOracleV4Schema,
  ChallengerCritiqueSchema,
  DecisionPackageSchema,
  PolicyV4Schema,
  SourceObservationSchema,
  type ChallengerCritique,
  type DecisionPackage,
} from "../src/core/schemas.ts";
import { snapshotTree } from "../src/core/tree-snapshot.ts";
import { runAdvanced } from "../src/workflows/advanced.ts";

const CASE_ID = "advanced-v4-case";
const usage = { input: 100, cachedInput: 20, output: 10 };

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

function updateDecision(status: string): DecisionPackage {
  return DecisionPackageSchema.parse({
    schemaVersion: 3,
    caseId: CASE_ID,
    action: "UPDATE_DATA",
    firstMaterialDivergence: "The official register controls status.",
    failureOwner: "canonical-state",
    evidenceAssessments: [{
      evidenceId: "obs-official",
      factPath: "facts.status",
      disposition: "SUPPORT",
      reason: "The official source owns status.",
    }],
    affectedEntities: ["subject-1"],
    affectedFiles: ["input/canonical.json"],
    operations: [{
      kind: "SET_RECORD_FIELDS",
      file: "input/canonical.json",
      recordId: "subject-1",
      assignments: [{ field: "status", value: status }],
    }],
    preservedInvariants: ["Stable identity is preserved"],
    unresolvedUncertainty: [],
    reviewRequest: null,
    retryPlan: null,
    summary: `Set the canonical status to ${status}.`,
  });
}

function critique(
  recommendation: "ACCEPT_DRAFT" | "REVISE_DRAFT",
  finding = "",
): ChallengerCritique {
  return ChallengerCritiqueSchema.parse({
    schemaVersion: 2,
    caseId: CASE_ID,
    recommendation,
    evidenceIds: ["obs-official"],
    critiqueCategories: finding ? ["ARTIFACT"] : [],
    findings: finding ? [finding] : [],
    summary: finding || "The draft is consistent with the public evidence.",
  });
}

async function writeCase(): Promise<string> {
  const caseDir = await mkdtemp(join(tmpdir(), "advanced-v4-case-"));
  const files: Record<string, string> = {
    "adapter.ts": "export function statusOf(value) { return value.status; }\n",
    "input/canonical.json": `${JSON.stringify([{ id: "subject-1", status: "pending", name: "Sam" }], null, 2)}\n`,
    "input/observations.json": `${JSON.stringify([observation], null, 2)}\n`,
    "input/policy.json": `${JSON.stringify(policy, null, 2)}\n`,
  };
  for (const [path, content] of Object.entries(files)) {
    const target = join(caseDir, "workspace", ...path.split("/"));
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  await writeFile(join(caseDir, "case.json"), `${JSON.stringify({
    schemaVersion: 1,
    id: CASE_ID,
    title: "Propose challenge revise fixture",
    description: "A V4 case with a bounded canonical update.",
    sourceClass: "SYNTHETIC",
    createdFrom: "Unit test",
    agentVisibleFiles: Object.keys(files).sort().map((path) => `workspace/${path}`),
    allowedWritePaths: ["input/canonical.json"],
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
    expectedAction: "UPDATE_DATA",
    requiredEvidenceSourceBundles: [["official-register"]],
    forbiddenEvidenceClaims: [],
    allowedChangedFiles: ["input/canonical.json"],
    expectedCommandExitCodes: {},
    hiddenProbePath: null,
    requiredRecordProperties: [{
      file: "input/canonical.json",
      recordId: "subject-1",
      properties: { status: "active" },
    }],
    preservedRecordProperties: [{
      file: "input/canonical.json",
      recordId: "subject-1",
      propertyPaths: ["name"],
    }],
  }), null, 2)}\n`, "utf8");
  return caseDir;
}

class SequenceRunner implements AgentRunner {
  readonly requests: AgentRequest<unknown>[] = [];
  readonly workspaceHashes: string[] = [];
  private readonly outputs: unknown[];
  private readonly sideEffect?: (request: AgentRequest<unknown>) => Promise<void>;
  private readonly usages: Array<typeof usage | undefined>;

  constructor(
    outputs: unknown[],
    sideEffect?: (request: AgentRequest<unknown>) => Promise<void>,
    usages: Array<typeof usage | undefined> = [],
  ) {
    this.outputs = [...outputs];
    this.sideEffect = sideEffect;
    this.usages = [...usages];
  }

  async run<T>(request: AgentRequest<T>): Promise<AgentResult<T>> {
    this.requests.push(request as AgentRequest<unknown>);
    this.workspaceHashes.push((await snapshotTree(request.workspace)).sha256);
    await assert.rejects(() => access(join(request.workspace, "oracle.json")));
    if (this.sideEffect) await this.sideEffect(request as AgentRequest<unknown>);
    const output = request.parse(this.outputs.shift());
    const at = "2026-08-29T20:00:00.000Z";
    await writeFile(request.trajectoryPath, `${JSON.stringify({
      type: "agent.output",
      mode: "recorded",
      role: request.role,
      output,
    })}\n`, "utf8");
    const tokenUsage = this.usages.shift();
    return {
      mode: "recorded",
      role: request.role,
      model: request.model,
      startedAt: at,
      finishedAt: at,
      durationMs: 0,
      exitCode: 0,
      output,
      trajectoryPath: request.trajectoryPath,
      tokenUsage,
      ...(tokenUsage ? {
        tokenUsageSource: "TRAJECTORY_TURN_COMPLETED" as const,
        trajectoryAggregateCaptured: true,
        proxyRequestUsageCoverage: {
          requestCount: 1,
          accountedRequestCount: 0,
          complete: false,
        },
      } : {}),
    };
  }
}

test("advanced runs maintainer, challenger, reviser and applies only the revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-advanced-happy-"));
  const draft = updateDecision("draft-only");
  const review = critique("REVISE_DRAFT", "The final artifact must use the observed active status.");
  const revision = updateDecision("active");
  const runner = new SequenceRunner([draft, review, revision]);
  const run = await runAdvanced({
    caseDir: await writeCase(),
    runRoot: root,
    runner,
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: true,
  });

  assert.deepEqual(runner.requests.map((request) => request.role), ["maintainer", "challenger", "reviser"]);
  assert.equal(new Set(runner.workspaceHashes).size, 1);
  assert.equal(run.outcome, "PASS");
  const canonical = JSON.parse(await readFile(join(root, "workspace", "input", "canonical.json"), "utf8"));
  assert.equal(canonical[0].status, "active");
  assert.notEqual(canonical[0].status, "draft-only");
  assert.equal(JSON.parse(await readFile(join(root, "draft-decision.json"), "utf8")).summary, draft.summary);
  assert.equal(JSON.parse(await readFile(join(root, "challenger-critique.json"), "utf8")).summary, review.summary);
  assert.equal(JSON.parse(await readFile(join(root, "final-decision.json"), "utf8")).summary, revision.summary);
  await assert.rejects(() => access(join(root, "candidate-diff.json")));
  await assert.rejects(() => access(join(root, "challenger-verdict.json")));
  assert.equal(JSON.parse(await readFile(join(root, "approval.json"), "utf8")).decision, "APPROVED");
});

test("critique content cannot change external scoring when the final package is fixed", async () => {
  const caseDir = await writeCase();
  const firstRoot = await mkdtemp(join(tmpdir(), "evidence-advanced-critique-a-"));
  const secondRoot = await mkdtemp(join(tmpdir(), "evidence-advanced-critique-b-"));
  const final = updateDecision("active");
  await runAdvanced({
    caseDir,
    runRoot: firstRoot,
    runner: new SequenceRunner([updateDecision("draft-only"), critique("ACCEPT_DRAFT"), final]),
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: true,
  });
  await runAdvanced({
    caseDir,
    runRoot: secondRoot,
    runner: new SequenceRunner([
      updateDecision("draft-only"),
      critique("REVISE_DRAFT", "This deliberately different critique is advisory."),
      final,
    ]),
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: true,
  });
  assert.deepEqual(
    JSON.parse(await readFile(join(firstRoot, "gate.json"), "utf8")),
    JSON.parse(await readFile(join(secondRoot, "gate.json"), "utf8")),
  );
});

test("all sessions receive identical public bytes and only later roles receive process artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-advanced-public-bytes-"));
  const runner = new SequenceRunner([
    updateDecision("draft-only"),
    critique("REVISE_DRAFT", "Use the observed value."),
    updateDecision("active"),
  ]);
  await runAdvanced({
    caseDir: await writeCase(),
    runRoot: root,
    runner,
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: true,
  });
  for (const request of runner.requests) {
    assert.match(request.prompt, /export function statusOf/);
    assert.match(request.prompt, /obs-official/);
    assert.doesNotMatch(request.prompt, /requiredRecordProperties|expectedAction|oracle\.json/);
  }
  assert.doesNotMatch(runner.requests[0].prompt, /draft-only|Use the observed value/);
  assert.match(runner.requests[1].prompt, /draft-only/);
  assert.doesNotMatch(runner.requests[1].prompt, /Use the observed value/);
  assert.match(runner.requests[2].prompt, /draft-only/);
  assert.match(runner.requests[2].prompt, /Use the observed value/);
});

test("advanced binds token usage from all three model sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-advanced-token-usage-"));
  const run = await runAdvanced({
    caseDir: await writeCase(),
    runRoot: root,
    runner: new SequenceRunner(
      [updateDecision("draft-only"), critique("REVISE_DRAFT", "Revise it."), updateDecision("active")],
      undefined,
      [usage, usage, usage],
    ),
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: true,
  });
  assert.deepEqual(run.tokenUsage, { input: 300, cachedInput: 60, output: 30 });
  assert.deepEqual(run.tokenUsageAccounting?.sessions.map((session) => session.role), [
    "maintainer",
    "challenger",
    "reviser",
  ]);
});

test("a model session cannot mutate the shared public workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-advanced-public-write-"));
  const caseDir = await writeCase();
  const runner = new SequenceRunner(
    [updateDecision("draft-only"), critique("REVISE_DRAFT", "Revise it."), updateDecision("active")],
    async (request) => {
      if (request.role === "challenger") {
        await writeFile(join(request.workspace, "input", "canonical.json"), "[]\n", "utf8");
      }
    },
  );
  await assert.rejects(() => runAdvanced({
    caseDir,
    runRoot: root,
    runner,
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: true,
  }), /read-only public workspace/i);
});
