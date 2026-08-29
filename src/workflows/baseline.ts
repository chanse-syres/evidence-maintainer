import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { AgentRunner } from "../agents/runner.ts";
import { ModelExecutionError } from "../agents/runner.ts";
import { loadPrompt } from "../agents/prompt-loader.ts";
import { readAgentVisibleSnapshot } from "../core/agent-visible-snapshot.ts";
import { copyCaseWorkspace, loadOracle, loadPublicCase } from "../core/case-loader.ts";
import { sha256Json, sha256Text } from "../core/canonical-json.ts";
import { validateCandidateOperations } from "../core/candidate-validation.ts";
import { runHiddenProbeIsolated, runRequiredCommandIsolated } from "../core/isolated-command-runner.ts";
import { runDeterministicGate, type CommandResult } from "../core/deterministic-gate.ts";
import { applyOperations, MutationApplicationError } from "../core/mutation-engine.ts";
import {
  BaselineResultSchema,
  MaintainerProposalSchema,
  RunManifestSchema,
  type ChallengerVerdict,
  type RunManifest,
} from "../core/schemas.ts";
import { snapshotTree } from "../core/tree-snapshot.ts";
import { PROJECT_ID } from "../core/project.ts";
import { buildTokenUsageAccounting } from "../evaluation/token-usage-accounting.ts";
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

export async function runRequiredCommands(
  workspace: string,
  commands: readonly string[],
  hiddenProbePath?: string | null,
  caseDir?: string,
): Promise<Record<string, CommandResult>> {
  const results: Record<string, CommandResult> = {};
  for (const command of commands) {
    results[command] = await runRequiredCommandIsolated(command, workspace);
  }
  if (hiddenProbePath) {
    if (!caseDir) throw new Error("Hidden verifier execution requires the case directory");
    results[`hidden:${hiddenProbePath}`] = await runHiddenProbeIsolated(
      workspace,
      resolve(caseDir, ...hiddenProbePath.split("/")),
    );
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
  const oracle = await loadOracle(input.caseDir);
  const workspace = await copyCaseWorkspace(input.caseDir, join(runRoot, "workspace"));
  const before = await snapshotTree(workspace);
  await writeJson(join(runRoot, "before-tree.json"), before);

  const outputSchemaPath = resolve("schemas", "baseline-result.schema.json");
  const outputContract = await readFile(outputSchemaPath, "utf8");
  const agentVisibleWorkspace = await readAgentVisibleSnapshot(
    workspace,
    loadedCase.manifest.agentVisibleFiles,
  );
  const prompt = await loadPrompt("baseline", {
    CASE_ID: loadedCase.manifest.id,
    CASE_CONTEXT: JSON.stringify({
      title: loadedCase.manifest.title,
      description: loadedCase.manifest.description,
      agentVisibleFiles: loadedCase.manifest.agentVisibleFiles.map((path) => path.replace(/^workspace\//, "")),
      agentVisibleWorkspace,
      allowedWritePaths: loadedCase.manifest.allowedWritePaths,
      requiredCommands: loadedCase.manifest.requiredCommands,
      rawEvidence: {
        canonical: loadedCase.canonical,
        observations: loadedCase.observations,
        policy: loadedCase.policy,
      },
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
  const { arm: _arm, executedCommands: _executedCommands, ...proposalFields } = agent.output;
  void _arm;
  void _executedCommands;
  const proposal = MaintainerProposalSchema.parse(proposalFields);
  const operationErrors = validateCandidateOperations(
    proposal,
    loadedCase.manifest.allowedWritePaths,
    oracle,
  );
  if (operationErrors.length > 0) {
    throw new ModelExecutionError("INVALID_OPERATION", operationErrors.join(" "));
  }
  try {
    await applyOperations(workspace, proposal.operations);
  } catch (error) {
    if (error instanceof MutationApplicationError) {
      throw new ModelExecutionError("INVALID_OPERATION", error.message);
    }
    throw error;
  }
  const commandResults = await runRequiredCommands(
    workspace,
    loadedCase.manifest.requiredCommands,
    oracle.hiddenProbePath,
    input.caseDir,
  );
  await writeJson(join(runRoot, "command-results.json"), commandResults);
  const after = await snapshotTree(workspace);
  await writeJson(join(runRoot, "after-tree.json"), after);

  const evaluatorVerdict: ChallengerVerdict = {
    schemaVersion: 1,
    caseId: loadedCase.manifest.id,
    verdict: oracle.requiredChallengerVerdict,
    evidenceIds: oracle.requiredChallengerEvidenceIds,
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
  const proxyLedgerPaths = agent.proxyLedgerPath
    ? [relative(runRoot, agent.proxyLedgerPath).replaceAll("\\", "/")]
    : [];
  artifactPaths.push(...proxyLedgerPaths);
  const usageAccounting = agent.proxyRequestUsageCoverage
    ? buildTokenUsageAccounting([{
        role: "baseline",
        usage: agent.tokenUsage,
        source: agent.tokenUsageSource,
        trajectoryPath: relative(runRoot, trajectoryPath).replaceAll("\\", "/"),
        proxyLedgerPath: agent.proxyLedgerPath
          ? relative(runRoot, agent.proxyLedgerPath).replaceAll("\\", "/")
          : undefined,
        trajectoryAggregateCaptured: agent.trajectoryAggregateCaptured ?? false,
        proxyRequestCoverage: agent.proxyRequestUsageCoverage,
      }])
    : null;
  const manifest = RunManifestSchema.parse({
    schemaVersion: 2,
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
    proxyLedgerPaths,
    artifactSha256: await hashArtifacts(runRoot, artifactPaths),
    tokenUsage: usageAccounting?.tokenUsage ?? null,
    tokenUsageAccounting: usageAccounting?.tokenUsageAccounting ?? null,
    runtimeImages: agent.runtimeImageId
      ? [{ role: "baseline", imageId: agent.runtimeImageId.replace(/^sha256:/, "") }]
      : null,
    outcome: gate.status,
  });
  await writeJson(join(runRoot, "manifest.json"), manifest);
  return manifest;
}
