import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DecisionPackageSchema, RunManifestSchema } from "../core/schemas.ts";

export type FailureClass =
  | "NONE"
  | "MODEL_EXECUTION"
  | "INFRASTRUCTURE"
  | "EVALUATOR_INVALID"
  | "GENUINE_SEMANTIC_FAILURE";

export const failureClasses: readonly FailureClass[] = [
  "NONE",
  "MODEL_EXECUTION",
  "INFRASTRUCTURE",
  "EVALUATOR_INVALID",
  "GENUINE_SEMANTIC_FAILURE",
];

export interface EvaluationRow {
  runId: string;
  caseId: string;
  arm: "baseline" | "advanced";
  mode: "live" | "recorded";
  model: string;
  action: string;
  expectedAction: string | null;
  actionCorrect: boolean;
  artifactCorrect: boolean;
  noForbiddenMutation: boolean;
  requiredCommandsPassed: boolean;
  sourceCoverage: boolean;
  contradictionFree: boolean;
  annotationAligned: boolean;
  operationalDecisionIntegrity: boolean;
  failureClass: FailureClass;
  durationMs: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  changedFiles: string[];
  runPath: string;
}

interface GateArtifact {
  checks: Array<{ id: string; passed: boolean }>;
  changedFiles: string[];
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function requiredCheck(checks: ReadonlyMap<string, boolean>, id: string): boolean {
  if (!checks.has(id)) throw new Error(`Missing required semantic check: ${id}`);
  return checks.get(id) === true;
}

export async function scoreRun(
  runPath: string,
  context: { expectedAction?: string } = {},
): Promise<EvaluationRow> {
  const manifest = RunManifestSchema.parse(await readJson(join(runPath, "manifest.json")));
  const gate = await readJson(join(runPath, "gate.json")) as GateArtifact;
  const decision = DecisionPackageSchema.parse(await readJson(join(runPath, "final-decision.json")));
  const checks = new Map(gate.checks.map((entry) => [entry.id, entry.passed]));
  const actionCorrect = requiredCheck(checks, "action-correct");
  const artifactCorrect = requiredCheck(checks, "artifact-correct");
  const noForbiddenMutation = requiredCheck(checks, "no-forbidden-mutation");
  const requiredCommandsPassed = requiredCheck(checks, "required-commands-passed");
  const sourceCoverage = requiredCheck(checks, "source-coverage");
  const contradictionFree = requiredCheck(checks, "contradiction-free");
  const annotationAligned = requiredCheck(checks, "annotation-aligned");
  const operationalDecisionIntegrity =
    actionCorrect &&
    artifactCorrect &&
    noForbiddenMutation &&
    requiredCommandsPassed &&
    sourceCoverage &&
    contradictionFree;
  const tokenUsage = manifest.tokenUsage;

  return {
    runId: manifest.runId,
    caseId: manifest.caseId,
    arm: manifest.arm,
    mode: manifest.mode,
    model: manifest.model,
    action: decision.action,
    expectedAction: context.expectedAction ?? null,
    actionCorrect,
    artifactCorrect,
    noForbiddenMutation,
    requiredCommandsPassed,
    sourceCoverage,
    contradictionFree,
    annotationAligned,
    operationalDecisionIntegrity,
    failureClass: operationalDecisionIntegrity ? "NONE" : "GENUINE_SEMANTIC_FAILURE",
    durationMs: manifest.durationMs,
    inputTokens: tokenUsage?.input ?? null,
    cachedInputTokens: tokenUsage?.cachedInput ?? null,
    outputTokens: tokenUsage?.output ?? null,
    totalTokens: tokenUsage ? tokenUsage.input + tokenUsage.output : null,
    changedFiles: gate.changedFiles,
    runPath,
  };
}
