import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { loadPrompt } from "../agents/prompt-loader.ts";
import { copyCaseWorkspace, loadOracle, loadPublicCase } from "../core/case-loader.ts";
import { sha256Json, sha256Text } from "../core/canonical-json.ts";
import { runDeterministicGate } from "../core/deterministic-gate.ts";
import { buildEvidenceLedger } from "../core/evidence-ledger.ts";
import { applyOperations } from "../core/mutation-engine.ts";
import { PROJECT_ID } from "../core/project.ts";
import {
  ChallengerVerdictSchema,
  MaintainerProposalSchema,
  RunManifestSchema,
  type RunManifest,
} from "../core/schemas.ts";
import { diffTrees, snapshotTree } from "../core/tree-snapshot.ts";
import { recordApproval } from "./approval.ts";
import { runRequiredCommands, type RunBaselineInput } from "./baseline.ts";

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function hashArtifacts(root: string, paths: readonly string[]): Promise<Record<string, string>> {
  const output: Record<string, string> = {};
  for (const path of paths) {
    output[path] = sha256Text(await readFile(join(root, ...path.split("/"))));
  }
  return output;
}

export async function runAdvanced(input: RunBaselineInput): Promise<RunManifest> {
  const runRoot = resolve(input.runRoot);
  await mkdir(join(runRoot, "trajectories"), { recursive: true });
  const loadedCase = await loadPublicCase(input.caseDir);
  const workspace = await copyCaseWorkspace(input.caseDir, join(runRoot, "workspace"));
  const before = await snapshotTree(workspace);
  await writeJson(join(runRoot, "before-tree.json"), before);
  const ledger = buildEvidenceLedger(loadedCase);
  await writeFile(
    join(runRoot, "evidence.jsonl"),
    `${ledger.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );

  const runId = `${loadedCase.manifest.id}-advanced-${Date.now()}`;
  const proposalSchemaPath = resolve("schemas", "maintainer-proposal.schema.json");
  const proposalContract = await readFile(proposalSchemaPath, "utf8");
  const commonContext = {
    title: loadedCase.manifest.title,
    description: loadedCase.manifest.description,
    allowedWritePaths: loadedCase.manifest.allowedWritePaths,
    requiredCommands: loadedCase.manifest.requiredCommands,
    invariants: loadedCase.policy.invariants,
  };
  const maintainerPrompt = await loadPrompt("maintainer", {
    CASE_ID: loadedCase.manifest.id,
    CASE_CONTEXT: JSON.stringify(commonContext, null, 2),
    EVIDENCE_LEDGER: ledger.map((event) => JSON.stringify(event)).join("\n"),
    OUTPUT_CONTRACT: proposalContract,
  });
  const maintainerTrajectory = join(runRoot, "trajectories", "maintainer.jsonl");
  const maintainer = await input.runner.run({
    runId,
    role: "maintainer",
    caseId: loadedCase.manifest.id,
    workspace,
    prompt: maintainerPrompt,
    outputSchemaPath: proposalSchemaPath,
    model: input.model,
    timeoutMs: input.timeoutMs,
    trajectoryPath: maintainerTrajectory,
    parse: (value) => MaintainerProposalSchema.parse(value),
  });
  await writeJson(join(runRoot, "maintainer-proposal.json"), maintainer.output);
  await applyOperations(workspace, maintainer.output.operations);
  const commandResults = await runRequiredCommands(workspace, loadedCase.manifest.requiredCommands);
  await writeJson(join(runRoot, "command-results.json"), commandResults);
  const after = await snapshotTree(workspace);
  await writeJson(join(runRoot, "after-tree.json"), after);
  const candidateDiff = diffTrees(before, after);
  await writeJson(join(runRoot, "candidate-diff.json"), candidateDiff);

  const challengerSchemaPath = resolve("schemas", "challenger-verdict.schema.json");
  const challengerContract = await readFile(challengerSchemaPath, "utf8");
  const challengerPrompt = await loadPrompt("challenger", {
    CASE_ID: loadedCase.manifest.id,
    CASE_CONTEXT: JSON.stringify({
      ...commonContext,
      policy: loadedCase.policy,
      evidenceLedger: ledger,
      proposal: maintainer.output,
      candidateDiff,
      commandResults,
    }, null, 2),
    OUTPUT_CONTRACT: challengerContract,
  });
  const challengerTrajectory = join(runRoot, "trajectories", "challenger.jsonl");
  const challenger = await input.runner.run({
    runId,
    role: "challenger",
    caseId: loadedCase.manifest.id,
    workspace,
    prompt: challengerPrompt,
    outputSchemaPath: challengerSchemaPath,
    model: input.model,
    timeoutMs: input.timeoutMs,
    trajectoryPath: challengerTrajectory,
    parse: (value) => ChallengerVerdictSchema.parse(value),
  });
  if (challenger.mode !== maintainer.mode) {
    throw new Error("Maintainer and Challenger modes must match");
  }
  await writeJson(join(runRoot, "challenger-verdict.json"), challenger.output);

  const oracle = await loadOracle(input.caseDir);
  const gate = await runDeterministicGate({
    loadedCase,
    oracle,
    workspace,
    before,
    after,
    proposal: maintainer.output,
    challenger: challenger.output,
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
    "evidence.jsonl",
    "maintainer-proposal.json",
    "candidate-diff.json",
    "challenger-verdict.json",
    "before-tree.json",
    "after-tree.json",
    "command-results.json",
    "gate.json",
    "approval.json",
    "trajectories/maintainer.jsonl",
    "trajectories/challenger.jsonl",
  ];
  const usages = [maintainer.tokenUsage, challenger.tokenUsage].filter(
    (usage): usage is { input: number; output: number } => Boolean(usage),
  );
  const manifest = RunManifestSchema.parse({
    schemaVersion: 1,
    projectId: PROJECT_ID,
    runId,
    caseId: loadedCase.manifest.id,
    arm: "advanced",
    mode: maintainer.mode,
    model: input.model,
    startedAt: maintainer.startedAt,
    finishedAt,
    durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(maintainer.startedAt).getTime()),
    timeoutMs: input.timeoutMs,
    promptSha256: sha256Json({ maintainer: maintainerPrompt, challenger: challengerPrompt }),
    outputSchemaSha256: sha256Json({ maintainer: proposalContract, challenger: challengerContract }),
    caseSetSha256: sha256Json({ caseId: loadedCase.manifest.id, workspaceHash: loadedCase.workspaceHash }),
    trajectoryPaths: [maintainerTrajectory, challengerTrajectory].map((path) =>
      relative(runRoot, path).replaceAll("\\", "/"),
    ),
    artifactSha256: await hashArtifacts(runRoot, artifactPaths),
    tokenUsage: usages.length > 0
      ? {
          input: usages.reduce((sum, usage) => sum + usage.input, 0),
          cachedInput: 0,
          output: usages.reduce((sum, usage) => sum + usage.output, 0),
        }
      : null,
    outcome: gate.status,
  });
  await writeJson(join(runRoot, "manifest.json"), manifest);
  return manifest;
}
