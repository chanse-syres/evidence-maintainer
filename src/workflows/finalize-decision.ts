import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ModelExecutionError } from "../agents/runner.ts";
import {
  copyCaseWorkspaceV4,
  loadOracleV4,
  loadPublicCaseV4,
} from "../core/case-loader.ts";
import { validateDecisionOperations } from "../core/candidate-validation.ts";
import {
  runHiddenProbeIsolated,
  runRequiredCommandIsolated,
} from "../core/isolated-command-runner.ts";
import { runSemanticGate, type CommandResult, type GateResult } from "../core/deterministic-gate.ts";
import { applyOperations, MutationApplicationError } from "../core/mutation-engine.ts";
import { DecisionPackageSchema, type DecisionPackage } from "../core/schemas.ts";
import { snapshotTree, type TreeSnapshot } from "../core/tree-snapshot.ts";

export interface FinalizeDecisionInput {
  caseDir: string;
  runRoot: string;
  package: DecisionPackage;
  submissionMode: true;
  liveWriteAttempted: false;
}

export interface FinalizeDecisionResult {
  gate: GateResult;
  commandResults: Record<string, CommandResult>;
  before: TreeSnapshot;
  after: TreeSnapshot;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function assertWorkspaceAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error("Finalization workspace already exists; callers cannot supply a pre-mutated workspace");
}

async function validateChangedJson(operationFiles: readonly string[], workspace: string): Promise<void> {
  for (const file of [...new Set(operationFiles.filter((path) => path.endsWith(".json")))]) {
    try {
      JSON.parse(await readFile(resolve(workspace, ...file.split("/")), "utf8"));
    } catch (error) {
      throw new ModelExecutionError(
        "INVALID_OPERATION",
        `Mutation left ${file} as invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function runCommands(
  workspace: string,
  caseDir: string,
  commands: readonly string[],
  hiddenProbePath: string | null,
): Promise<Record<string, CommandResult>> {
  const results: Record<string, CommandResult> = {};
  for (const command of commands) {
    results[command] = await runRequiredCommandIsolated(command, workspace);
  }
  if (hiddenProbePath) {
    results[`hidden:${hiddenProbePath}`] = await runHiddenProbeIsolated(
      workspace,
      resolve(caseDir, ...hiddenProbePath.split("/")),
    );
  }
  return results;
}

export async function finalizeDecision(input: FinalizeDecisionInput): Promise<FinalizeDecisionResult> {
  const runRoot = resolve(input.runRoot);
  const caseDir = resolve(input.caseDir);
  const workspacePath = join(runRoot, "workspace");
  await mkdir(runRoot, { recursive: true });
  await assertWorkspaceAbsent(workspacePath);

  const packageValue = DecisionPackageSchema.parse(input.package);
  const loadedCase = await loadPublicCaseV4(caseDir);
  const oracle = await loadOracleV4(caseDir);
  const workspace = await copyCaseWorkspaceV4(caseDir, workspacePath);
  const before = await snapshotTree(workspace);
  await writeJson(join(runRoot, "final-decision.json"), packageValue);
  await writeJson(join(runRoot, "before-tree.json"), before);

  const operationErrors = validateDecisionOperations(
    packageValue,
    loadedCase.manifest.allowedWritePaths,
    oracle,
  );
  if (operationErrors.length > 0) {
    throw new ModelExecutionError("INVALID_OPERATION", operationErrors.join(" "));
  }
  try {
    await applyOperations(workspace, packageValue.operations);
  } catch (error) {
    if (error instanceof MutationApplicationError) {
      throw new ModelExecutionError("INVALID_OPERATION", error.message);
    }
    throw error;
  }
  await validateChangedJson(packageValue.operations.map((operation) => operation.file), workspace);

  const commandResults = await runCommands(
    workspace,
    caseDir,
    loadedCase.manifest.requiredCommands,
    oracle.hiddenProbePath,
  );
  const after = await snapshotTree(workspace);
  const gate = await runSemanticGate({
    loadedCase,
    oracle,
    package: packageValue,
    workspace,
    before,
    after,
    commandResults,
    submissionMode: input.submissionMode,
    liveWriteAttempted: input.liveWriteAttempted,
  });

  await writeJson(join(runRoot, "command-results.json"), commandResults);
  await writeJson(join(runRoot, "after-tree.json"), after);
  await writeJson(join(runRoot, "gate.json"), gate);
  return { gate, commandResults, before, after };
}
