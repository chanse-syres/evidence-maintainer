import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { CodexRunner } from "../agents/codex-runner.ts";
import { RecordedRunner } from "../agents/recorded-runner.ts";
import type { AgentRunner } from "../agents/runner.ts";
import { loadPublicCase } from "../core/case-loader.ts";
import { sha256Json } from "../core/canonical-json.ts";
import { CaseOracleSchema } from "../core/schemas.ts";
import { runAdvanced } from "../workflows/advanced.ts";
import { runBaseline } from "../workflows/baseline.ts";
import { aggregateRows, type AggregateSummary } from "./aggregate.ts";
import { scoreRun, type EvaluationRow } from "./score-run.ts";

export interface RunEvaluationConfig {
  caseIds: string[];
  trials: number;
  mode: "live" | "recorded";
  model: string;
  timeoutMs: number;
  outDir: string;
  caseRoot?: string;
  runner?: AgentRunner;
}

export interface EvaluationSummary extends AggregateSummary {
  schemaVersion: 1;
  generatedAt: string;
  caseSetHash: string;
  model: string;
  mode: "live" | "recorded";
  trialsPerCase: number;
  rows: EvaluationRow[];
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
}): EvaluationRow {
  const requiredReview = input.expectedAction === "HUMAN_REVIEW";
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
    regressionPreserved: false,
    evidenceSupported: false,
    safeDecision: false,
    unsafeMutation: false,
    correctAbstention: false,
    reviewReady: false,
    evidenceDefect: false,
    unnecessaryEscalation: false,
    missedRequiredEscalation: requiredReview,
    avoidableHumanIntervention: !requiredReview,
    estimatedHumanTouch: true,
    durationMs: null,
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    totalTokens: null,
    changedFiles: [],
    runPath: input.runPath,
  };
}

export async function runEvaluation(config: RunEvaluationConfig): Promise<EvaluationSummary> {
  if (config.caseIds.length === 0) throw new Error("Evaluation requires at least one case");
  if (!Number.isInteger(config.trials) || config.trials <= 0) throw new Error("Trials must be a positive integer");
  const outDir = resolve(config.outDir);
  const caseRoot = resolve(config.caseRoot ?? "cases");
  await mkdir(join(outDir, "runs"), { recursive: true });
  const runner = config.runner ?? (
    config.mode === "recorded"
      ? new RecordedRunner(resolve("artifacts", "recorded", "runner-fixtures.json"))
      : new CodexRunner()
  );
  const caseHashes = [];
  const expectedActions = new Map<string, string>();
  for (const caseId of config.caseIds) {
    const caseDir = join(caseRoot, caseId);
    const loaded = await loadPublicCase(caseDir);
    const oracle = CaseOracleSchema.parse(JSON.parse(await readFile(join(caseDir, "oracle.json"), "utf8")));
    caseHashes.push({ caseId, workspaceHash: loaded.workspaceHash });
    expectedActions.set(caseId, oracle.expectedAction);
  }
  const rows: EvaluationRow[] = [];
  for (const caseId of config.caseIds) {
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
          await writeJson(join(runPath, "error.json"), {
            caseId,
            arm,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
          rows.push(createExecutionErrorRow({
            caseId,
            arm,
            mode: config.mode,
            model: config.model,
            runPath: relative(outDir, runPath).replaceAll("\\", "/"),
            expectedAction: expectedActions.get(caseId)!,
            trial,
          }));
        }
      }
    }
  }
  const aggregate = aggregateRows(rows);
  const summary: EvaluationSummary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    caseSetHash: sha256Json(caseHashes),
    model: config.model,
    mode: config.mode,
    trialsPerCase: config.trials,
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
