import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { sha256Json } from "../src/core/canonical-json.ts";
import { assertSafeAdjudicationPaths } from "../scripts/adjudicate-evaluation.ts";
import { adjudicateEvaluationSummary } from "../src/evaluation/adjudicate.ts";
import type { EvaluationSummary } from "../src/evaluation/run-evaluation.ts";

test("post-run evaluator invalidation excludes one case symmetrically", async () => {
  const raw = JSON.parse(await readFile(
    resolve("artifacts", "evaluation", "holdout-v4-attempt-2", "raw", "summary.json"),
    "utf8",
  )) as EvaluationSummary;
  const lock = JSON.parse(await readFile(
    resolve("holdout", "v4", "FREEZE-ATTEMPT-2.json"),
    "utf8",
  ));
  const receipt = JSON.parse(await readFile(
    resolve("holdout", "v4", "EVALUATOR-INVALIDATION-retry-signed-release-quorum.json"),
    "utf8",
  ));
  const original = structuredClone(raw);

  const result = adjudicateEvaluationSummary({
    rawSummary: raw,
    lock,
    invalidations: [receipt],
  });

  assert.deepEqual(raw, original);
  assert.equal(result.rows.length, 24);
  assert.equal(result.selection.selectedCaseCount, 5);
  assert.equal(result.selection.includedCaseCount, 4);
  assert.equal(result.selection.excludedCaseCount, 1);
  assert.deepEqual(result.selection.excludedCaseIds, ["retry-signed-release-quorum"]);
  assert.equal(result.failureTaxonomy.NONE, 24);
  assert.equal(result.failureTaxonomy.EVALUATOR_INVALID, 6);
  assert.equal(result.arms.baseline.workflowRunCount, 12);
  assert.equal(result.arms.baseline.operationalDecisions, 12);
  assert.equal(result.arms.baseline.odi, 1);
  assert.equal(result.arms.advanced.workflowRunCount, 12);
  assert.equal(result.arms.advanced.operationalDecisions, 12);
  assert.equal(result.arms.advanced.odi, 1);
  assert.equal(result.absoluteOdiChange, 0);
  assert.equal(result.resourceComparison.advancedMinusBaselineTotalDurationMs, 686_544);
  assert.equal(result.resourceComparison.advancedMinusBaselineTotalTokens, 349_026);
  assert.equal(result.selection.selectedCaseSetHash, lock.caseSetHash);
  assert.equal(result.selection.selectedCaseDefinitionSetHash, lock.caseDefinitionSetHash);
  assert.equal(
    result.caseSetHash,
    sha256Json(lock.cases.filter((entry: { caseId: string }) => (
      entry.caseId !== "retry-signed-release-quorum"
    ))),
  );
  assert.equal(
    result.caseDefinitionSetHash,
    sha256Json(lock.caseDefinitions.filter((entry: { caseId: string }) => (
      entry.caseId !== "retry-signed-release-quorum"
    ))),
  );
});

test("post-run adjudication rejects an invalidation not bound to the campaign", async () => {
  const raw = JSON.parse(await readFile(
    resolve("artifacts", "evaluation", "holdout-v4-attempt-2", "raw", "summary.json"),
    "utf8",
  )) as EvaluationSummary;
  const lock = JSON.parse(await readFile(
    resolve("holdout", "v4", "FREEZE-ATTEMPT-2.json"),
    "utf8",
  ));
  const receipt = JSON.parse(await readFile(
    resolve("holdout", "v4", "EVALUATOR-INVALIDATION-retry-signed-release-quorum.json"),
    "utf8",
  ));
  receipt.campaign = "some-other-campaign";

  assert.throws(
    () => adjudicateEvaluationSummary({
      rawSummary: raw,
      lock,
      invalidations: [receipt],
    }),
    /invalidation campaign does not match the frozen campaign/,
  );
});

test("adjudication paths stay inside the repository and never overlap raw evidence", () => {
  const repositoryRoot = resolve("C:/example/repository");
  const safe = {
    repositoryRoot,
    source: resolve(repositoryRoot, "artifacts/evaluation/raw-campaign"),
    out: resolve(repositoryRoot, "artifacts/evaluation/selected-campaign"),
    lockPath: resolve(repositoryRoot, "holdout/v4/FREEZE.json"),
    receiptPath: resolve(repositoryRoot, "holdout/v4/EVALUATOR-INVALIDATION-case.json"),
  };
  assert.doesNotThrow(() => assertSafeAdjudicationPaths(safe));
  assert.throws(
    () => assertSafeAdjudicationPaths({ ...safe, out: resolve(safe.source, "selected") }),
    /must not overlap/,
  );
  assert.throws(
    () => assertSafeAdjudicationPaths({ ...safe, out: resolve(repositoryRoot, "..", "outside") }),
    /must be contained within the repository/,
  );
});
