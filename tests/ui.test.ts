import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { loadCaseModel } from "../src/ui/case-model.ts";
import { loadOverviewModel } from "../src/ui/overview-model.ts";

const evaluationRoot = resolve("artifacts/evaluation/recorded-all");
const flagshipRun = resolve(
  evaluationRoot,
  "runs/update-official-commitment/trial-1/advanced",
);

test("overview exposes a sorted, truth-labeled baseline comparison", async () => {
  const overview = await loadOverviewModel(evaluationRoot);
  assert.equal(overview.modeLabel, "Recorded evidence");
  assert.equal(overview.baseline.sdr, 2 / 15);
  assert.equal(overview.advanced.sdr, 1);
  assert.equal(overview.baseline.unsafeMutations, 5);
  assert.equal(overview.advanced.unsafeMutations, 0);
  assert.equal(overview.baseline.correctAbstentions, 1);
  assert.equal(overview.advanced.correctAbstentions, 9);
  assert.equal(overview.cases.length, 15);
  assert.deepEqual(
    overview.cases.map((item) => item.caseId),
    [...overview.cases.map((item) => item.caseId)].sort(),
  );

  const harmful = overview.cases.find(
    (item) => item.caseId === "noop-newer-publication-stale-effective",
  );
  assert.equal(harmful?.harmfulChange, true);
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
  assert.equal(detail.checks.length, 10);
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
