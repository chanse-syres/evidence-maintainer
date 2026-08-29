import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ActionClass } from "../core/schemas.ts";
import type { EvaluationRow } from "../evaluation/score-run.ts";
import type { EvaluationSummary } from "../evaluation/run-evaluation.ts";
import { actionBadgeFor, evidenceModeLabel } from "./case-model.ts";

interface ArmCardResult {
  attempts: number;
  operationalDecisions: number;
  odi: number;
  sourceCoverage: number;
  contradictionFree: number;
  requiredCommandsPassed: number;
  annotationAligned: number;
  forbiddenMutationFailures: number;
  semanticFailures: number;
  action: string;
}

function isNormalizedRunPath(value: string): boolean {
  return value.length > 0 &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    !/^[A-Za-z]:/.test(value) &&
    !value.split("/").some((segment) => segment === "" || segment === "..");
}

function hasDecisionArtifacts(row: EvaluationRow): boolean {
  return row.failureClass !== "MODEL_EXECUTION" && isNormalizedRunPath(row.runPath);
}

function summarizeRows(rows: EvaluationRow[]): ArmCardResult {
  const attempts = rows.length;
  const operationalDecisions = rows.filter((row) => row.operationalDecisionIntegrity).length;
  return {
    attempts,
    operationalDecisions,
    odi: attempts === 0 ? 0 : operationalDecisions / attempts,
    sourceCoverage: rows.filter((row) => row.sourceCoverage).length,
    contradictionFree: rows.filter((row) => row.contradictionFree).length,
    requiredCommandsPassed: rows.filter((row) => row.requiredCommandsPassed).length,
    annotationAligned: rows.filter((row) => row.annotationAligned).length,
    forbiddenMutationFailures: rows.filter((row) => !row.noForbiddenMutation).length,
    semanticFailures: rows.filter((row) => row.failureClass === "GENUINE_SEMANTIC_FAILURE").length,
    action: rows[0]?.action ?? "UNKNOWN",
  };
}

async function loadSummary(root: string): Promise<EvaluationSummary> {
  const path = join(root, "summary.json");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Missing required artifact ${path}`);
    }
    throw error;
  }
  const summary = JSON.parse(text) as EvaluationSummary;
  if (!Array.isArray(summary.rows) || !summary.arms?.baseline || !summary.arms?.advanced) {
    throw new Error(`Invalid evaluation summary ${path}`);
  }
  return summary;
}

async function loadCaseTitle(root: string, caseId: string, rows: EvaluationRow[]): Promise<string> {
  for (const row of rows) {
    if (!isNormalizedRunPath(row.runPath)) continue;
    const path = resolve(root, ...row.runPath.split("/"), "workspace", "case.json");
    try {
      const value = JSON.parse(await readFile(path, "utf8")) as { title?: unknown };
      if (typeof value.title === "string" && value.title.length > 0) return value.title;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return caseId.split("-").map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" ");
}

export async function loadOverviewModel(artifactRoot: string) {
  const summary = await loadSummary(artifactRoot);
  const caseIds = [...new Set(summary.rows.map((row) => row.caseId))].sort();
  const cases = await Promise.all(caseIds.map(async (caseId) => {
    const caseRows = summary.rows.filter((row) => row.caseId === caseId);
    const baselineRows = caseRows.filter((row) => row.arm === "baseline");
    const advancedRows = caseRows.filter((row) => row.arm === "advanced");
    const representative = advancedRows.find(hasDecisionArtifacts) ?? baselineRows.find(hasDecisionArtifacts);
    const firstRow = advancedRows[0] ?? baselineRows[0];
    if (!firstRow) throw new Error(`Case ${caseId} has no evaluation rows`);
    const action = (representative?.action ?? firstRow.expectedAction ?? "HUMAN_REVIEW") as ActionClass;
    const baseline = summarizeRows(baselineRows);
    const advanced = summarizeRows(advancedRows);
    return {
      caseId,
      title: await loadCaseTitle(artifactRoot, caseId, [
        ...(representative ? [representative] : []),
        ...advancedRows,
        ...baselineRows,
      ]),
      action,
      actionBadge: actionBadgeFor(action),
      baseline,
      advanced,
      harmfulChange: baseline.forbiddenMutationFailures > 0 || advanced.forbiddenMutationFailures > 0,
      detailHref: representative ? `/cases/${caseId}` : null,
      detailRunPath: representative?.runPath ?? null,
    };
  }));

  const inspectableCases = cases.filter((item) => item.detailRunPath !== null);
  const flagshipCaseId = inspectableCases.some((item) => item.caseId === "retry-shard-watermark-barrier")
    ? "retry-shard-watermark-barrier"
    : inspectableCases[0]?.caseId ?? null;

  return {
    generatedAt: summary.generatedAt,
    mode: summary.mode,
    modeLabel: evidenceModeLabel(summary.mode),
    model: summary.model,
    caseSetHash: summary.caseSetHash,
    baseline: summary.arms.baseline,
    advanced: summary.arms.advanced,
    absoluteOdiChange: summary.absoluteOdiChange,
    odiBootstrap95: summary.odiBootstrap95,
    selection: summary.selection,
    resourceComparison: summary.resourceComparison,
    cases,
    flagshipCaseId,
    flagshipHref: flagshipCaseId === null ? null : `/cases/${flagshipCaseId}`,
  };
}

export type OverviewModel = Awaited<ReturnType<typeof loadOverviewModel>>;
