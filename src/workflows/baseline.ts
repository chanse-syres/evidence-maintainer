import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { once } from "node:events";
import type { AgentRunner } from "../agents/runner.ts";
import { loadPrompt } from "../agents/prompt-loader.ts";
import { copyCaseWorkspace, loadOracle, loadPublicCase } from "../core/case-loader.ts";
import { sha256Json, sha256Text } from "../core/canonical-json.ts";
import { runDeterministicGate, type CommandResult } from "../core/deterministic-gate.ts";
import { applyOperations } from "../core/mutation-engine.ts";
import {
  BaselineResultSchema,
  MaintainerProposalSchema,
  RunManifestSchema,
  type ChallengerVerdict,
  type RunManifest,
} from "../core/schemas.ts";
import { snapshotTree } from "../core/tree-snapshot.ts";
import { PROJECT_ID } from "../core/project.ts";
import { recordApproval } from "./approval.ts";

export interface RunBaselineInput {
  caseDir: string;
  runRoot: string;
  runner: AgentRunner;
  model: string;
  timeoutMs: number;
  approve: boolean;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function runCommand(command: string, workspace: string): Promise<CommandResult> {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(command, {
    cwd: workspace,
    env,
    shell: true,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const [code] = await once(child, "close") as [number | null, NodeJS.Signals | null];
  return {
    exitCode: code ?? 1,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}

export async function runRequiredCommands(
  workspace: string,
  commands: readonly string[],
): Promise<Record<string, CommandResult>> {
  const results: Record<string, CommandResult> = {};
  for (const command of commands) {
    results[command] = await runCommand(command, workspace);
  }
  return results;
}

async function hashArtifacts(root: string, paths: readonly string[]): Promise<Record<string, string>> {
  const output: Record<string, string> = {};
  for (const path of paths) {
    output[path] = sha256Text(await readFile(join(root, ...path.split("/"))));
  }
  return output;
}

export async function runBaseline(input: RunBaselineInput): Promise<RunManifest> {
  const runRoot = resolve(input.runRoot);
  await mkdir(join(runRoot, "trajectories"), { recursive: true });
  const loadedCase = await loadPublicCase(input.caseDir);
  const workspace = await copyCaseWorkspace(input.caseDir, join(runRoot, "workspace"));
  const before = await snapshotTree(workspace);
  await writeJson(join(runRoot, "before-tree.json"), before);

  const outputSchemaPath = resolve("schemas", "baseline-result.schema.json");
  const outputContract = await readFile(outputSchemaPath, "utf8");
  const prompt = await loadPrompt("baseline", {
    CASE_ID: loadedCase.manifest.id,
    CASE_CONTEXT: JSON.stringify({
      title: loadedCase.manifest.title,
      description: loadedCase.manifest.description,
      agentVisibleFiles: loadedCase.manifest.agentVisibleFiles.map((path) => path.replace(/^workspace\//, "")),
      allowedWritePaths: loadedCase.manifest.allowedWritePaths,
      requiredCommands: loadedCase.manifest.requiredCommands,
    }, null, 2),
    OUTPUT_CONTRACT: outputContract,
  });
  const runId = `${loadedCase.manifest.id}-baseline-${Date.now()}`;
  const trajectoryPath = join(runRoot, "trajectories", "baseline.jsonl");
  const agent = await input.runner.run({
    runId,
    role: "baseline",
    caseId: loadedCase.manifest.id,
    workspace,
    prompt,
    outputSchemaPath,
    model: input.model,
    timeoutMs: input.timeoutMs,
    trajectoryPath,
    parse: (value) => BaselineResultSchema.parse(value),
  });
  await writeJson(join(runRoot, "baseline-result.json"), agent.output);
  const proposal = MaintainerProposalSchema.parse({
    schemaVersion: agent.output.schemaVersion,
    caseId: agent.output.caseId,
    action: agent.output.action,
    firstMaterialDivergence: agent.output.firstMaterialDivergence,
    failureOwner: agent.output.failureOwner,
    evidenceUsed: agent.output.evidenceUsed,
    evidenceRejected: agent.output.evidenceRejected,
    affectedEntities: agent.output.affectedEntities,
    affectedFiles: agent.output.affectedFiles,
    operations: agent.output.operations,
    preservedInvariants: agent.output.preservedInvariants,
    unresolvedUncertainty: agent.output.unresolvedUncertainty,
    minimumInformationRequest: agent.output.minimumInformationRequest,
    retryCondition: agent.output.retryCondition,
    approvalLevel: agent.output.approvalLevel,
    summary: agent.output.summary,
  });
  await applyOperations(workspace, proposal.operations);
  const commandResults = await runRequiredCommands(workspace, loadedCase.manifest.requiredCommands);
  await writeJson(join(runRoot, "command-results.json"), commandResults);
  const after = await snapshotTree(workspace);
  await writeJson(join(runRoot, "after-tree.json"), after);

  const oracle = await loadOracle(input.caseDir);
  const evaluatorVerdict: ChallengerVerdict = {
    schemaVersion: 1,
    caseId: loadedCase.manifest.id,
    verdict: oracle.requiredChallengerVerdict,
    evidenceIds: oracle.requiredEvidenceIds,
    violations: [],
    residualRisks: [],
    summary: "Evaluator-only adjudication used after the direct-agent session completed.",
  };
  const gate = await runDeterministicGate({
    loadedCase,
    oracle,
    workspace,
    before,
    after,
    proposal,
    challenger: evaluatorVerdict,
    commandResults,
    submissionMode: true,
    liveWriteAttempted: false,
  });
  await writeJson(join(runRoot, "gate.json"), gate);
  const approval = recordApproval({
    caseId: loadedCase.manifest.id,
    requested: input.approve,
    gateStatus: gate.status,
  });
  await writeJson(join(runRoot, "approval.json"), approval);

  const finishedAt = new Date().toISOString();
  const artifactPaths = [
    "baseline-result.json",
    "before-tree.json",
    "after-tree.json",
    "command-results.json",
    "gate.json",
    "approval.json",
    "trajectories/baseline.jsonl",
  ];
  const manifest = RunManifestSchema.parse({
    schemaVersion: 1,
    projectId: PROJECT_ID,
    runId,
    caseId: loadedCase.manifest.id,
    arm: "baseline",
    mode: agent.mode,
    model: input.model,
    startedAt: agent.startedAt,
    finishedAt,
    durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(agent.startedAt).getTime()),
    timeoutMs: input.timeoutMs,
    promptSha256: sha256Text(prompt),
    outputSchemaSha256: sha256Text(outputContract),
    caseSetSha256: sha256Json({ caseId: loadedCase.manifest.id, workspaceHash: loadedCase.workspaceHash }),
    trajectoryPaths: [relative(runRoot, trajectoryPath).replaceAll("\\", "/")],
    artifactSha256: await hashArtifacts(runRoot, artifactPaths),
    tokenUsage: agent.tokenUsage
      ? { input: agent.tokenUsage.input, cachedInput: 0, output: agent.tokenUsage.output }
      : null,
    outcome: gate.status,
  });
  await writeJson(join(runRoot, "manifest.json"), manifest);
  return manifest;
}
