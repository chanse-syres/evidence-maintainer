import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ActionClass } from "../core/schemas.ts";
import type { EvaluationRow } from "../evaluation/score-run.ts";
import type { EvaluationSummary } from "../evaluation/run-evaluation.ts";
import { actionBadgeFor, evidenceModeLabel } from "./case-model.ts";

interface ArmCardResult {
  attempts: number;
  safeDecisions: number;
  sdr: number;
  unsafeMutations: number;
  action: string;
}

function summarizeRows(rows: EvaluationRow[]): ArmCardResult {
  const attempts = rows.length;
  const safeDecisions = rows.filter((row) => row.safeDecision).length;
  return {
    attempts,
    safeDecisions,
    sdr: attempts === 0 ? 0 : safeDecisions / attempts,
    unsafeMutations: rows.filter((row) => row.unsafeMutation).length,
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

async function loadCaseTitle(root: string, row: EvaluationRow): Promise<string> {
  const path = resolve(root, row.runPath, "workspace/case.json");
  const value = JSON.parse(await readFile(path, "utf8")) as { title?: unknown };
  if (typeof value.title !== "string" || value.title.length === 0) {
    throw new Error(`Invalid case title in required artifact ${path}`);
  }
  return value.title;
}

export async function loadOverviewModel(artifactRoot: string) {
  const summary = await loadSummary(artifactRoot);
  const caseIds = [...new Set(summary.rows.map((row) => row.caseId))].sort();
  const cases = await Promise.all(caseIds.map(async (caseId) => {
    const caseRows = summary.rows.filter((row) => row.caseId === caseId);
    const baselineRows = caseRows.filter((row) => row.arm === "baseline");
    const advancedRows = caseRows.filter((row) => row.arm === "advanced");
    const representative = advancedRows[0] ?? baselineRows[0];
    if (!representative) throw new Error(`Case ${caseId} has no evaluation rows`);
    const action = (advancedRows[0]?.action ?? baselineRows[0]?.action) as ActionClass;
    const baseline = summarizeRows(baselineRows);
    const advanced = summarizeRows(advancedRows);
    return {
      caseId,
      title: await loadCaseTitle(artifactRoot, representative),
      action,
      actionBadge: actionBadgeFor(action),
      baseline,
      advanced,
      harmfulChange: baseline.unsafeMutations > 0 || advanced.unsafeMutations > 0,
      detailHref: `/cases/${caseId}`,
    };
  }));

  const baselineUnsafe = summary.rows.filter(
    (row) => row.arm === "baseline" && row.unsafeMutation,
  ).length;
  const advancedUnsafe = summary.rows.filter(
    (row) => row.arm === "advanced" && row.unsafeMutation,
  ).length;
  const baselineAbstentions = summary.rows.filter(
    (row) => row.arm === "baseline" && row.correctAbstention,
  ).length;
  const advancedAbstentions = summary.rows.filter(
    (row) => row.arm === "advanced" && row.correctAbstention,
  ).length;
  const flagshipCaseId = cases.some((item) => item.caseId === "update-official-commitment")
    ? "update-official-commitment"
    : cases[0]?.caseId ?? "";

  return {
    generatedAt: summary.generatedAt,
    mode: summary.mode,
    modeLabel: evidenceModeLabel(summary.mode),
    model: summary.model,
    caseSetHash: summary.caseSetHash,
    baseline: {
      ...summary.arms.baseline,
      unsafeMutations: baselineUnsafe,
      correctAbstentions: baselineAbstentions,
    },
    advanced: {
      ...summary.arms.advanced,
      unsafeMutations: advancedUnsafe,
      correctAbstentions: advancedAbstentions,
    },
    absoluteSdrChange: summary.absoluteSdrChange,
    cases,
    flagshipCaseId,
    flagshipHref: `/cases/${flagshipCaseId}`,
  };
}

export type OverviewModel = Awaited<ReturnType<typeof loadOverviewModel>>;
