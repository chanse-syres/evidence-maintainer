import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { CodexRunner } from "../agents/codex-runner.ts";
import { RecordedRunner } from "../agents/recorded-runner.ts";
import { ModelExecutionError, type AgentRunner } from "../agents/runner.ts";
import { loadOracleV4, loadPublicCaseV4 } from "../core/case-loader.ts";
import { sha256Json, sha256Text } from "../core/canonical-json.ts";
import { snapshotTree } from "../core/tree-snapshot.ts";
import { runAdvanced } from "../workflows/advanced.ts";
import { runBaseline } from "../workflows/baseline.ts";
import { aggregateRows, type AggregateSummary } from "./aggregate.ts";
import {
  failureClasses,
  scoreRun,
  type EvaluationRow,
  type FailureClass,
} from "./score-run.ts";
import { reconstructAvailableUsage, type TrajectoryUsage } from "./trajectory-usage.ts";

export interface RunEvaluationConfig {
  caseIds: string[];
  trials: number;
  mode: "live" | "recorded";
  model: string;
  timeoutMs: number;
  outDir: string;
  caseRoot?: string;
  lockPath?: string;
  runner?: AgentRunner;
  evaluatorInvalidations?: EvaluatorInvalidationInput[];
}

export interface EvaluatorInvalidationInput {
  caseId: string;
  reason: string;
  receiptPath: string;
}

export interface EvaluationSummary extends AggregateSummary {
  schemaVersion: 2;
  generatedAt: string;
  caseSetHash: string;
  caseDefinitionSetHash: string;
  model: string;
  mode: "live" | "recorded";
  trialsPerCase: number;
  selection: {
    selectedCaseCount: number;
    includedCaseCount: number;
    excludedCaseCount: number;
    selectedCaseSetHash: string;
    selectedCaseDefinitionSetHash: string;
    includedCaseIds: string[];
    excludedCaseIds: string[];
  };
  failureTaxonomy: Record<FailureClass, number>;
  comparisonDesign: {
    class: "SYSTEM_LEVEL_NON_COMPUTE_MATCHED";
    baselineSessions: 1;
    advancedSessions: 3;
    attribution: string;
  };
  lockVerification: {
    lockSha256: string;
    evaluationHarnessCommit: string;
  } | null;
  rows: EvaluationRow[];
}

interface EvaluationLock {
  status: string;
  evaluationHarnessCommit: string;
  holdoutTreeHash: string;
  caseSetHash: string;
  caseDefinitionSetHash: string;
  model: string;
  mode: "live" | "recorded";
  trialsPerCase: number;
  timeoutMs: number;
  cases: Array<{ caseId: string; workspaceHash: string }>;
  contracts: Record<string, string>;
}

const EXECUTION_PATHS = [
  "package.json",
  "package-lock.json",
  "scripts/evaluate.ts",
  "docker",
  "src/agents",
  "src/core",
  "src/evaluation",
  "src/workflows",
  "prompts",
  "schemas",
];

function git(args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile("git", args, { cwd: process.cwd(), windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Evaluation-lock Git check failed: ${stderr.trim() || error.message}`));
        return;
      }
      resolvePromise(stdout.trim());
    });
  });
}

async function verifyEvaluationLock(input: {
  lockPath: string;
  config: RunEvaluationConfig;
  caseRoot: string;
  caseHashes: Array<{ caseId: string; workspaceHash: string }>;
  caseSetHash: string;
  caseDefinitionSetHash: string;
}): Promise<EvaluationSummary["lockVerification"]> {
  const lockText = await readFile(resolve(input.lockPath), "utf8");
  const lock = JSON.parse(lockText) as EvaluationLock;
  if (lock.status !== "FROZEN_BEFORE_MODEL_EXECUTION") throw new Error("Evaluation lock is not frozen");
  if (lock.model !== input.config.model || lock.mode !== input.config.mode) {
    throw new Error("Evaluation lock model or mode mismatch");
  }
  if (lock.trialsPerCase !== input.config.trials || lock.timeoutMs !== input.config.timeoutMs) {
    throw new Error("Evaluation lock trial count or timeout mismatch");
  }
  const caseHashes = [...input.caseHashes].sort((left, right) => left.caseId.localeCompare(right.caseId));
  const lockedCases = [...lock.cases].sort((left, right) => left.caseId.localeCompare(right.caseId));
  if (JSON.stringify(caseHashes) !== JSON.stringify(lockedCases)) {
    throw new Error("Evaluation lock case IDs or workspace hashes mismatch");
  }
  if (lock.caseSetHash !== input.caseSetHash) throw new Error("Evaluation lock case-set hash mismatch");
  if (lock.caseDefinitionSetHash !== input.caseDefinitionSetHash) {
    throw new Error("Evaluation lock full-case definition hash mismatch");
  }
  const rootTree = await snapshotTree(input.caseRoot);
  if (lock.holdoutTreeHash !== rootTree.sha256) throw new Error("Evaluation lock holdout tree hash mismatch");
  for (const [path, expectedHash] of Object.entries(lock.contracts)) {
    const actualHash = sha256Text(await readFile(resolve(path)));
    if (actualHash !== expectedHash) {
      throw new Error(`Evaluation lock contract hash mismatch: ${path}`);
    }
  }
  const resolvedCommit = await git(["rev-parse", "--verify", `${lock.evaluationHarnessCommit}^{commit}`]);
  if (resolvedCommit !== lock.evaluationHarnessCommit) throw new Error("Evaluation harness commit did not resolve exactly");
  const changed = await git(["diff", "--name-only", resolvedCommit, "--", ...EXECUTION_PATHS]);
  const untrackedOrModified = await git(["status", "--porcelain=v1", "--", ...EXECUTION_PATHS]);
  if (changed || untrackedOrModified) {
    throw new Error(`Execution inputs differ from the frozen harness commit: ${changed || untrackedOrModified}`);
  }
  return {
    lockSha256: sha256Text(lockText),
    evaluationHarnessCommit: resolvedCommit,
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function createExecutionErrorRow(input: {
  caseId: string;
  arm: "baseline" | "advanced";
  mode: "live" | "recorded";
  model: string;
  runPath: string;
  expectedAction: string;
  trial: number;
  tokenUsage?: TrajectoryUsage | null;
}): EvaluationRow {
  const tokenUsage = input.tokenUsage ?? null;
  return {
    runId: `${input.caseId}-${input.arm}-trial-${input.trial}-error`,
    caseId: input.caseId,
    arm: input.arm,
    mode: input.mode,
    model: input.model,
    action: "ERROR",
    expectedAction: input.expectedAction,
    actionCorrect: false,
    artifactCorrect: false,
    noForbiddenMutation: false,
    requiredCommandsPassed: false,
    sourceCoverage: false,
    contradictionFree: false,
    annotationAligned: false,
    operationalDecisionIntegrity: false,
    failureClass: "MODEL_EXECUTION",
    durationMs: null,
    inputTokens: tokenUsage?.input ?? null,
    cachedInputTokens: tokenUsage?.cachedInput ?? null,
    outputTokens: tokenUsage?.output ?? null,
    totalTokens: tokenUsage ? tokenUsage.input + tokenUsage.output : null,
    changedFiles: [],
    runPath: input.runPath,
  };
}

export async function runEvaluation(config: RunEvaluationConfig): Promise<EvaluationSummary> {
  if (config.caseIds.length === 0) throw new Error("Evaluation requires at least one case");
  if (new Set(config.caseIds).size !== config.caseIds.length) {
    throw new Error("Evaluation case IDs must be unique");
  }
  if (!Number.isInteger(config.trials) || config.trials <= 0) throw new Error("Trials must be a positive integer");
  const outDir = resolve(config.outDir);
  const caseRoot = resolve(config.caseRoot ?? "cases");
  await mkdir(join(outDir, "runs"), { recursive: true });
  const runner = config.runner ?? (
    config.mode === "recorded"
      ? new RecordedRunner(resolve("artifacts", "recorded", "runner-fixtures.json"))
      : new CodexRunner()
  );

  const invalidationInputs = config.evaluatorInvalidations ?? [];
  const invalidatedIds = new Set<string>();
  const invalidations = [];
  for (const input of invalidationInputs) {
    if (!config.caseIds.includes(input.caseId)) {
      throw new Error(`Evaluator invalidation names an unselected case: ${input.caseId}`);
    }
    if (invalidatedIds.has(input.caseId)) {
      throw new Error(`Duplicate evaluator invalidation: ${input.caseId}`);
    }
    if (!input.reason.trim()) throw new Error(`Evaluator invalidation requires a reason: ${input.caseId}`);
    const receiptText = await readFile(resolve(input.receiptPath), "utf8");
    invalidatedIds.add(input.caseId);
    invalidations.push({
      caseId: input.caseId,
      reason: input.reason,
      sourceReceiptSha256: sha256Text(receiptText),
      receipt: JSON.parse(receiptText),
    });
  }
  const includedCaseIds = config.caseIds.filter((caseId) => !invalidatedIds.has(caseId));
  if (includedCaseIds.length === 0) throw new Error("Evaluator invalidations excluded every selected case");

  const caseHashes = [];
  const caseDefinitions = [];
  const expectedActions = new Map<string, string>();
  for (const caseId of config.caseIds) {
    const caseDir = join(caseRoot, caseId);
    const loaded = await loadPublicCaseV4(caseDir);
    const oracle = await loadOracleV4(caseDir);
    caseHashes.push({ caseId, workspaceHash: loaded.workspaceHash });
    caseDefinitions.push({ caseId, sha256: (await snapshotTree(caseDir)).sha256 });
    expectedActions.set(caseId, oracle.expectedAction);
  }
  const canonicalSelectedCaseHashes = [...caseHashes].sort((left, right) => left.caseId.localeCompare(right.caseId));
  const canonicalSelectedCaseDefinitions = [...caseDefinitions].sort((left, right) => left.caseId.localeCompare(right.caseId));
  const canonicalIncludedCaseHashes = canonicalSelectedCaseHashes.filter((entry) => !invalidatedIds.has(entry.caseId));
  const canonicalIncludedCaseDefinitions = canonicalSelectedCaseDefinitions.filter((entry) => !invalidatedIds.has(entry.caseId));
  const selectedCaseSetHash = sha256Json(canonicalSelectedCaseHashes);
  const selectedCaseDefinitionSetHash = sha256Json(canonicalSelectedCaseDefinitions);
  const caseSetHash = sha256Json(canonicalIncludedCaseHashes);
  const caseDefinitionSetHash = sha256Json(canonicalIncludedCaseDefinitions);
  const lockVerification = config.lockPath
    ? await verifyEvaluationLock({
        lockPath: config.lockPath,
        config,
        caseRoot,
        caseHashes: canonicalSelectedCaseHashes,
        caseSetHash: selectedCaseSetHash,
        caseDefinitionSetHash: selectedCaseDefinitionSetHash,
      })
    : null;

  await writeJson(join(outDir, "evaluator-invalidations.json"), {
    schemaVersion: 1,
    selectedCaseIds: [...config.caseIds].sort(),
    includedCaseIds: [...includedCaseIds].sort(),
    invalidations,
  });

  const rows: EvaluationRow[] = [];
  for (const caseId of includedCaseIds) {
    for (let trial = 1; trial <= config.trials; trial += 1) {
      for (const arm of ["baseline", "advanced"] as const) {
        const runPath = join(outDir, "runs", caseId, `trial-${trial}`, arm);
        await rm(runPath, { recursive: true, force: true });
        await mkdir(runPath, { recursive: true });
        try {
          const run = arm === "baseline" ? runBaseline : runAdvanced;
          await run({
            caseDir: join(caseRoot, caseId),
            runRoot: runPath,
            runner,
            model: config.model,
            timeoutMs: config.timeoutMs,
            approve: true,
          });
          const row = await scoreRun(runPath, { expectedAction: expectedActions.get(caseId)! });
          row.runPath = relative(outDir, runPath).replaceAll("\\", "/");
          rows.push(row);
        } catch (error) {
          const classification: FailureClass = error instanceof ModelExecutionError
            ? "MODEL_EXECUTION"
            : "INFRASTRUCTURE";
          await writeJson(join(runPath, "error.json"), {
            caseId,
            arm,
            classification,
            kind: error instanceof ModelExecutionError ? error.kind : null,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
          if (!(error instanceof ModelExecutionError)) throw error;
          const tokenUsage = await reconstructAvailableUsage(runPath);
          rows.push(createExecutionErrorRow({
            caseId,
            arm,
            mode: config.mode,
            model: config.model,
            runPath: relative(outDir, runPath).replaceAll("\\", "/"),
            expectedAction: expectedActions.get(caseId)!,
            trial,
            tokenUsage,
          }));
        }
      }
    }
  }

  const failureTaxonomy = Object.fromEntries(
    failureClasses.map((failureClass) => [
      failureClass,
      rows.filter((row) => row.failureClass === failureClass).length,
    ]),
  ) as Record<FailureClass, number>;
  failureTaxonomy.EVALUATOR_INVALID = invalidations.length * config.trials * 2;
  const aggregate = aggregateRows(rows);
  const summary: EvaluationSummary = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    caseSetHash,
    caseDefinitionSetHash,
    model: config.model,
    mode: config.mode,
    trialsPerCase: config.trials,
    selection: {
      selectedCaseCount: config.caseIds.length,
      includedCaseCount: includedCaseIds.length,
      excludedCaseCount: invalidations.length,
      selectedCaseSetHash,
      selectedCaseDefinitionSetHash,
      includedCaseIds: [...includedCaseIds].sort(),
      excludedCaseIds: [...invalidatedIds].sort(),
    },
    failureTaxonomy,
    comparisonDesign: {
      class: "SYSTEM_LEVEL_NON_COMPUTE_MATCHED",
      baselineSessions: 1,
      advancedSessions: 3,
      attribution: "Observed differences apply to the complete workflows, not to critique quality alone.",
    },
    lockVerification,
    ...aggregate,
    rows,
  };
  await writeFile(join(outDir, "rows.jsonl"), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  await writeJson(join(outDir, "summary.json"), summary);
  return summary;
}

export async function resolveCaseSelection(selection: string, caseRoot = "cases"): Promise<string[]> {
  const core = [
    "update-official-commitment",
    "update-transfer-destination",
    "update-authoritative-rating",
    "repair-selector-drift",
    "repair-json-nesting",
    "repair-pagination",
    "retry-deferred-406",
    "retry-timeout-cache",
    "retry-partial-document",
    "noop-duplicate-news",
    "noop-newer-publication-stale-effective",
    "noop-filtered-removal",
  ];
  if (selection === "core") return core;
  if (selection === "all") {
    return (await readdir(resolve(caseRoot), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  }
  const ids = selection.split(",").map((value) => value.trim()).filter(Boolean);
  if (ids.length === 0) throw new Error("No case IDs were selected");
  return ids;
}
