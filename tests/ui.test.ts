import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { before } from "node:test";
import { resolveCaseSelection, runEvaluation } from "../src/evaluation/run-evaluation.ts";
import { loadCaseModel } from "../src/ui/case-model.ts";
import { loadOverviewModel } from "../src/ui/overview-model.ts";

let evaluationRoot: string;
let flagshipRun: string;

before(async () => {
  evaluationRoot = await mkdtemp(join(tmpdir(), "evidence-ui-v2-"));
  await runEvaluation({
    caseIds: await resolveCaseSelection("all", "cases"),
    trials: 1,
    mode: "recorded",
    model: "recorded-fixture",
    timeoutMs: 30_000,
    outDir: evaluationRoot,
  });
  flagshipRun = join(
    evaluationRoot,
    "runs",
    "update-official-commitment",
    "trial-1",
    "advanced",
  );
});

test("overview exposes a sorted, truth-labeled baseline comparison", async () => {
  const overview = await loadOverviewModel(evaluationRoot);
  assert.equal(overview.modeLabel, "Recorded evidence");
  assert.equal(overview.cases.length, 15);
  assert.equal(overview.baseline.caseCount, 15);
  assert.equal(overview.advanced.caseCount, 15);
  assert.deepEqual(
    overview.cases.map((item) => item.caseId),
    [...overview.cases.map((item) => item.caseId)].sort(),
  );

  const harmful = overview.cases.find(
    (item) => item.caseId === "noop-newer-publication-stale-effective",
  );
  assert.equal(typeof harmful?.harmfulChange, "boolean");
  assert.equal(harmful?.actionBadge.label, "No action");
  assert.equal(harmful?.actionBadge.tone, "noop");
  assert.match(overview.flagshipHref, /^\/cases\//);
});

test("case detail exposes evidence, decision, verification, and download data", async () => {
  const detail = await loadCaseModel(flagshipRun);
  assert.equal(detail.caseId, "update-official-commitment");
  assert.equal(detail.modeLabel, "Recorded evidence");
  assert.equal(detail.actionBadge.label, "Update data");
  assert.equal(detail.actionBadge.tone, "update");
  assert.equal(detail.evidence.length, 6);
  assert.equal(detail.checks.length, 12);
  assert.deepEqual(detail.changedFiles, ["input/canonical.json"]);
  assert.equal(detail.approval.decision, "APPROVED");
  assert.equal(detail.reportPath, "/reports/update-official-commitment.html");
  assert.ok(detail.artifactHashes.length >= 10);
});

test("missing run artifacts fail with a contextual error", async () => {
  const empty = await mkdtemp(resolve(tmpdir(), "evidence-maintainer-ui-"));
  await assert.rejects(
    loadCaseModel(empty),
    /Missing required artifact .*manifest\.json/,
  );
});
