import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ModelExecutionError,
  type AgentRequest,
  type AgentResult,
  type AgentRunner,
} from "../src/agents/runner.ts";
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
import { aggregateRows, median, wilsonInterval } from "../src/evaluation/aggregate.ts";
import { estimateUsageCost } from "../src/evaluation/cost.ts";
import { reconstructUsage } from "../src/evaluation/combine-evaluations.ts";
import { buildTokenUsageAccounting } from "../src/evaluation/token-usage-accounting.ts";
import { resolveCaseSelection, runEvaluation } from "../src/evaluation/run-evaluation.ts";
import { scoreRun } from "../src/evaluation/score-run.ts";
import {
  caseBalancedMean,
  mean,
  quantileType7,
  sampleStandardDeviation,
  sampleVariance,
  stratifiedNestedBootstrap,
} from "../src/evaluation/statistics.ts";
import { parseEvaluateArgs } from "../scripts/evaluate.ts";

const blockingCheckIds = [
  "action-correct",
  "artifact-correct",
  "no-forbidden-mutation",
  "required-commands-passed",
  "source-coverage",
  "contradiction-free",
] as const;

const allCheckIds = [...blockingCheckIds, "annotation-aligned"] as const;

function noActionDecision(caseId: string): DecisionPackage {
  return DecisionPackageSchema.parse({
    schemaVersion: 3,
    caseId,
    action: "NO_ACTION",
    firstMaterialDivergence: "The current authoritative record already matches the observation.",
    failureOwner: "canonical-state",
    evidenceAssessments: [{
      evidenceId: `obs-${caseId}`,
      factPath: "facts.status",
      disposition: "SUPPORT",
      reason: "The official register is authoritative for status.",
    }],
    affectedEntities: [`subject-${caseId}`],
    affectedFiles: [],
    operations: [],
    preservedInvariants: ["Stable identity is preserved"],
    unresolvedUncertainty: [],
    reviewRequest: null,
    retryPlan: null,
    summary: "No maintenance change is required.",
  });
}

function advisoryCritique(caseId: string): ChallengerCritique {
  return ChallengerCritiqueSchema.parse({
    schemaVersion: 2,
    caseId,
    recommendation: "ACCEPT_DRAFT",
    evidenceIds: [`obs-${caseId}`],
    critiqueCategories: [],
    findings: [],
    summary: "The draft is consistent with the public evidence.",
  });
}

async function makeRun(input: {
  arm: "baseline" | "advanced";
  failures?: string[];
  durationMs?: number;
  tokenUsage?: { input: number; cachedInput: number; output: number } | null;
  expectedAction?: string;
}) {
  const root = await mkdtemp(join(tmpdir(), "evidence-score-run-"));
  const trajectoryPaths = input.arm === "baseline"
    ? ["trajectories/baseline.jsonl"]
    : [
        "trajectories/maintainer.jsonl",
        "trajectories/challenger.jsonl",
        "trajectories/reviser.jsonl",
      ];
  const roles = input.arm === "baseline"
    ? ["baseline"] as const
    : ["maintainer", "challenger", "reviser"] as const;
  const usageAccounting = input.tokenUsage
    ? buildTokenUsageAccounting(roles.map((role, index) => ({
        role,
        usage: index === 0 ? input.tokenUsage! : { input: 0, cachedInput: 0, output: 0 },
        source: "TRAJECTORY_TURN_COMPLETED",
        trajectoryPath: trajectoryPaths[index],
        trajectoryAggregateCaptured: true,
        proxyRequestCoverage: { requestCount: 1, accountedRequestCount: 0, complete: false },
      })))
    : null;
  const failures = new Set(input.failures ?? []);
  const blockingFailure = blockingCheckIds.some((id) => failures.has(id));
  const manifest = {
    schemaVersion: 2,
    projectId: "evidence-maintainer",
    runId: `${input.arm}-run`,
    caseId: "case-1",
    arm: input.arm,
    mode: "recorded",
    model: "fixture",
    startedAt: "2026-08-29T20:00:00.000Z",
    finishedAt: "2026-08-29T20:00:01.000Z",
    durationMs: input.durationMs ?? 1_000,
    timeoutMs: 10_000,
    promptSha256: "a".repeat(64),
    outputSchemaSha256: "b".repeat(64),
    caseSetSha256: "c".repeat(64),
    trajectoryPaths,
    proxyLedgerPaths: [],
    artifactSha256: {},
    tokenUsage: usageAccounting?.tokenUsage ?? null,
    tokenUsageAccounting: usageAccounting?.tokenUsageAccounting ?? null,
    runtimeImages: null,
    outcome: blockingFailure ? "FAIL" : "PASS",
  };
  const gate = {
    status: manifest.outcome,
    checks: allCheckIds.map((id) => ({
      id,
      passed: !failures.has(id),
      blocking: id !== "annotation-aligned",
      summary: id,
      details: [],
    })),
    changedFiles: [],
    diff: { added: [], removed: [], modified: [] },
  };
  await writeFile(join(root, "manifest.json"), JSON.stringify(manifest), "utf8");
  await writeFile(join(root, "gate.json"), JSON.stringify(gate), "utf8");
  await writeFile(join(root, "final-decision.json"), JSON.stringify(noActionDecision("case-1")), "utf8");
  return { root, expectedAction: input.expectedAction ?? "NO_ACTION" };
}

async function writeV4Case(caseRoot: string, caseId: string): Promise<void> {
  const caseDir = join(caseRoot, caseId);
  const observation = SourceObservationSchema.parse({
    id: `obs-${caseId}`,
    sourceId: "official-register",
    observedAt: "2026-08-29T19:30:00.000Z",
    effectiveAt: "2026-08-29T19:00:00.000Z",
    authorityScope: ["status"],
    subjectId: `subject-${caseId}`,
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
  const files: Record<string, string> = {
    "input/canonical.json": `${JSON.stringify([{ id: `subject-${caseId}`, status: "active" }], null, 2)}\n`,
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
    id: caseId,
    title: `V4 evaluation fixture ${caseId}`,
    description: "A symmetric no-action evaluation fixture.",
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
    caseId,
    expectedAction: "NO_ACTION",
    requiredEvidenceSourceBundles: [["official-register"]],
    forbiddenEvidenceClaims: [],
    allowedChangedFiles: [],
    expectedCommandExitCodes: {},
    hiddenProbePath: null,
    requiredAuthoritySources: ["official-register"],
  }), null, 2)}\n`, "utf8");
}

class V4Runner implements AgentRunner {
  private readonly mode: "live" | "recorded";
  private readonly failure: "MODEL" | "INFRASTRUCTURE" | null;

  constructor(
    mode: "live" | "recorded" = "recorded",
    failure: "MODEL" | "INFRASTRUCTURE" | null = null,
  ) {
    this.mode = mode;
    this.failure = failure;
  }

  async run<T>(request: AgentRequest<T>): Promise<AgentResult<T>> {
    await mkdir(join(request.trajectoryPath, ".."), { recursive: true });
    if (this.failure) {
      await writeFile(
        request.trajectoryPath,
        `${JSON.stringify({ usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 } })}\n`,
        "utf8",
      );
      if (this.failure === "MODEL") {
        throw new ModelExecutionError("INVALID_OUTPUT", "model produced invalid output");
      }
      throw new Error("filesystem unavailable");
    }
    const rawOutput = request.role === "challenger"
      ? advisoryCritique(request.caseId)
      : noActionDecision(request.caseId);
    const output = request.parse(rawOutput);
    await writeFile(
      request.trajectoryPath,
      `${JSON.stringify({ type: "agent.output", role: request.role, output })}\n`,
      "utf8",
    );
    const at = "2026-08-29T20:01:00.000Z";
    return {
      mode: this.mode,
      role: request.role,
      model: request.model,
      startedAt: at,
      finishedAt: at,
      durationMs: 0,
      exitCode: 0,
      output,
      trajectoryPath: request.trajectoryPath,
      tokenUsage: { input: 100, cachedInput: 20, output: 10 },
      tokenUsageSource: "TRAJECTORY_TURN_COMPLETED",
      trajectoryAggregateCaptured: true,
      proxyRequestUsageCoverage: { requestCount: 1, accountedRequestCount: 0, complete: false },
    };
  }
}

test("ODI is the conjunction of six blocking semantic components", async () => {
  const allPassRun = await makeRun({ arm: "advanced" });
  const allPass = await scoreRun(allPassRun.root, { expectedAction: allPassRun.expectedAction });
  assert.equal(allPass.operationalDecisionIntegrity, true);
  assert.equal(allPass.failureClass, "NONE");

  for (const failure of blockingCheckIds) {
    const fixture = await makeRun({ arm: "advanced", failures: [failure] });
    const row = await scoreRun(fixture.root, { expectedAction: fixture.expectedAction });
    assert.equal(row.operationalDecisionIntegrity, false, `${failure} must block ODI`);
    assert.equal(row.failureClass, "GENUINE_SEMANTIC_FAILURE");
  }
});

test("annotation alignment is diagnostic and does not change ODI", async () => {
  const fixture = await makeRun({ arm: "advanced", failures: ["annotation-aligned"] });
  const row = await scoreRun(fixture.root, { expectedAction: fixture.expectedAction });
  assert.equal(row.annotationAligned, false);
  assert.equal(row.operationalDecisionIntegrity, true);
  assert.equal(row.failureClass, "NONE");
});

test("a missing semantic check is evaluator corruption rather than a model failure", async () => {
  const fixture = await makeRun({ arm: "baseline" });
  const gatePath = join(fixture.root, "gate.json");
  const gate = JSON.parse(await readFile(gatePath, "utf8"));
  gate.checks = gate.checks.filter((check: { id: string }) => check.id !== "source-coverage");
  await writeFile(gatePath, JSON.stringify(gate), "utf8");
  await assert.rejects(scoreRun(fixture.root), /Missing required semantic check: source-coverage/);
});

test("aggregate metrics report ODI components, failure classes, latency, and tokens", async () => {
  assert.equal(median([]), 0);
  assert.equal(median([3, 1, 2]), 2);
  assert.deepEqual(wilsonInterval(0, 0), { low: 0, high: 0 });

  const baselineFixture = await makeRun({
    arm: "baseline",
    failures: ["action-correct"],
    durationMs: 3_000,
  });
  const advancedFixture = await makeRun({
    arm: "advanced",
    durationMs: 1_000,
    tokenUsage: { input: 10, cachedInput: 2, output: 4 },
  });
  const baseline = await scoreRun(baselineFixture.root, { expectedAction: baselineFixture.expectedAction });
  const advanced = await scoreRun(advancedFixture.root, { expectedAction: advancedFixture.expectedAction });
  const summary = aggregateRows([baseline, advanced]);
  assert.equal(summary.arms.baseline.odi, 0);
  assert.equal(summary.arms.advanced.odi, 1);
  assert.equal(summary.absoluteOdiChange, 1);
  assert.equal(summary.arms.baseline.failureClasses.GENUINE_SEMANTIC_FAILURE, 1);
  assert.equal(summary.arms.advanced.failureClasses.NONE, 1);
  assert.equal(summary.arms.advanced.sourceCoverageRate, 1);
  assert.equal(summary.arms.advanced.annotationAlignedRate, 1);
  assert.equal(summary.arms.advanced.totalTokens, 14);
  assert.equal(summary.resourceComparison.advancedMinusBaselineMedianDurationMs, -2_000);
});

test("case-balanced means and nested bootstrap do not overweight cases with more trials", () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
  assert.equal(sampleVariance([1, 2, 3, 4]), 5 / 3);
  assert.equal(sampleStandardDeviation([1, 2, 3, 4]), Math.sqrt(5 / 3));
  assert.equal(quantileType7([1, 2, 3, 4], 0.95), 3.8499999999999996);

  const rows = [
    ...Array.from({ length: 20 }, () => ({
      caseId: "many-trials",
      arm: "baseline" as const,
      expectedAction: "NO_ACTION",
      value: 0,
    })),
    { caseId: "one-trial", arm: "baseline" as const, expectedAction: "NO_ACTION", value: 1 },
    ...Array.from({ length: 20 }, () => ({
      caseId: "many-trials",
      arm: "advanced" as const,
      expectedAction: "NO_ACTION",
      value: 1,
    })),
    { caseId: "one-trial", arm: "advanced" as const, expectedAction: "NO_ACTION", value: 1 },
  ];
  assert.equal(caseBalancedMean(rows, (row) => row.value, "baseline"), 0.5);
  assert.equal(caseBalancedMean(rows, (row) => row.value, "advanced"), 1);
  const first = stratifiedNestedBootstrap(rows, (row) => row.value, { iterations: 200, seed: 20260829 });
  const second = stratifiedNestedBootstrap(rows, (row) => row.value, { iterations: 200, seed: 20260829 });
  assert.deepEqual(first, second);
});

test("cost estimates separate cached input from uncached input", () => {
  const estimate = estimateUsageCost(
    { input: 10, cachedInput: 2, output: 4 },
    { inputPerMillionUsd: 2, cachedInputPerMillionUsd: 0.2, outputPerMillionUsd: 12 },
  );
  assert.deepEqual(estimate.tokenUsage, {
    input: 10,
    cachedInput: 2,
    uncachedInput: 8,
    output: 4,
    total: 14,
  });
  assert.ok(Math.abs(estimate.estimatedCostUsd - 0.0000644) < 1e-15);
});

test("advanced usage is unknown when any of three session receipts is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-partial-usage-"));
  await mkdir(join(root, "trajectories"));
  for (const [role, withUsage] of [["maintainer", true], ["challenger", true], ["reviser", false]] as const) {
    await writeFile(
      join(root, "trajectories", `${role}.jsonl`),
      withUsage
        ? `${JSON.stringify({ usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 } })}\n`
        : `${JSON.stringify({ type: "run.failed", message: "invalid output" })}\n`,
      "utf8",
    );
  }
  assert.equal(await reconstructUsage(root, [
    "trajectories/maintainer.jsonl",
    "trajectories/challenger.jsonl",
    "trajectories/reviser.jsonl",
  ]), null);
});

test("recorded evaluation emits symmetric V4 rows and a system-level comparison", async () => {
  const caseRoot = await mkdtemp(join(tmpdir(), "evidence-v4-cases-"));
  const outDir = await mkdtemp(join(tmpdir(), "evidence-v4-evaluation-"));
  await writeV4Case(caseRoot, "case-alpha");
  await writeV4Case(caseRoot, "case-beta");
  const summary = await runEvaluation({
    caseIds: ["case-alpha", "case-beta"],
    trials: 1,
    mode: "recorded",
    model: "recorded-fixture",
    timeoutMs: 30_000,
    outDir,
    caseRoot,
    runner: new V4Runner(),
  });
  assert.equal(summary.schemaVersion, 2);
  assert.equal(summary.rows.length, 4);
  assert.equal(summary.failureTaxonomy.NONE, 4);
  assert.equal(summary.failureTaxonomy.GENUINE_SEMANTIC_FAILURE, 0);
  assert.equal(summary.comparisonDesign.class, "SYSTEM_LEVEL_NON_COMPUTE_MATCHED");
  assert.equal(summary.comparisonDesign.baselineSessions, 1);
  assert.equal(summary.comparisonDesign.advancedSessions, 3);
  assert.ok(summary.rows.every((row) => row.operationalDecisionIntegrity));
  assert.ok(summary.rows.every((row) => row.failureClass === "NONE"));
});

test("evaluator invalidations exclude a frozen case from both arms and preserve the receipt", async () => {
  const caseRoot = await mkdtemp(join(tmpdir(), "evidence-invalid-cases-"));
  const outDir = await mkdtemp(join(tmpdir(), "evidence-invalid-evaluation-"));
  const receiptPath = join(caseRoot, "case-beta-invalidation.json");
  await writeV4Case(caseRoot, "case-alpha");
  await writeV4Case(caseRoot, "case-beta");
  await writeFile(receiptPath, `${JSON.stringify({
    schemaVersion: 1,
    caseId: "case-beta",
    defect: "The oracle lacks a fair semantic interpretation.",
  }, null, 2)}\n`, "utf8");
  const summary = await runEvaluation({
    caseIds: ["case-alpha", "case-beta"],
    trials: 2,
    mode: "recorded",
    model: "recorded-fixture",
    timeoutMs: 30_000,
    outDir,
    caseRoot,
    runner: new V4Runner(),
    evaluatorInvalidations: [{
      caseId: "case-beta",
      reason: "Predeclared evaluator defect",
      receiptPath,
    }],
  });
  assert.equal(summary.rows.length, 4);
  assert.ok(summary.rows.every((row) => row.caseId === "case-alpha"));
  assert.equal(summary.selection.selectedCaseCount, 2);
  assert.equal(summary.selection.includedCaseCount, 1);
  assert.equal(summary.selection.excludedCaseCount, 1);
  assert.equal(summary.failureTaxonomy.EVALUATOR_INVALID, 4);
  const receipt = JSON.parse(await readFile(join(outDir, "evaluator-invalidations.json"), "utf8"));
  assert.equal(receipt.invalidations[0].caseId, "case-beta");
  assert.equal(receipt.invalidations[0].receipt.defect, "The oracle lacks a fair semantic interpretation.");
  assert.match(receipt.invalidations[0].sourceReceiptSha256, /^[a-f0-9]{64}$/);
});

test("model execution errors are typed rows with available usage", async () => {
  const caseRoot = await mkdtemp(join(tmpdir(), "evidence-model-error-cases-"));
  const outDir = await mkdtemp(join(tmpdir(), "evidence-model-error-evaluation-"));
  await writeV4Case(caseRoot, "case-alpha");
  const summary = await runEvaluation({
    caseIds: ["case-alpha"],
    trials: 1,
    mode: "live",
    model: "fixture-model",
    timeoutMs: 30_000,
    outDir,
    caseRoot,
    runner: new V4Runner("live", "MODEL"),
  });
  assert.equal(summary.rows.length, 2);
  assert.equal(summary.failureTaxonomy.MODEL_EXECUTION, 2);
  assert.ok(summary.rows.every((row) => row.failureClass === "MODEL_EXECUTION"));
  assert.ok(summary.rows.every((row) => row.totalTokens === 110));
});

test("infrastructure failures abort before aggregation", async () => {
  const caseRoot = await mkdtemp(join(tmpdir(), "evidence-infra-error-cases-"));
  const outDir = await mkdtemp(join(tmpdir(), "evidence-infra-error-evaluation-"));
  await writeV4Case(caseRoot, "case-alpha");
  await assert.rejects(runEvaluation({
    caseIds: ["case-alpha"],
    trials: 1,
    mode: "live",
    model: "fixture-model",
    timeoutMs: 30_000,
    outDir,
    caseRoot,
    runner: new V4Runner("live", "INFRASTRUCTURE"),
  }), /filesystem unavailable/);
});

test("case-set identity is independent of execution order", async () => {
  const caseRoot = await mkdtemp(join(tmpdir(), "evidence-case-order-cases-"));
  await writeV4Case(caseRoot, "case-alpha");
  await writeV4Case(caseRoot, "case-beta");
  const first = await runEvaluation({
    caseIds: ["case-alpha", "case-beta"],
    trials: 1,
    mode: "recorded",
    model: "recorded-fixture",
    timeoutMs: 30_000,
    outDir: await mkdtemp(join(tmpdir(), "evidence-case-order-one-")),
    caseRoot,
    runner: new V4Runner(),
  });
  const second = await runEvaluation({
    caseIds: ["case-beta", "case-alpha"],
    trials: 1,
    mode: "recorded",
    model: "recorded-fixture",
    timeoutMs: 30_000,
    outDir: await mkdtemp(join(tmpdir(), "evidence-case-order-two-")),
    caseRoot,
    runner: new V4Runner(),
  });
  assert.equal(first.caseSetHash, second.caseSetHash);
  assert.equal(first.caseDefinitionSetHash, second.caseDefinitionSetHash);
});

test("evaluation CLI and case selection support an isolated holdout root", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-holdout-root-"));
  await mkdir(join(root, "zeta"));
  await mkdir(join(root, "alpha"));
  assert.deepEqual(await resolveCaseSelection("all", root), ["alpha", "zeta"]);
  const parsed = parseEvaluateArgs([
    "--case-root", root,
    "--cases", "all",
    "--mode", "recorded",
    "--out", join(root, "out"),
    "--lock", join(root, "FREEZE.json"),
  ]);
  assert.equal(parsed.caseRoot, root);
  assert.equal(parsed.lock, join(root, "FREEZE.json"));
});
