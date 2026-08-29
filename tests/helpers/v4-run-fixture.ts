import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentRequest,
  AgentResult,
  AgentRunner,
} from "../../src/agents/runner.ts";
import { sha256Text } from "../../src/core/canonical-json.ts";
import {
  CaseOracleV4Schema,
  ChallengerCritiqueSchema,
  DecisionPackageSchema,
  PolicyV4Schema,
  SourceObservationSchema,
  type ChallengerCritique,
  type DecisionPackage,
} from "../../src/core/schemas.ts";
import { runEvaluation } from "../../src/evaluation/run-evaluation.ts";

export interface V4EvaluationFixture {
  evaluationRoot: string;
  caseRoot: string;
  caseId: string;
  baselineRun: string;
  advancedRun: string;
}

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

async function writeCase(caseRoot: string, caseId: string): Promise<void> {
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
    title: "V4 report fixture",
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

class FixtureRunner implements AgentRunner {
  async run<T>(request: AgentRequest<T>): Promise<AgentResult<T>> {
    await mkdir(join(request.trajectoryPath, ".."), { recursive: true });
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
      mode: "recorded",
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

export async function writeV4EvaluationFixture(
  caseId = "v4-report-case",
): Promise<V4EvaluationFixture> {
  const caseRoot = await mkdtemp(join(tmpdir(), "evidence-v4-cases-"));
  const evaluationRoot = await mkdtemp(join(tmpdir(), "evidence-v4-evaluation-"));
  await writeCase(caseRoot, caseId);
  await runEvaluation({
    caseIds: [caseId],
    trials: 1,
    mode: "recorded",
    model: "recorded-fixture",
    timeoutMs: 30_000,
    outDir: evaluationRoot,
    caseRoot,
    runner: new FixtureRunner(),
  });
  const trialRoot = join(evaluationRoot, "runs", caseId, "trial-1");
  return {
    evaluationRoot,
    caseRoot,
    caseId,
    baselineRun: join(trialRoot, "baseline"),
    advancedRun: join(trialRoot, "advanced"),
  };
}
