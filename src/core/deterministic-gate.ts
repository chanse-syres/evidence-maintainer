import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ChallengerVerdictSchema,
  CheckResultSchema,
  MaintainerProposalSchema,
  type CaseOracle,
  type ChallengerVerdict,
  type CheckResult,
  type MaintainerProposal,
} from "./schemas.ts";
import type { LoadedPublicCase } from "./case-loader.ts";
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

async function expectedRecordsMatch(workspace: string, oracle: CaseOracle): Promise<{ passed: boolean; details: string[] }> {
  const details: string[] = [];
  for (const expectation of oracle.expectedRecords) {
    const parsed: unknown = JSON.parse(await readFile(resolve(workspace, ...expectation.file.split("/")), "utf8"));
    if (!Array.isArray(parsed)) {
      details.push(`${expectation.file} is not an array`);
      continue;
    }
    const record = parsed.find(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null && !Array.isArray(entry) && entry.id === expectation.recordId,
    );
    if (!record) {
      details.push(`${expectation.recordId} is absent from ${expectation.file}`);
      continue;
    }
    for (const [field, expected] of Object.entries(expectation.fields)) {
      if (JSON.stringify(record[field]) !== JSON.stringify(expected)) {
        details.push(`${expectation.recordId}.${field} does not match the adjudicated value`);
      }
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
  const verdictCompatible = input.challenger.verdict === expectedVerdict && (
    input.challenger.verdict === "CONFIRM" ||
    (input.challenger.verdict === "ESCALATE" && input.proposal.action === "HUMAN_REVIEW")
  );

  const allowed = new Set(input.loadedCase.manifest.allowedWritePaths);
  const oracleAllowed = new Set(input.oracle.allowedChangedFiles);
  const disallowedChanges = changedFiles.filter((path) => !allowed.has(path) || !oracleAllowed.has(path));
  const expectedChangeSet = [...oracleAllowed].sort();
  const exactChangeSet = JSON.stringify(changedFiles) === JSON.stringify(expectedChangeSet);

  const mutationActions = new Set(["UPDATE_DATA", "REPAIR_ADAPTER"]);
  const operationFiles = input.proposal.operations
    .filter((operation) => operation.kind !== "NO_MUTATION")
    .map((operation) => "file" in operation ? operation.file : "")
    .filter(Boolean)
    .sort();
  const requiredArtifact = mutationActions.has(input.proposal.action)
    ? operationFiles.length > 0 && exactChangeSet
    : operationFiles.length === 0 && changedFiles.length === 0;

  const expectedState = await expectedRecordsMatch(input.workspace, input.oracle);
  const commandDetails: string[] = [];
  for (const command of input.loadedCase.manifest.requiredCommands) {
    if (!(command in input.commandResults)) {
      commandDetails.push(`Missing required command: ${command}`);
    }
  }
  for (const [command, expectedExitCode] of Object.entries(input.oracle.expectedCommandExitCodes)) {
    if (input.commandResults[command]?.exitCode !== expectedExitCode) {
      commandDetails.push(`Unexpected exit code for ${command}`);
    }
  }
  const allCommandsPassed = Object.values(input.commandResults).every((result) => result.exitCode === 0);

  const evidenceUniverse = new Set([
    ...input.loadedCase.observations.map((observation) => observation.id),
    ...input.loadedCase.workspaceFiles.map((file) => file.path),
  ]);
  const missingRequiredEvidence = input.oracle.requiredEvidenceIds.filter(
    (id) => !input.proposal.evidenceUsed.includes(id) || !input.challenger.evidenceIds.includes(id),
  );
  const unknownEvidence = [...input.proposal.evidenceUsed, ...input.challenger.evidenceIds]
    .filter((id) => !evidenceUniverse.has(id));
  const evidenceSupported = missingRequiredEvidence.length === 0 && unknownEvidence.length === 0;

  const checks = [
    check("schema-complete", schemaComplete, schemaComplete ? "Structured outputs are complete." : "Structured output validation failed.", schemaDetails),
    check("action-correct", actionCorrect, actionCorrect ? "The selected action matches adjudication." : "The selected action is incorrect."),
    check("challenger-compatible", verdictCompatible, verdictCompatible ? "The independent verdict is compatible." : "The independent verdict is incompatible."),
    check("allowed-write-surface", disallowedChanges.length === 0, disallowedChanges.length === 0 ? "All changes stay inside the allowed surface." : "A change escaped the allowed surface.", disallowedChanges),
    check("required-artifact", requiredArtifact, requiredArtifact ? "The required candidate artifact is present." : "The candidate artifact or exact change set is missing.", [...operationFiles, ...changedFiles]),
    check("expected-data-state", expectedState.passed, expectedState.passed ? "The adjudicated data state is present." : "The adjudicated data state is absent.", expectedState.details),
    check("required-commands", commandDetails.length === 0, commandDetails.length === 0 ? "All required commands were executed." : "Required command evidence is incomplete.", commandDetails),
    check("regression-preserved", allCommandsPassed, allCommandsPassed ? "All executed regression commands passed." : "A regression command failed."),
    check("evidence-supported", evidenceSupported, evidenceSupported ? "Claims cite known required evidence." : "Evidence support is incomplete.", [...missingRequiredEvidence, ...unknownEvidence]),
    check("no-live-write", input.submissionMode && !input.liveWriteAttempted, input.submissionMode && !input.liveWriteAttempted ? "Submission remained sandbox-only." : "A live-write boundary was violated."),
  ];

  return {
    status: checks.every((entry) => entry.passed) ? "PASS" : "FAIL",
    checks,
    changedFiles,
    diff,
  };
}
