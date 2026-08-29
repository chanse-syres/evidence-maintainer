import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ChallengerVerdictSchema,
  CheckResultSchema,
  MaintainerProposalSchema,
  type CaseOracle,
  type ChallengerVerdict,
  type CheckResult,
  type EvidenceAssessment,
  type MaintainerProposal,
  type RetryPlan,
  type ReviewRequest,
} from "./schemas.ts";
import type { LoadedPublicCase } from "./case-loader.ts";
import { canonicalJson } from "./canonical-json.ts";
import { diffTrees, type TreeSnapshot } from "./tree-snapshot.ts";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface GateInput {
  loadedCase: LoadedPublicCase;
  oracle: CaseOracle;
  workspace: string;
  before: TreeSnapshot;
  after: TreeSnapshot;
  proposal: MaintainerProposal;
  challenger: ChallengerVerdict;
  commandResults: Record<string, CommandResult>;
  submissionMode: boolean;
  liveWriteAttempted: boolean;
}

export interface GateResult {
  status: "PASS" | "FAIL";
  checks: CheckResult[];
  changedFiles: string[];
  diff: ReturnType<typeof diffTrees>;
}

function check(id: string, passed: boolean, summary: string, details: string[] = []): CheckResult {
  return CheckResultSchema.parse({ id, passed, summary, details });
}

function assessmentKey(value: Pick<EvidenceAssessment, "evidenceId" | "factPath" | "disposition">): string {
  return `${value.evidenceId}\u0000${value.factPath}\u0000${value.disposition}`;
}

function pathExists(value: unknown, path: string): boolean {
  if (path === "$") return true;
  const segments = path.split(".");
  let cursor: unknown = value;
  for (const segment of segments) {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) return false;
    if (!Object.hasOwn(cursor, segment)) return false;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return true;
}

function evidenceMatches(
  loadedCase: LoadedPublicCase,
  proposal: MaintainerProposal,
  oracle: CaseOracle,
): { passed: boolean; details: string[] } {
  const observations = new Map(loadedCase.observations.map((entry) => [entry.id, entry]));
  const details: string[] = [];
  const allowedKeys = new Set<string>();
  for (const allowed of oracle.allowedEvidenceAssessments) {
    const observation = observations.get(allowed.evidenceId);
    if (!observation || !pathExists(observation, allowed.factPath)) {
      throw new Error(`Evaluator oracle contains an invalid allowed assessment: ${allowed.evidenceId}:${allowed.factPath}`);
    }
    const key = assessmentKey(allowed);
    if (allowedKeys.has(key)) {
      throw new Error(`Evaluator oracle contains a duplicate allowed assessment: ${allowed.evidenceId}:${allowed.factPath}:${allowed.disposition}`);
    }
    allowedKeys.add(key);
  }
  for (const bundle of oracle.evidenceAssessmentBundles) {
    for (const required of bundle) {
      if (!allowedKeys.has(assessmentKey(required))) {
        throw new Error(`Evaluator oracle evidence bundle is outside its allowlist: ${required.evidenceId}:${required.factPath}:${required.disposition}`);
      }
    }
  }
  const exact = new Set<string>();
  const dispositions = new Map<string, Set<string>>();
  for (const assessment of proposal.evidenceAssessments) {
    const observation = observations.get(assessment.evidenceId);
    if (!observation) {
      details.push(`Unknown observation: ${assessment.evidenceId}`);
      continue;
    }
    if (!pathExists(observation, assessment.factPath)) {
      details.push(`Unknown fact path: ${assessment.evidenceId}:${assessment.factPath}`);
    }
    const key = assessmentKey(assessment);
    if (exact.has(key)) details.push(`Duplicate assessment: ${assessment.evidenceId}:${assessment.factPath}`);
    exact.add(key);
    const target = `${assessment.evidenceId}\u0000${assessment.factPath}`;
    const seen = dispositions.get(target) ?? new Set<string>();
    seen.add(assessment.disposition);
    dispositions.set(target, seen);
  }
  for (const [target, seen] of dispositions) {
    if (seen.size > 1) details.push(`Conflicting dispositions for ${target.replace("\u0000", ":")}`);
  }
  const bundleMatches = oracle.evidenceAssessmentBundles.map((bundle) => (
    bundle.every((required) => exact.has(assessmentKey(required)))
  ));
  if (!bundleMatches.some(Boolean)) {
    const missingByBundle = oracle.evidenceAssessmentBundles.map((bundle, index) => {
      const missing = bundle.filter((required) => !exact.has(assessmentKey(required)));
      return `Bundle ${index + 1}: ${missing.map((entry) => `${entry.evidenceId}:${entry.factPath}:${entry.disposition}`).join(", ")}`;
    });
    details.push("No complete adjudicated evidence bundle was supplied.", ...missingByBundle);
  }
  for (const assessment of proposal.evidenceAssessments) {
    if (!allowedKeys.has(assessmentKey(assessment))) {
      details.push(`Unexpected assessment: ${assessment.evidenceId}:${assessment.factPath}:${assessment.disposition}`);
    }
  }
  return { passed: details.length === 0, details };
}

function normalizedReviewRequest(value: ReviewRequest): string {
  return canonicalJson({
    subjectId: value.subjectId,
    targetEvidenceId: value.targetEvidenceId,
    requestedFactPaths: [...value.requestedFactPaths].sort(),
  });
}

function reviewRequestMatches(proposal: MaintainerProposal, oracle: CaseOracle): boolean {
  if (proposal.action !== "HUMAN_REVIEW") return oracle.acceptableReviewRequests.length === 0;
  const candidate = normalizedReviewRequest(proposal.reviewRequest);
  return oracle.acceptableReviewRequests.some((acceptable) => (
    normalizedReviewRequest(acceptable) === candidate
  ));
}

function normalizedAgreementCheck(entry: RetryPlan["agreementChecks"][number]): string {
    const left = `${entry.leftEvidenceId}\u0000${entry.leftFactPath}`;
    const right = `${entry.rightEvidenceId}\u0000${entry.rightFactPath}`;
    return canonicalJson(left <= right
      ? { leftEvidenceId: entry.leftEvidenceId, leftFactPath: entry.leftFactPath, rightEvidenceId: entry.rightEvidenceId, rightFactPath: entry.rightFactPath }
      : { leftEvidenceId: entry.rightEvidenceId, leftFactPath: entry.rightFactPath, rightEvidenceId: entry.leftEvidenceId, rightFactPath: entry.leftFactPath });
}

function normalizedRetryPlan(value: RetryPlan): string {
  const agreementChecks = value.agreementChecks.map(normalizedAgreementCheck).sort();
  const valueChecks = value.valueChecks.map((entry) => canonicalJson(entry)).sort();
  return canonicalJson({
    notBefore: new Date(value.notBefore).toISOString(),
    maxAttempts: value.maxAttempts,
    escalateAfterAttempt: value.escalateAfterAttempt,
    preserveRecordIds: [...value.preserveRecordIds].sort(),
    agreementChecks,
    valueChecks,
  });
}

function retryPlanMatches(proposal: MaintainerProposal, oracle: CaseOracle): boolean {
  if (proposal.action !== "RETRY_LATER") return oracle.expectedRetryPlan === null;
  if (oracle.expectedRetryPlan === null) return false;
  return normalizedRetryPlan(proposal.retryPlan) === normalizedRetryPlan(oracle.expectedRetryPlan);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function expectedRecordsMatch(
  workspace: string,
  loadedCase: LoadedPublicCase,
  oracle: CaseOracle,
): Promise<{ passed: boolean; details: string[] }> {
  const details: string[] = [];
  const byFile = new Map<string, typeof oracle.expectedRecords>();
  for (const expectation of oracle.expectedRecords) {
    const entries = byFile.get(expectation.file) ?? [];
    entries.push(expectation);
    byFile.set(expectation.file, entries);
  }
  for (const [file, expectations] of byFile) {
    let original: unknown;
    let candidate: unknown;
    try {
      original = JSON.parse(await readFile(resolve(loadedCase.caseDir, "workspace", ...file.split("/")), "utf8"));
      candidate = JSON.parse(await readFile(resolve(workspace, ...file.split("/")), "utf8"));
    } catch (error) {
      details.push(`${file} is not valid readable JSON: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!Array.isArray(original) || !Array.isArray(candidate)) {
      details.push(`${file} must retain its array root`);
      continue;
    }
    const expected = cloneJson(original) as unknown[];
    const originalIds = original.map((entry) => (
      typeof entry === "object" && entry !== null && !Array.isArray(entry)
        ? (entry as Record<string, unknown>).id
        : undefined
    ));
    if (new Set(originalIds).size !== originalIds.length || originalIds.some((id) => typeof id !== "string")) {
      details.push(`${file} has an invalid evaluator-owned identity set`);
      continue;
    }
    for (const expectation of expectations) {
      const matches = expected.filter((entry) => (
        typeof entry === "object" && entry !== null && !Array.isArray(entry) &&
        (entry as Record<string, unknown>).id === expectation.recordId
      )) as Record<string, unknown>[];
      if (matches.length !== 1) {
        details.push(`${expectation.recordId} is not uniquely present in evaluator-owned ${file}`);
        continue;
      }
      Object.assign(matches[0], expectation.fields);
    }
    try {
      if (canonicalJson(candidate) !== canonicalJson(expected)) {
        details.push(`${file} does not exactly match the adjudicated canonical artifact`);
      }
    } catch (error) {
      details.push(`${file} cannot be canonicalized: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { passed: details.length === 0, details };
}

export async function runDeterministicGate(input: GateInput): Promise<GateResult> {
  const diff = diffTrees(input.before, input.after);
  const changedFiles = [...diff.added, ...diff.removed, ...diff.modified].sort();
  let schemaComplete = true;
  const schemaDetails: string[] = [];
  try {
    MaintainerProposalSchema.parse(input.proposal);
    ChallengerVerdictSchema.parse(input.challenger);
  } catch (error) {
    schemaComplete = false;
    schemaDetails.push(error instanceof Error ? error.message : String(error));
  }
  if (input.proposal.caseId !== input.loadedCase.manifest.id || input.challenger.caseId !== input.loadedCase.manifest.id) {
    schemaComplete = false;
    schemaDetails.push("Case IDs do not match the loaded case");
  }

  const actionCorrect = input.proposal.action === input.oracle.expectedAction;
  const expectedVerdict = input.oracle.requiredChallengerVerdict;
  const verdictCompatible = input.challenger.verdict === expectedVerdict &&
    (input.challenger.verdict !== "CONFIRM" || (
      input.challenger.violations.length === 0 && input.challenger.residualRisks.length === 0
    ));

  const allowed = new Set(input.loadedCase.manifest.allowedWritePaths);
  const oracleAllowed = new Set(input.oracle.allowedChangedFiles);
  const disallowedChanges = changedFiles.filter((path) => !allowed.has(path) || !oracleAllowed.has(path));
  const expectedChangeSet = [...oracleAllowed].sort();
  const exactChangeSet = canonicalJson(changedFiles) === canonicalJson(expectedChangeSet);

  const operationFiles = input.proposal.operations.map((operation) => operation.file).sort();
  const uniqueOperationFiles = [...new Set(operationFiles)].sort();
  const operationFilesAllowed = operationFiles.every((file) => allowed.has(file) && oracleAllowed.has(file));
  const mutationAction = input.proposal.action === "UPDATE_DATA" || input.proposal.action === "REPAIR_ADAPTER";
  const requiredArtifact = mutationAction
    ? operationFiles.length > 0 && operationFilesAllowed &&
      canonicalJson(uniqueOperationFiles) === canonicalJson(expectedChangeSet) && exactChangeSet
    : operationFiles.length === 0 && changedFiles.length === 0;

  const reviewMatches = reviewRequestMatches(input.proposal, input.oracle);
  const retryMatches = retryPlanMatches(input.proposal, input.oracle);
  const artifactDetails = [
    ...(operationFilesAllowed ? [] : ["An operation target is outside both declared allowlists"]),
    ...(reviewMatches ? [] : ["Structured review request does not match an adjudicated resolving-information bundle"]),
    ...(retryMatches ? [] : ["Structured retry plan does not match the bounded adjudicated plan"]),
  ];
  const artifactComplete = requiredArtifact && reviewMatches && retryMatches;

  const expectedState = await expectedRecordsMatch(input.workspace, input.loadedCase, input.oracle);
  const commandDetails: string[] = [];
  for (const command of input.loadedCase.manifest.requiredCommands) {
    if (!(command in input.commandResults)) commandDetails.push(`Missing required command: ${command}`);
  }
  for (const [command, expectedExitCode] of Object.entries(input.oracle.expectedCommandExitCodes)) {
    if (input.commandResults[command]?.exitCode !== expectedExitCode) {
      commandDetails.push(`Unexpected exit code for ${command}`);
    }
  }
  const hiddenCommandKey = input.oracle.hiddenProbePath ? `hidden:${input.oracle.hiddenProbePath}` : null;
  if (hiddenCommandKey && input.commandResults[hiddenCommandKey]?.exitCode !== 0) {
    commandDetails.push(`Private generalization probe failed: ${input.oracle.hiddenProbePath}`);
  }
  const allCommandsPassed = Object.values(input.commandResults).every((result) => result.exitCode === 0);

  const evidence = evidenceMatches(input.loadedCase, input.proposal, input.oracle);
  const requiredEvidenceIds = input.oracle.requiredChallengerEvidenceIds;
  const observationIds = new Set(input.loadedCase.observations.map((entry) => entry.id));
  const challengerIds = new Set(input.challenger.evidenceIds);
  for (const id of requiredEvidenceIds) {
    if (!observationIds.has(id)) throw new Error(`Evaluator oracle requires an unknown Challenger observation: ${id}`);
  }
  const challengerDetails = [
    ...requiredEvidenceIds.filter((id) => !challengerIds.has(id)).map((id) => `Missing Challenger evidence: ${id}`),
    ...input.challenger.evidenceIds.filter((id) => !observationIds.has(id)).map((id) => `Unknown Challenger evidence: ${id}`),
    ...input.challenger.evidenceIds.filter((id) => observationIds.has(id) && !requiredEvidenceIds.includes(id))
      .map((id) => `Unexpected Challenger evidence: ${id}`),
    ...(challengerIds.size === input.challenger.evidenceIds.length ? [] : ["Duplicate Challenger evidence IDs are not allowed"]),
  ];

  const checks = [
    check("schema-complete", schemaComplete, schemaComplete ? "Structured outputs are complete." : "Structured output validation failed.", schemaDetails),
    check("action-correct", actionCorrect, actionCorrect ? "The selected action matches adjudication." : "The selected action is incorrect."),
    check("challenger-compatible", verdictCompatible, verdictCompatible ? "The independent verdict is compatible." : "The independent verdict is incompatible."),
    check("allowed-write-surface", disallowedChanges.length === 0, disallowedChanges.length === 0 ? "All changes stay inside the allowed surface." : "A change escaped the allowed surface.", disallowedChanges),
    check("required-artifact", artifactComplete, artifactComplete ? "The required candidate artifact is exact." : "The candidate artifact is incomplete or structurally incorrect.", artifactDetails),
    check("expected-data-state", expectedState.passed, expectedState.passed ? "The complete adjudicated data artifact is exact." : "The complete adjudicated data artifact is incorrect.", expectedState.details),
    check("required-commands", commandDetails.length === 0, commandDetails.length === 0 ? "All required commands were executed." : "Required command evidence is incomplete.", commandDetails),
    check("regression-preserved", allCommandsPassed, allCommandsPassed ? "All isolated regression commands passed." : "An isolated regression command failed."),
    check("evidence-supported", evidence.passed, evidence.passed ? "Field-level evidence assessments match adjudication." : "Field-level evidence support is incomplete.", evidence.details),
    check("challenger-evidence-supported", challengerDetails.length === 0, challengerDetails.length === 0 ? "The Challenger cites exact required observations." : "Challenger evidence support is incomplete.", challengerDetails),
    check("no-live-write", input.submissionMode && !input.liveWriteAttempted, input.submissionMode && !input.liveWriteAttempted ? "Submission remained sandbox-only." : "A live-write boundary was violated."),
  ];

  return {
    status: checks.every((entry) => entry.passed) ? "PASS" : "FAIL",
    checks,
    changedFiles,
    diff,
  };
}
