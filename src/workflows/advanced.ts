import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { ModelExecutionError, type AgentResult } from "../agents/runner.ts";
import { loadPrompt } from "../agents/prompt-loader.ts";
import { readAgentVisibleSnapshot } from "../core/agent-visible-snapshot.ts";
import { copyCaseWorkspaceV4, loadPublicCaseV4 } from "../core/case-loader.ts";
import { sha256Json, sha256Text } from "../core/canonical-json.ts";
import { buildEvidenceLedger } from "../core/evidence-ledger.ts";
import { PROJECT_ID } from "../core/project.ts";
import {
  ChallengerCritiqueSchema,
  DecisionPackageSchema,
  RunManifestSchema,
  type RunManifest,
} from "../core/schemas.ts";
import { snapshotTree, type TreeSnapshot } from "../core/tree-snapshot.ts";
import { buildTokenUsageAccounting } from "../evaluation/token-usage-accounting.ts";
import { recordApproval } from "./approval.ts";
import type { RunBaselineInput } from "./baseline.ts";
import { finalizeDecision } from "./finalize-decision.ts";

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

async function assertPublicWorkspaceUnchanged(
  workspace: string,
  before: TreeSnapshot,
  role: string,
): Promise<void> {
  const after = await snapshotTree(workspace);
  if (after.sha256 !== before.sha256) {
    throw new ModelExecutionError(
      "INVALID_OPERATION",
      `${role} modified the read-only public workspace.`,
    );
  }
}

function assertSameMode(results: Array<AgentResult<unknown>>): void {
  if (new Set(results.map((result) => result.mode)).size !== 1) {
    throw new Error("Maintainer, Challenger, and Reviser modes must match");
  }
}

export async function runAdvanced(input: RunBaselineInput): Promise<RunManifest> {
  const runRoot = resolve(input.runRoot);
  await mkdir(join(runRoot, "trajectories"), { recursive: true });
  const loadedCase = await loadPublicCaseV4(input.caseDir);
  const agentWorkspace = await copyCaseWorkspaceV4(
    input.caseDir,
    join(runRoot, "agent-workspace"),
  );
  const publicWorkspace = await snapshotTree(agentWorkspace);
  const ledger = buildEvidenceLedger(loadedCase);
  await writeFile(
    join(runRoot, "evidence.jsonl"),
    `${ledger.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );

  const runId = `${loadedCase.manifest.id}-advanced-${Date.now()}`;
  const decisionSchemaPath = resolve("schemas", "decision-package.schema.json");
  const decisionContract = await readFile(decisionSchemaPath, "utf8");
  const critiqueSchemaPath = resolve("schemas", "challenger-critique.schema.json");
  const critiqueContract = await readFile(critiqueSchemaPath, "utf8");
  const agentVisibleWorkspace = await readAgentVisibleSnapshot(
    agentWorkspace,
    loadedCase.manifest.agentVisibleFiles,
  );
  const publicContext = {
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
  };

  const maintainerPrompt = await loadPrompt("maintainer", {
    CASE_ID: loadedCase.manifest.id,
    CASE_CONTEXT: JSON.stringify(publicContext, null, 2),
    EVIDENCE_LEDGER: ledger.map((event) => JSON.stringify(event)).join("\n"),
    OUTPUT_CONTRACT: decisionContract,
  });
  const maintainerTrajectory = join(runRoot, "trajectories", "maintainer.jsonl");
  const maintainer = await input.runner.run({
    runId,
    role: "maintainer",
    caseId: loadedCase.manifest.id,
    workspace: agentWorkspace,
    prompt: maintainerPrompt,
    outputSchemaPath: decisionSchemaPath,
    model: input.model,
    timeoutMs: input.timeoutMs,
    trajectoryPath: maintainerTrajectory,
    parse: (value) => DecisionPackageSchema.parse(value),
  });
  await assertPublicWorkspaceUnchanged(agentWorkspace, publicWorkspace, "Maintainer");
  await writeJson(join(runRoot, "draft-decision.json"), maintainer.output);

  const challengerPrompt = await loadPrompt("challenger", {
    CASE_ID: loadedCase.manifest.id,
    CASE_CONTEXT: JSON.stringify({
      publicCase: publicContext,
      draftDecision: maintainer.output,
    }, null, 2),
    OUTPUT_CONTRACT: critiqueContract,
  });
  const challengerTrajectory = join(runRoot, "trajectories", "challenger.jsonl");
  const challenger = await input.runner.run({
    runId,
    role: "challenger",
    caseId: loadedCase.manifest.id,
    workspace: agentWorkspace,
    prompt: challengerPrompt,
    outputSchemaPath: critiqueSchemaPath,
    model: input.model,
    timeoutMs: input.timeoutMs,
    trajectoryPath: challengerTrajectory,
    parse: (value) => ChallengerCritiqueSchema.parse(value),
  });
  await assertPublicWorkspaceUnchanged(agentWorkspace, publicWorkspace, "Challenger");
  await writeJson(join(runRoot, "challenger-critique.json"), challenger.output);

  const reviserPrompt = await loadPrompt("revision", {
    CASE_ID: loadedCase.manifest.id,
    CASE_CONTEXT: JSON.stringify({
      publicCase: publicContext,
      draftDecision: maintainer.output,
      challengerCritique: challenger.output,
    }, null, 2),
    OUTPUT_CONTRACT: decisionContract,
  });
  const reviserTrajectory = join(runRoot, "trajectories", "reviser.jsonl");
  const reviser = await input.runner.run({
    runId,
    role: "reviser",
    caseId: loadedCase.manifest.id,
    workspace: agentWorkspace,
    prompt: reviserPrompt,
    outputSchemaPath: decisionSchemaPath,
    model: input.model,
    timeoutMs: input.timeoutMs,
    trajectoryPath: reviserTrajectory,
    parse: (value) => DecisionPackageSchema.parse(value),
  });
  await assertPublicWorkspaceUnchanged(agentWorkspace, publicWorkspace, "Reviser");
  assertSameMode([maintainer, challenger, reviser]);

  const { gate } = await finalizeDecision({
    caseDir: input.caseDir,
    runRoot,
    package: reviser.output,
    submissionMode: true,
    liveWriteAttempted: false,
  });
  const approval = recordApproval({
    caseId: loadedCase.manifest.id,
    requested: input.approve,
    gateStatus: gate.status,
  });
  await writeJson(join(runRoot, "approval.json"), approval);

  const finishedAt = new Date().toISOString();
  const artifactPaths = [
    "evidence.jsonl",
    "draft-decision.json",
    "challenger-critique.json",
    "final-decision.json",
    "before-tree.json",
    "after-tree.json",
    "command-results.json",
    "gate.json",
    "approval.json",
    "trajectories/maintainer.jsonl",
    "trajectories/challenger.jsonl",
    "trajectories/reviser.jsonl",
  ];
  const sessions = [maintainer, challenger, reviser];
  const proxyLedgerPaths = sessions
    .map((session) => session.proxyLedgerPath)
    .filter((path): path is string => Boolean(path))
    .map((path) => relative(runRoot, path).replaceAll("\\", "/"));
  artifactPaths.push(...proxyLedgerPaths);
  const usageAccounting = sessions.every((session) => session.proxyRequestUsageCoverage)
    ? buildTokenUsageAccounting(sessions.map((session) => ({
        role: session.role,
        usage: session.tokenUsage,
        source: session.tokenUsageSource,
        trajectoryPath: relative(runRoot, session.trajectoryPath).replaceAll("\\", "/"),
        proxyLedgerPath: session.proxyLedgerPath
          ? relative(runRoot, session.proxyLedgerPath).replaceAll("\\", "/")
          : undefined,
        trajectoryAggregateCaptured: session.trajectoryAggregateCaptured ?? false,
        proxyRequestCoverage: session.proxyRequestUsageCoverage!,
      })))
    : null;
  const manifest = RunManifestSchema.parse({
    schemaVersion: 2,
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
    promptSha256: sha256Json({
      maintainer: maintainerPrompt,
      challenger: challengerPrompt,
      reviser: reviserPrompt,
    }),
    outputSchemaSha256: sha256Json({
      maintainer: decisionContract,
      challenger: critiqueContract,
      reviser: decisionContract,
    }),
    caseSetSha256: sha256Json({ caseId: loadedCase.manifest.id, workspaceHash: loadedCase.workspaceHash }),
    trajectoryPaths: sessions.map((session) =>
      relative(runRoot, session.trajectoryPath).replaceAll("\\", "/")
    ),
    proxyLedgerPaths,
    artifactSha256: await hashArtifacts(runRoot, artifactPaths),
    tokenUsage: usageAccounting?.tokenUsage ?? null,
    tokenUsageAccounting: usageAccounting?.tokenUsageAccounting ?? null,
    runtimeImages: sessions.every((session) => session.runtimeImageId)
      ? sessions.map((session) => ({
          role: session.role,
          imageId: session.runtimeImageId!.replace(/^sha256:/, ""),
        }))
      : null,
    outcome: gate.status,
  });
  await writeJson(join(runRoot, "manifest.json"), manifest);
  return manifest;
}
