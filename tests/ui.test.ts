import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { before } from "node:test";
import { sha256Text } from "../src/core/canonical-json.ts";
import { loadCaseModel } from "../src/ui/case-model.ts";
import { loadOverviewModel } from "../src/ui/overview-model.ts";
import { loadPublicComparisonSelection } from "../src/ui/public-comparison.ts";
import { writeV4EvaluationFixture } from "./helpers/v4-run-fixture.ts";

let evaluationRoot: string;
let flagshipRun: string;

before(async () => {
  const fixture = await writeV4EvaluationFixture("v4-ui-case");
  evaluationRoot = fixture.evaluationRoot;
  flagshipRun = fixture.advancedRun;
});

test("overview page renders ODI rather than legacy SDR", async () => {
  const page = await readFile("app/page.tsx", "utf8");
  assert.match(page, /Operational Decision Integrity/);
  assert.match(page, /Measured ODI difference/);
  assert.match(page, /signedPercentagePoints/);
  assert.doesNotMatch(page, /Measured improvement/);
  assert.doesNotMatch(page, /absoluteSdrChange|\.sdr\b|Safe Decision Rate/);
});

test("case detail renders the V4 final decision rather than legacy challenge artifacts", async () => {
  const [page, model] = await Promise.all([
    readFile("app/cases/[caseId]/page.tsx", "utf8"),
    readFile("src/ui/case-model.ts", "utf8"),
  ]);
  assert.match(page, /Final decision/);
  assert.match(page, /Decision integrity checks/);
  assert.doesNotMatch(page, /Maintainer proposal|Challenger verdict|detail\.challenger|detail\.proposal/);
  assert.doesNotMatch(page, /trial-1/);
  assert.doesNotMatch(model, /artifacts\.(?:challenger|proposal)/);
});

test("public pages load the adjudicated V4 campaign while preserving the pending fallback", async () => {
  const selection = await loadPublicComparisonSelection();
  assert.equal(selection.state, "selected");
  assert.equal(selection.campaign, "holdout-v4-attempt-2");
  assert.match(selection.summaryPath, /artifacts[\\/]evaluation[\\/]holdout-v4-attempt-2[\\/]summary\.json$/);
  const overview = await loadOverviewModel(selection.evaluationRoot);
  assert.equal(overview.selection.selectedCaseCount, 5);
  assert.equal(overview.selection.includedCaseCount, 4);
  assert.equal(overview.selection.excludedCaseCount, 1);
  assert.equal(overview.baseline.operationalDecisions, 12);
  assert.equal(overview.advanced.operationalDecisions, 12);
  assert.equal(overview.absoluteOdiChange, 0);
  assert.equal(overview.resourceComparison.advancedMinusBaselineTotalDurationMs, 686_544);
  assert.equal(overview.resourceComparison.advancedMinusBaselineTotalTokens, 349_026);
  const [home, casePage] = await Promise.all([
    readFile("app/page.tsx", "utf8"),
    readFile("app/cases/[caseId]/page.tsx", "utf8"),
  ]);
  assert.match(home, /No public system comparison is selected/);
  assert.match(home, /Valid frozen cases/);
  assert.match(home, /Resource delta/);
  assert.match(home, /evaluator-invalid case excluded symmetrically/);
  assert.match(home, /advancedMinusBaselineTotalDurationMs/);
  assert.match(home, /advancedMinusBaselineTotalTokens/);
  assert.match(home, /loadPublicComparisonSelection/);
  assert.match(casePage, /loadPublicComparisonSelection/);
  assert.match(casePage, /selection\.state === "pending"/);
  assert.doesNotMatch(home, /artifacts\/evaluation\/recorded-all/);
  assert.doesNotMatch(casePage, /artifacts\/evaluation\/recorded-all/);
});

test("every selected V4 case has a public decision report", async () => {
  const selection = await loadPublicComparisonSelection();
  assert.equal(selection.state, "selected");
  const overview = await loadOverviewModel(selection.evaluationRoot);
  assert.equal(overview.cases.length, 4);
  const manifest = JSON.parse(
    await readFile(resolve("public", "reports", "manifest.json"), "utf8"),
  ) as {
    campaign: string;
    summaryPath: string;
    reports: Array<{ caseId: string; sha256: string }>;
  };
  assert.equal(manifest.campaign, "holdout-v4-attempt-2");
  assert.equal(
    manifest.summaryPath,
    "artifacts/evaluation/holdout-v4-attempt-2/summary.json",
  );
  for (const item of overview.cases) {
    const report = await readFile(resolve("public", "reports", `${item.caseId}.html`), "utf8");
    assert.match(report, new RegExp(item.caseId));
    assert.match(report, /Evidence Maintainer · Decision record/);
    assert.equal(
      manifest.reports.find((entry) => entry.caseId === item.caseId)?.sha256,
      sha256Text(report),
    );
  }
});

test("public comparison loader rejects an invalidated campaign selection", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "evidence-public-selection-"));
  const configPath = resolve(root, "public-comparison.json");
  await writeFile(configPath, JSON.stringify({
    schemaVersion: 1,
    status: "SELECTED",
    selectedCampaign: "holdout-v3",
    selectedSummary: "artifacts/evaluation/holdout-v3/summary.json",
    selectionRule: "Only valid V4 campaigns may be selected.",
    excludedCampaigns: [{
      campaign: "holdout-v3",
      invalidation: "holdout/INVALIDATION-v3.json",
    }],
  }), "utf8");
  await assert.rejects(
    loadPublicComparisonSelection(configPath),
    /invalidated campaign cannot be selected/,
  );
});

test("overview exposes a sorted, truth-labeled baseline comparison", async () => {
  const overview = await loadOverviewModel(evaluationRoot);
  assert.equal(overview.modeLabel, "Recorded evidence");
  assert.equal(overview.cases.length, 1);
  assert.equal(overview.baseline.caseCount, 1);
  assert.equal(overview.advanced.caseCount, 1);
  assert.equal(typeof overview.baseline.operationalDecisions, "number");
  assert.equal(typeof overview.advanced.operationalDecisions, "number");
  assert.equal(typeof overview.baseline.odi, "number");
  assert.equal(typeof overview.advanced.odi, "number");
  assert.deepEqual(
    overview.cases.map((item) => item.caseId),
    [...overview.cases.map((item) => item.caseId)].sort(),
  );

  const harmful = overview.cases.find((item) => item.caseId === "v4-ui-case");
  assert.equal(typeof harmful?.harmfulChange, "boolean");
  assert.equal(harmful?.harmfulChange, false);
  assert.equal(harmful?.actionBadge.label, "No action");
  assert.equal(harmful?.actionBadge.tone, "noop");
  assert.equal(typeof harmful?.baseline.odi, "number");
  assert.equal(typeof harmful?.advanced.odi, "number");
  assert.equal(harmful?.detailRunPath, "runs/v4-ui-case/trial-1/advanced");
  assert.ok(overview.flagshipHref);
  assert.match(overview.flagshipHref, /^\/cases\//);
});

test("overview selects an artifact-bearing case run instead of a model-execution row", async () => {
  const fixture = await writeV4EvaluationFixture("v4-ui-mixed-trials");
  const summaryPath = resolve(fixture.evaluationRoot, "summary.json");
  const summary = JSON.parse(await readFile(summaryPath, "utf8")) as {
    rows: Array<Record<string, unknown>>;
  };
  const successfulAdvanced = summary.rows.find((row) => row.arm === "advanced");
  assert.ok(successfulAdvanced);
  summary.rows.unshift({
    ...successfulAdvanced,
    runId: "v4-ui-mixed-trials-advanced-trial-0-model-error",
    failureClass: "MODEL_EXECUTION",
    operationalDecisionIntegrity: false,
    runPath: "runs/v4-ui-mixed-trials/trial-0/advanced",
  });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const overview = await loadOverviewModel(fixture.evaluationRoot);
  assert.equal(
    overview.cases[0]?.detailRunPath,
    "runs/v4-ui-mixed-trials/trial-1/advanced",
  );
});

test("case detail exposes evidence, decision, verification, and download data", async () => {
  const detail = await loadCaseModel(flagshipRun);
  assert.equal(detail.caseId, "v4-ui-case");
  assert.equal(detail.modeLabel, "Recorded evidence");
  assert.equal(detail.actionBadge.label, "No action");
  assert.equal(detail.actionBadge.tone, "noop");
  assert.equal(detail.decision.schemaVersion, 3);
  assert.equal(detail.decision.action, "NO_ACTION");
  assert.equal(detail.evidence.length, 5);
  assert.deepEqual(
    detail.checks.map((check) => check.id),
    [
      "action-correct",
      "artifact-correct",
      "no-forbidden-mutation",
      "required-commands-passed",
      "source-coverage",
      "contradiction-free",
      "annotation-aligned",
    ],
  );
  assert.deepEqual(detail.changedFiles, []);
  assert.deepEqual(detail.decision.unresolvedUncertainty, []);
  assert.equal(detail.approval.decision, "APPROVED");
  assert.equal(detail.reportPath, "/reports/v4-ui-case.html");
  assert.ok(detail.artifactHashes.length >= 10);
  assert.equal("proposal" in detail, false);
  assert.equal("challenger" in detail, false);
});

test("missing run artifacts fail with a contextual error", async () => {
  const empty = await mkdtemp(resolve(tmpdir(), "evidence-maintainer-ui-"));
  await assert.rejects(
    loadCaseModel(empty),
    /Missing required artifact/,
  );
});
