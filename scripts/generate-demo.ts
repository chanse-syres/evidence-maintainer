import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256Json } from "../src/core/canonical-json.ts";
import type { EvaluationSummary } from "../src/evaluation/run-evaluation.ts";
import { renderDecisionReport } from "../src/reports/render-decision-report.ts";

const evaluationRoot = resolve("artifacts/evaluation/recorded-core");
const demoRoot = resolve("artifacts/demo");
const demoReports = resolve(demoRoot, "reports");
const publicReports = resolve("public/reports");

export async function generateDemo(): Promise<void> {
  const summary = JSON.parse(
    await readFile(resolve(evaluationRoot, "summary.json"), "utf8"),
  ) as EvaluationSummary;
  const caseIds = [...new Set(summary.rows.map((row) => row.caseId))].sort();

  await mkdir(demoRoot, { recursive: true });
  await rm(demoReports, { recursive: true, force: true });
  await rm(publicReports, { recursive: true, force: true });
  await mkdir(demoReports, { recursive: true });
  await mkdir(publicReports, { recursive: true });

  const reports = [];
  for (const caseId of caseIds) {
    const runDir = resolve(evaluationRoot, "runs", caseId, "trial-1", "advanced");
    const html = await renderDecisionReport(runDir);
    const filename = `${caseId}.html`;
    await Promise.all([
      writeFile(resolve(demoReports, filename), html, "utf8"),
      writeFile(resolve(publicReports, filename), html, "utf8"),
    ]);
    reports.push({
      caseId,
      path: `reports/${filename}`,
      sha256: sha256Json({ html }),
    });
  }

  await writeFile(resolve(demoRoot, "manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: summary.generatedAt,
    sourceMode: summary.mode,
    sourceModel: summary.model,
    caseSetHash: summary.caseSetHash,
    summary: {
      baselineSdr: summary.arms.baseline.sdr,
      advancedSdr: summary.arms.advanced.sdr,
      absoluteSdrChange: summary.absoluteSdrChange,
    },
    reports,
  }, null, 2)}\n`, "utf8");
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await generateDemo();
  process.stdout.write(`Generated ${resolve(demoRoot)} and ${resolve(publicReports)}\n`);
}
