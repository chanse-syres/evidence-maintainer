import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256Text } from "../src/core/canonical-json.ts";
import { renderDecisionReport } from "../src/reports/render-decision-report.ts";
import { loadOverviewModel } from "../src/ui/overview-model.ts";
import { loadPublicComparisonSelection } from "../src/ui/public-comparison.ts";

const publicReports = resolve("public", "reports");

export async function generateSelectedReports(): Promise<void> {
  const selection = await loadPublicComparisonSelection();
  if (selection.state !== "selected") {
    throw new Error("Public decision reports require a selected comparison campaign");
  }

  const overview = await loadOverviewModel(selection.evaluationRoot);
  const summaryPath = relative(process.cwd(), selection.summaryPath).replaceAll("\\", "/");
  if (summaryPath.startsWith("../") || summaryPath === "..") {
    throw new Error("Selected summary must be inside the repository");
  }
  await mkdir(dirname(publicReports), { recursive: true });
  const staging = await mkdtemp(join(dirname(publicReports), ".reports-next-"));

  const reports = [];
  try {
    for (const item of overview.cases) {
      if (item.detailRunPath === null) {
        throw new Error(`Selected case ${item.caseId} has no inspectable decision artifact`);
      }
      const runDir = resolve(selection.evaluationRoot, ...item.detailRunPath.split("/"));
      const match = /^runs\/[^/]+\/trial-(\d+)\/(baseline|advanced)$/.exec(item.detailRunPath);
      if (!match) throw new Error(`Selected case ${item.caseId} has a noncanonical report run path`);
      const invalidationReceiptPaths = overview.selection.excludedCaseIds.map(
        (caseId) => `holdout/v4/EVALUATOR-INVALIDATION-${caseId}.json`,
      );
      const html = await renderDecisionReport(runDir, {
        campaignContext: {
          campaign: selection.campaign,
          arm: match[2] as "baseline" | "advanced",
          trial: Number(match[1]),
          includedWorkflowRunCount: overview.baseline.workflowRunCount + overview.advanced.workflowRunCount,
          excludedEvaluatorInvalidCaseIds: overview.selection.excludedCaseIds,
          selectedSummaryPath: summaryPath,
          invalidationReceiptPaths,
        },
      });
      const filename = `${item.caseId}.html`;
      await writeFile(resolve(staging, filename), html, "utf8");
      reports.push({
        caseId: item.caseId,
        runPath: item.detailRunPath,
        path: `reports/${filename}`,
        sha256: sha256Text(html),
      });
    }
    await writeFile(resolve(staging, "manifest.json"), `${JSON.stringify({
      schemaVersion: 1,
      campaign: selection.campaign,
      summaryPath,
      caseSetHash: overview.caseSetHash,
      generatedAt: overview.generatedAt,
      includedWorkflowRunCount: overview.baseline.workflowRunCount + overview.advanced.workflowRunCount,
      excludedEvaluatorInvalidCaseIds: overview.selection.excludedCaseIds,
      invalidationReceiptPaths: overview.selection.excludedCaseIds.map(
        (caseId) => `holdout/v4/EVALUATOR-INVALIDATION-${caseId}.json`,
      ),
      reports,
    }, null, 2)}\n`, "utf8");
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }

  const backup = `${publicReports}.previous-${process.pid}`;
  await rm(backup, { recursive: true, force: true });
  let movedExisting = false;
  try {
    await rename(publicReports, backup);
    movedExisting = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }
  try {
    await rename(staging, publicReports);
  } catch (error) {
    if (movedExisting) await rename(backup, publicReports);
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  if (movedExisting) await rm(backup, { recursive: true, force: true });
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await generateSelectedReports();
  process.stdout.write(`Generated ${publicReports}\n`);
}
