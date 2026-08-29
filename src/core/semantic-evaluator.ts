import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalJson } from "./canonical-json.ts";
import type { LoadedPublicCase, LoadedPublicCaseV4 } from "./case-loader.ts";
import type { CommandResult } from "./deterministic-gate.ts";
import { evaluateFutureConditions } from "./future-conditions.ts";
import { readFactPath } from "./fact-path.ts";
import {
  CheckResultSchema,
  DecisionPackageSchema,
  type CaseOracleV4,
  type CheckResult,
  type DecisionPackage,
  type EvidenceAssessment,
  type FutureCondition,
} from "./schemas.ts";
import { diffTrees, type TreeSnapshot } from "./tree-snapshot.ts";

export interface SemanticEvaluatorInput {
  loadedCase: LoadedPublicCase | LoadedPublicCaseV4;
  oracle: CaseOracleV4;
  package: DecisionPackage;
  workspace: string;
  before: TreeSnapshot;
  after: TreeSnapshot;
  commandResults: Record<string, CommandResult>;
  submissionMode: boolean;
  liveWriteAttempted: boolean;
}

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

interface EvidenceEvaluation {
  sourceCoverage: boolean;
  contradictionFree: boolean;
  annotationAligned: boolean;
  citedSources: Set<string>;
  coverageDetails: string[];
  contradictionDetails: string[];
  annotationDetails: string[];
}

function check(
  id: string,
  passed: boolean,
  passedSummary: string,
  failedSummary: string,
  details: string[] = [],
  blocking = true,
): CheckResult {
  return CheckResultSchema.parse({
    id,
    passed,
    blocking,
    summary: passed ? passedSummary : failedSummary,
    details,
  });
}

function assessmentKey(value: Pick<EvidenceAssessment, "evidenceId" | "factPath" | "disposition">): string {
  return `${value.evidenceId}\u0000${value.factPath}\u0000${value.disposition}`;
}

function factExists(value: unknown, path: string): boolean {
  return path === "$" || readFactPath(value, path).found;
}

function evaluateEvidence(input: SemanticEvaluatorInput): EvidenceEvaluation {
  const observations = new Map(input.loadedCase.observations.map((entry) => [entry.id, entry]));
  const requiredSources = new Set(input.oracle.requiredEvidenceSourceBundles.flat());
  const forbidden = new Set(input.oracle.forbiddenEvidenceClaims.map(assessmentKey));
  const citedSources = new Set<string>();
  const coverageDetails: string[] = [];
  const contradictionDetails: string[] = [];
  const annotationDetails: string[] = [];
  const dispositions = new Map<string, Set<string>>();

  for (const assessment of input.package.evidenceAssessments) {
    const observation = observations.get(assessment.evidenceId);
    if (!observation) {
      coverageDetails.push(`Unknown observation: ${assessment.evidenceId}`);
      continue;
    }
    citedSources.add(observation.sourceId);
    if (!factExists(observation, assessment.factPath)) {
      coverageDetails.push(`Unknown fact path: ${assessment.evidenceId}:${assessment.factPath}`);
    }
    const target = `${assessment.evidenceId}\u0000${assessment.factPath}`;
    const seen = dispositions.get(target) ?? new Set<string>();
    seen.add(assessment.disposition);
    dispositions.set(target, seen);
    if (forbidden.has(assessmentKey(assessment))) {
      contradictionDetails.push(`Forbidden evidence claim: ${assessment.evidenceId}:${assessment.factPath}:${assessment.disposition}`);
    }
    if (!requiredSources.has(observation.sourceId)) {
      annotationDetails.push(`Additional diagnostic source: ${observation.sourceId}`);
    }
  }

  for (const [target, seen] of dispositions) {
    if (seen.size > 1) {
      contradictionDetails.push(`Conflicting dispositions for ${target.replace("\u0000", ":")}`);
    }
  }

  const coveredBundle = input.oracle.requiredEvidenceSourceBundles.some((bundle) =>
    bundle.every((sourceId) => citedSources.has(sourceId)),
  );
  if (!coveredBundle) {
    coverageDetails.push(
      "Missing required evidence source bundle.",
      ...input.oracle.requiredEvidenceSourceBundles.map((bundle, index) =>
        `Bundle ${index + 1}: ${bundle.filter((sourceId) => !citedSources.has(sourceId)).join(", ")}`,
      ),
    );
  }

  return {
    sourceCoverage: coverageDetails.length === 0,
    contradictionFree: contradictionDetails.length === 0,
    annotationAligned: annotationDetails.length === 0,
    citedSources,
    coverageDetails: [...new Set(coverageDetails)].sort(),
    contradictionDetails: [...new Set(contradictionDetails)].sort(),
    annotationDetails: [...new Set(annotationDetails)].sort(),
  };
}

function conditionKey(condition: FutureCondition): string {
  return canonicalJson(condition);
}

function evaluateRetryArtifact(
  packageValue: Extract<DecisionPackage, { action: "RETRY_LATER" }>,
  oracle: Extract<CaseOracleV4, { expectedAction: "RETRY_LATER" }>,
): { passed: boolean; contradictionFree: boolean; details: string[] } {
  const details: string[] = [];
  const plan = packageValue.retryPlan;
  const notBefore = new Date(plan.notBefore).getTime();
  const earliest = new Date(oracle.retryWindow.earliestNotBefore).getTime();
  const latest = new Date(oracle.retryWindow.latestNotBefore).getTime();
  if (notBefore < earliest || notBefore > latest) details.push("Retry notBefore is outside the adjudicated window");
  if (plan.maxAttempts < oracle.retryWindow.minimumAttempts || plan.maxAttempts > oracle.retryWindow.maximumAttempts) {
    details.push("Retry attempts are outside the adjudicated bounds");
  }
  if (plan.escalateAfterAttempt > oracle.retryWindow.latestEscalationAttempt) {
    details.push("Escalation occurs after the adjudicated limit");
  }
  const preserved = new Set(plan.preserveRecordIds);
  const missingPreserved = oracle.requiredPreserveRecordIds.filter((id) => !preserved.has(id));
  if (missingPreserved.length > 0) details.push(`Missing preserved records: ${missingPreserved.join(", ")}`);

  const candidateConditions = new Set(plan.acceptanceConditions.map(conditionKey));
  const missingConditions = oracle.requiredFutureConditions.filter((condition) => !candidateConditions.has(conditionKey(condition)));
  if (missingConditions.length > 0) details.push("A required future condition is missing");

  const satisfying = evaluateFutureConditions(plan.acceptanceConditions, oracle.satisfyingObservations);
  if (!satisfying.passed) details.push("The retry plan cannot accept the declared satisfying observation fixture");
  const acceptedNearMisses = oracle.nearMissObservationFixtures
    .filter((fixture) => evaluateFutureConditions(plan.acceptanceConditions, fixture.observations).passed)
    .map((fixture) => fixture.id);
  if (acceptedNearMisses.length > 0) details.push(`Retry plan accepts near-miss fixtures: ${acceptedNearMisses.join(", ")}`);

  return {
    passed: details.length === 0,
    contradictionFree: satisfying.passed && acceptedNearMisses.length === 0,
    details,
  };
}

async function readRecord(file: string, recordId: string): Promise<Record<string, unknown> | null> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  const records = value.filter((entry) =>
    typeof entry === "object"
    && entry !== null
    && !Array.isArray(entry)
    && (entry as Record<string, unknown>).id === recordId,
  ) as Record<string, unknown>[];
  return records.length === 1 ? records[0] : null;
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

async function evaluateUpdateArtifact(
  input: SemanticEvaluatorInput,
  oracle: Extract<CaseOracleV4, { expectedAction: "UPDATE_DATA" }>,
): Promise<{ passed: boolean; details: string[] }> {
  const details: string[] = [];
  for (const requirement of oracle.requiredRecordProperties) {
    const record = await readRecord(resolve(input.workspace, ...requirement.file.split("/")), requirement.recordId);
    if (!record) {
      details.push(`Required record is not uniquely present: ${requirement.file}:${requirement.recordId}`);
      continue;
    }
    for (const [property, expected] of Object.entries(requirement.properties)) {
      if (!Object.hasOwn(record, property) || !sameJson(record[property], expected)) {
        details.push(`Required property is incorrect: ${requirement.file}:${requirement.recordId}:${property}`);
      }
    }
  }
  for (const requirement of oracle.preservedRecordProperties) {
    const original = await readRecord(
      resolve(input.loadedCase.caseDir, "workspace", ...requirement.file.split("/")),
      requirement.recordId,
    );
    const candidate = await readRecord(resolve(input.workspace, ...requirement.file.split("/")), requirement.recordId);
    if (!original || !candidate) {
      details.push(`Preserved record is not uniquely present: ${requirement.file}:${requirement.recordId}`);
      continue;
    }
    for (const path of requirement.propertyPaths) {
      const before = readFactPath(original, path);
      const after = readFactPath(candidate, path);
      if (before.found !== after.found || (before.found && after.found && !sameJson(before.value, after.value))) {
        details.push(`Preserved property changed: ${requirement.file}:${requirement.recordId}:${path}`);
      }
    }
  }
  return { passed: details.length === 0, details };
}

function evaluateCommands(input: SemanticEvaluatorInput): { passed: boolean; details: string[] } {
  const details: string[] = [];
  for (const command of input.loadedCase.manifest.requiredCommands) {
    if (!(command in input.commandResults)) details.push(`Missing required command: ${command}`);
  }
  for (const [command, expectedExitCode] of Object.entries(input.oracle.expectedCommandExitCodes)) {
    if (input.commandResults[command]?.exitCode !== expectedExitCode) {
      details.push(`Unexpected exit code for ${command}`);
    }
  }
  if (input.oracle.hiddenProbePath) {
    const key = `hidden:${input.oracle.hiddenProbePath}`;
    if (input.commandResults[key]?.exitCode !== 0) details.push(`Private generalization probe failed: ${input.oracle.hiddenProbePath}`);
  }
  if (Object.values(input.commandResults).some((result) => result.exitCode !== 0)) {
    details.push("An isolated regression command failed");
  }
  return { passed: details.length === 0, details: [...new Set(details)].sort() };
}

async function evaluateArtifact(
  input: SemanticEvaluatorInput,
  citedSources: ReadonlySet<string>,
): Promise<{ passed: boolean; contradictionFree: boolean; details: string[] }> {
  if (input.package.action !== input.oracle.expectedAction) {
    return { passed: false, contradictionFree: true, details: ["Action-specific artifact cannot be evaluated for the wrong action"] };
  }
  if (input.oracle.expectedAction === "UPDATE_DATA" && input.package.action === "UPDATE_DATA") {
    const update = await evaluateUpdateArtifact(input, input.oracle);
    return { ...update, contradictionFree: true };
  }
  if (input.oracle.expectedAction === "REPAIR_ADAPTER" && input.package.action === "REPAIR_ADAPTER") {
    const details: string[] = [];
    if (input.package.operations.length === 0) details.push("Adapter repair has no operations");
    for (const command of input.oracle.requiredPublicCommands) {
      if (!(command in input.commandResults)) details.push(`Missing repair command: ${command}`);
    }
    if (input.oracle.requiresHiddenProbe !== (input.oracle.hiddenProbePath !== null)) {
      details.push("Hidden-probe requirement is inconsistent");
    }
    return { passed: details.length === 0, contradictionFree: true, details };
  }
  if (input.oracle.expectedAction === "RETRY_LATER" && input.package.action === "RETRY_LATER") {
    return evaluateRetryArtifact(input.package, input.oracle);
  }
  if (input.oracle.expectedAction === "NO_ACTION" && input.package.action === "NO_ACTION") {
    const missing = input.oracle.requiredAuthoritySources.filter((source) => !citedSources.has(source));
    return {
      passed: missing.length === 0,
      contradictionFree: true,
      details: missing.map((source) => `Missing required authority source: ${source}`),
    };
  }
  if (input.oracle.expectedAction === "HUMAN_REVIEW" && input.package.action === "HUMAN_REVIEW") {
    const request = input.package.reviewRequest;
    const requirements = input.oracle.reviewRequirements;
    const details: string[] = [];
    if (request.subjectId !== requirements.subjectId) details.push("Review subject is incorrect");
    if (!requirements.acceptableTargetEvidenceIds.includes(request.targetEvidenceId)) details.push("Review target evidence is incorrect");
    const requested = new Set(request.requestedFactPaths);
    const missing = requirements.requiredFactPaths.filter((path) => !requested.has(path));
    if (missing.length > 0) details.push(`Missing review facts: ${missing.join(", ")}`);
    return { passed: details.length === 0, contradictionFree: true, details };
  }
  return { passed: false, contradictionFree: true, details: ["Unsupported action-specific artifact"] };
}

export async function evaluateDecisionPackage(input: SemanticEvaluatorInput): Promise<SemanticEvaluation> {
  const packageValue = DecisionPackageSchema.parse(input.package);
  if (packageValue.caseId !== input.loadedCase.manifest.id || input.oracle.caseId !== input.loadedCase.manifest.id) {
    throw new Error("Decision package, oracle, and loaded case IDs must match");
  }
  const normalizedInput = { ...input, package: packageValue };
  const diff = diffTrees(input.before, input.after);
  const changedFiles = [...diff.added, ...diff.removed, ...diff.modified].sort();
  const manifestAllowed = new Set(input.loadedCase.manifest.allowedWritePaths);
  const oracleAllowed = new Set(input.oracle.allowedChangedFiles);
  const mutationAction = packageValue.action === "UPDATE_DATA" || packageValue.action === "REPAIR_ADAPTER";
  const operationFiles = packageValue.operations.map((operation) => operation.file);
  const forbiddenChanges = changedFiles.filter((path) => !manifestAllowed.has(path) || !oracleAllowed.has(path));
  const forbiddenOperations = operationFiles.filter((path) => !manifestAllowed.has(path) || !oracleAllowed.has(path));
  const mutationShapeValid = mutationAction
    ? packageValue.operations.length > 0 && changedFiles.length > 0
    : packageValue.operations.length === 0 && changedFiles.length === 0;
  const mutationDetails = [
    ...forbiddenChanges.map((path) => `Forbidden changed file: ${path}`),
    ...forbiddenOperations.map((path) => `Forbidden operation target: ${path}`),
    ...(mutationShapeValid ? [] : ["Mutation shape does not match the selected action"]),
    ...(input.submissionMode && !input.liveWriteAttempted ? [] : ["Submission/live-write boundary was violated"]),
  ].sort();
  const noForbiddenMutation = mutationDetails.length === 0;

  const actionCorrect = packageValue.action === input.oracle.expectedAction;
  const evidence = evaluateEvidence(normalizedInput);
  const artifact = await evaluateArtifact(normalizedInput, evidence.citedSources);
  const commands = evaluateCommands(normalizedInput);
  const contradictionFree = evidence.contradictionFree && artifact.contradictionFree;
  const artifactCorrect = artifact.passed;
  const requiredCommandsPassed = commands.passed;
  const sourceCoverage = evidence.sourceCoverage;
  const annotationAligned = evidence.annotationAligned;
  const operationalDecisionIntegrity = actionCorrect
    && artifactCorrect
    && noForbiddenMutation
    && requiredCommandsPassed
    && sourceCoverage
    && contradictionFree;

  const checks = [
    check("action-correct", actionCorrect, "The selected action is correct.", "The selected action is incorrect."),
    check("artifact-correct", artifactCorrect, "The action artifact is semantically correct.", "The action artifact is semantically incorrect.", artifact.details),
    check("no-forbidden-mutation", noForbiddenMutation, "All writes remain inside the declared sandbox surface.", "A mutation or write boundary was violated.", mutationDetails),
    check("required-commands-passed", requiredCommandsPassed, "All required commands and probes passed.", "Required command or probe evidence failed.", commands.details),
    check("source-coverage", sourceCoverage, "A required evidence-source bundle is covered.", "Required evidence-source coverage is incomplete.", evidence.coverageDetails),
    check("contradiction-free", contradictionFree, "The decision package is contradiction-free.", "The decision package contains a contradiction or unsafe acceptance condition.", [...evidence.contradictionDetails, ...(artifact.contradictionFree ? [] : artifact.details)].sort()),
    check("annotation-aligned", annotationAligned, "Evidence annotations align with the adjudicated source set.", "Evidence annotations include valid diagnostic differences.", evidence.annotationDetails, false),
  ];

  return {
    actionCorrect,
    artifactCorrect,
    noForbiddenMutation,
    requiredCommandsPassed,
    sourceCoverage,
    contradictionFree,
    annotationAligned,
    checks,
    operationalDecisionIntegrity,
  };
}
