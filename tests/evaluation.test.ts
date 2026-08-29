import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ModelExecutionError } from "../src/agents/runner.ts";
import { aggregateRows, median, wilsonInterval } from "../src/evaluation/aggregate.ts";
import { combineEvaluationSources, reconstructUsage } from "../src/evaluation/combine-evaluations.ts";
import { estimateUsageCost } from "../src/evaluation/cost.ts";
import { buildTokenUsageAccounting } from "../src/evaluation/token-usage-accounting.ts";
import { resolveCaseSelection, runEvaluation } from "../src/evaluation/run-evaluation.ts";
import { scoreRun } from "../src/evaluation/score-run.ts";
import { parseEvaluateArgs } from "../scripts/evaluate.ts";
import {
  mean,
  quantileType7,
  sampleStandardDeviation,
  sampleVariance,
  stratifiedNestedBootstrap,
} from "../src/evaluation/statistics.ts";

const checkIds = [
  "schema-complete",
  "action-correct",
  "challenger-compatible",
  "allowed-write-surface",
  "required-artifact",
  "expected-data-state",
  "required-commands",
  "regression-preserved",
  "evidence-source-coverage",
  "evidence-adjudication-alignment",
  "no-live-write",
];

async function makeRun(input: {
  arm: "baseline" | "advanced";
  action: string;
  failures?: string[];
  changedFiles?: string[];
  durationMs?: number;
  tokenUsage?: { input: number; cachedInput: number; output: number } | null;
  approvalEligible?: boolean;
  expectedAction?: string;
}) {
  const root = await mkdtemp(join(tmpdir(), "evidence-score-run-"));
  await mkdir(root, { recursive: true });
  const trajectoryPaths = input.tokenUsage
    ? input.arm === "baseline"
      ? ["trajectories/baseline.jsonl"]
      : ["trajectories/maintainer.jsonl", "trajectories/challenger.jsonl"]
    : ["trajectories/one.jsonl"];
  const usageAccounting = input.tokenUsage
    ? buildTokenUsageAccounting(input.arm === "baseline"
      ? [{
          role: "baseline",
          usage: input.tokenUsage,
          source: "TRAJECTORY_TURN_COMPLETED",
          trajectoryPath: trajectoryPaths[0],
          trajectoryAggregateCaptured: true,
          proxyRequestCoverage: { requestCount: 1, accountedRequestCount: 0, complete: false },
        }]
      : [
          {
            role: "maintainer",
            usage: input.tokenUsage,
            source: "TRAJECTORY_TURN_COMPLETED",
            trajectoryPath: trajectoryPaths[0],
            trajectoryAggregateCaptured: true,
            proxyRequestCoverage: { requestCount: 1, accountedRequestCount: 0, complete: false },
          },
          {
            role: "challenger",
            usage: { input: 0, cachedInput: 0, output: 0 },
            source: "TRAJECTORY_TURN_COMPLETED",
            trajectoryPath: trajectoryPaths[1],
            trajectoryAggregateCaptured: true,
            proxyRequestCoverage: { requestCount: 1, accountedRequestCount: 0, complete: false },
          },
        ])
    : null;
  const manifest = {
    schemaVersion: 2,
    projectId: "evidence-maintainer",
    runId: `${input.arm}-run`,
    caseId: "case-1",
    arm: input.arm,
    mode: "recorded",
    model: "fixture",
    startedAt: "2026-08-28T20:00:00.000Z",
    finishedAt: "2026-08-28T20:00:01.000Z",
    durationMs: input.durationMs ?? 1000,
    timeoutMs: 10000,
    promptSha256: "a".repeat(64),
    outputSchemaSha256: "b".repeat(64),
    caseSetSha256: "c".repeat(64),
    trajectoryPaths,
    proxyLedgerPaths: [],
    artifactSha256: {},
    tokenUsage: usageAccounting?.tokenUsage ?? null,
    tokenUsageAccounting: usageAccounting?.tokenUsageAccounting ?? null,
    runtimeImages: null,
    outcome: (input.failures?.length ?? 0) === 0 ? "PASS" : "FAIL",
  };
  const gate = {
    status: manifest.outcome,
    checks: checkIds.map((id) => ({ id, passed: !input.failures?.includes(id), summary: id, details: [] })),
    changedFiles: input.changedFiles ?? [],
    diff: { added: [], removed: [], modified: input.changedFiles ?? [] },
  };
  const result = { action: input.action };
  await writeFile(join(root, "manifest.json"), JSON.stringify(manifest), "utf8");
  await writeFile(join(root, "gate.json"), JSON.stringify(gate), "utf8");
  await writeFile(join(root, "approval.json"), JSON.stringify({
    schemaVersion: 1,
    caseId: "case-1",
    requested: true,
    eligible: input.approvalEligible ?? manifest.outcome === "PASS",
    decision: (input.approvalEligible ?? manifest.outcome === "PASS") ? "APPROVED" : "REJECTED",
    reason: "fixture",
    recordedAt: manifest.finishedAt,
  }), "utf8");
  await writeFile(
    join(root, input.arm === "baseline" ? "baseline-result.json" : "maintainer-proposal.json"),
    JSON.stringify(result),
    "utf8",
  );
  return { root, expectedAction: input.expectedAction ?? input.action };
}

test("operational decision integrity is independent of exact evidence annotation alignment", async () => {
  const allPassRun = await makeRun({ arm: "advanced", action: "NO_ACTION" });
  const allPass = await scoreRun(allPassRun.root, { expectedAction: allPassRun.expectedAction });
  assert.equal(allPass.operationalDecisionIntegrity, true);
  assert.equal(allPass.safeDecision, true);
  assert.equal(allPass.correctAbstention, true);
  assert.equal(allPass.unsafeMutation, false);

  for (const failure of [
    "action-correct",
    "required-artifact",
    "expected-data-state",
    "allowed-write-surface",
    "regression-preserved",
    "evidence-source-coverage",
  ]) {
    const fixture = await makeRun({ arm: "advanced", action: "UPDATE_DATA", failures: [failure] });
    const row = await scoreRun(fixture.root, { expectedAction: fixture.expectedAction });
    assert.equal(row.operationalDecisionIntegrity, failure === "evidence-source-coverage", `${failure} ODI classification`);
    assert.equal(row.safeDecision, false, `${failure} must make strict safeDecision false`);
  }

  const alignmentOnly = await makeRun({
    arm: "advanced",
    action: "NO_ACTION",
    failures: ["evidence-adjudication-alignment"],
    approvalEligible: true,
  });
  const alignmentRow = await scoreRun(alignmentOnly.root, { expectedAction: alignmentOnly.expectedAction });
  assert.equal(alignmentRow.operationalDecisionIntegrity, true);
  assert.equal(alignmentRow.evidenceSourceCoverage, true);
  assert.equal(alignmentRow.evidenceAdjudicationAligned, false);
  assert.equal(alignmentRow.safeDecision, false);
  assert.equal(alignmentRow.reviewReady, true);
});

test("a forbidden changed file is counted as an unsafe mutation", async () => {
  const fixture = await makeRun({
    arm: "baseline",
    action: "UPDATE_DATA",
    failures: ["allowed-write-surface"],
    changedFiles: ["unapproved.txt"],
  });
  const row = await scoreRun(fixture.root, { expectedAction: fixture.expectedAction });
  assert.equal(row.unsafeMutation, true);
  assert.equal(row.safeDecision, false);
});

test("aggregate metrics handle zero denominators, medians, tokens, and Wilson intervals", async () => {
  assert.equal(median([]), 0);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 3]), 2);
  assert.deepEqual(wilsonInterval(0, 0), { low: 0, high: 0 });
  const interval = wilsonInterval(1, 1);
  assert.ok(interval.low > 0 && interval.low < 1);
  assert.equal(interval.high, 1);

  const baselineFixture = await makeRun({ arm: "baseline", action: "UPDATE_DATA", failures: ["action-correct"], durationMs: 3000 });
  const advancedFixture = await makeRun({ arm: "advanced", action: "NO_ACTION", durationMs: 1000, tokenUsage: { input: 10, cachedInput: 2, output: 4 } });
  const baseline = await scoreRun(baselineFixture.root, { expectedAction: baselineFixture.expectedAction });
  const advanced = await scoreRun(advancedFixture.root, { expectedAction: advancedFixture.expectedAction });
  const summary = aggregateRows([baseline, advanced]);
  assert.equal(summary.arms.baseline.odi, 0);
  assert.equal(summary.arms.advanced.odi, 1);
  assert.equal(summary.absoluteOdiChange, 1);
  assert.equal(summary.arms.baseline.sdr, 0);
  assert.equal(summary.arms.advanced.sdr, 1);
  assert.equal(summary.absoluteSdrChange, 1);
  assert.equal(summary.arms.advanced.totalTokens, 14);
  assert.equal(advanced.inputTokens, 10);
  assert.equal(advanced.cachedInputTokens, 2);
  assert.equal(advanced.outputTokens, 4);
  assert.equal(summary.arms.advanced.uniqueCaseCount, 1);
  assert.equal(summary.arms.advanced.workflowRunCount, 1);
  assert.equal(summary.arms.advanced.medianDurationMs, 1000);
});

test("evaluation rows expose review-ready and human-intervention proxies", async () => {
  const falseEscalationFixture = await makeRun({
    arm: "advanced",
    action: "HUMAN_REVIEW",
    expectedAction: "UPDATE_DATA",
    failures: ["action-correct"],
    approvalEligible: false,
  });
  const falseEscalation = await scoreRun(falseEscalationFixture.root, {
    expectedAction: falseEscalationFixture.expectedAction,
  });
  assert.equal(falseEscalation.reviewReady, false);
  assert.equal(falseEscalation.unnecessaryEscalation, true);
  assert.equal(falseEscalation.missedRequiredEscalation, false);
  assert.equal(falseEscalation.avoidableHumanIntervention, true);
  assert.equal(falseEscalation.estimatedHumanTouch, true);

  const requiredReviewFixture = await makeRun({
    arm: "baseline",
    action: "HUMAN_REVIEW",
    expectedAction: "HUMAN_REVIEW",
  });
  const requiredReview = await scoreRun(requiredReviewFixture.root, {
    expectedAction: requiredReviewFixture.expectedAction,
  });
  assert.equal(requiredReview.unnecessaryEscalation, false);
  assert.equal(requiredReview.estimatedHumanTouch, true);
});

test("descriptive statistics and nested bootstrap are deterministic", () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
  assert.equal(sampleVariance([1, 2, 3, 4]), 5 / 3);
  assert.equal(sampleStandardDeviation([1, 2, 3, 4]), Math.sqrt(5 / 3));
  assert.equal(quantileType7([1, 2, 3, 4], 0.95), 3.8499999999999996);

  const actions = ["UPDATE_DATA", "REPAIR_ADAPTER", "RETRY_LATER", "NO_ACTION", "HUMAN_REVIEW"];
  const rows = actions.flatMap((expectedAction, caseIndex) => [1, 2, 3].flatMap((trial) => [
    {
      caseId: `case-${caseIndex}`,
      arm: "baseline" as const,
      expectedAction,
      safeDecision: trial === 1,
    },
    {
      caseId: `case-${caseIndex}`,
      arm: "advanced" as const,
      expectedAction,
      safeDecision: true,
    },
  ]));
  const first = stratifiedNestedBootstrap(rows, (row) => row.safeDecision ? 1 : 0, {
    iterations: 200,
    seed: 20260829,
  });
  const second = stratifiedNestedBootstrap(rows, (row) => row.safeDecision ? 1 : 0, {
    iterations: 200,
    seed: 20260829,
  });
  assert.deepEqual(first, second);
  assert.ok(first.difference.low > 0);
});

test("cost estimates separate cached input from uncached input", () => {
  const estimate = estimateUsageCost(
    { input: 10, cachedInput: 2, output: 4 },
    { inputPerMillionUsd: 2, cachedInputPerMillionUsd: 0.2, outputPerMillionUsd: 12 },
  );
  assert.deepEqual(estimate.tokenUsage, {
    input: 10,
    cachedInput: 2,
    uncachedInput: 8,
    output: 4,
    total: 14,
  });
  assert.ok(Math.abs(estimate.estimatedCostUsd - 0.0000644) < 1e-15);
});

test("combined usage is unknown when any model trajectory lacks a usage receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-partial-usage-"));
  await mkdir(join(root, "trajectories"));
  await writeFile(
    join(root, "trajectories", "maintainer.jsonl"),
    `${JSON.stringify({ usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 } })}\n`,
    "utf8",
  );
  await writeFile(
    join(root, "trajectories", "challenger.jsonl"),
    `${JSON.stringify({ type: "run.failed", message: "invalid output" })}\n`,
    "utf8",
  );

  const usage = await reconstructUsage(root, [
    "trajectories/maintainer.jsonl",
    "trajectories/challenger.jsonl",
  ]);
  assert.equal(usage, null);
});

test("recorded evaluation preserves one run directory per arm, case, and trial", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-evaluation-run-"));
  const summary = await runEvaluation({
    caseIds: ["noop-duplicate-news", "update-official-commitment"],
    trials: 1,
    mode: "recorded",
    model: "recorded-fixture",
    timeoutMs: 30_000,
    outDir: root,
  });
  assert.equal(summary.rows.length, 4);
  assert.equal(summary.arms.baseline.caseCount, 2);
  assert.equal(summary.arms.advanced.caseCount, 2);
  for (const row of summary.rows) {
    assert.match(row.runPath, /runs/);
  }
});

test("case-set identity is independent of execution order", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "evidence-case-order-one-"));
  const secondRoot = await mkdtemp(join(tmpdir(), "evidence-case-order-two-"));
  const first = await runEvaluation({
    caseIds: ["noop-duplicate-news", "update-official-commitment"],
    trials: 1,
    mode: "recorded",
    model: "recorded-fixture",
    timeoutMs: 30_000,
    outDir: firstRoot,
  });
  const second = await runEvaluation({
    caseIds: ["update-official-commitment", "noop-duplicate-news"],
    trials: 1,
    mode: "recorded",
    model: "recorded-fixture",
    timeoutMs: 30_000,
    outDir: secondRoot,
  });
  assert.equal(first.caseSetHash, second.caseSetHash);
});

test("evaluation sources combine into collision-free canonical trial paths", async () => {
  const sourceOne = await mkdtemp(join(tmpdir(), "evidence-combine-source-one-"));
  const sourceTwo = await mkdtemp(join(tmpdir(), "evidence-combine-source-two-"));
  const output = await mkdtemp(join(tmpdir(), "evidence-combine-output-"));
  for (const [outDir, trials] of [[sourceOne, 1], [sourceTwo, 2]] as const) {
    await runEvaluation({
      caseIds: ["noop-duplicate-news"],
      trials,
      mode: "recorded",
      model: "recorded-fixture",
      timeoutMs: 30_000,
      outDir,
    });
  }
  const summary = await combineEvaluationSources({
    sources: [
      { label: "initial", root: sourceOne, trialOffset: 0 },
      { label: "repeat", root: sourceTwo, trialOffset: 1 },
    ],
    outDir: output,
    caseRoot: "cases",
    expectedTrialsPerCase: 3,
  });
  assert.equal(summary.rows.length, 6);
  assert.equal(summary.arms.baseline.uniqueCaseCount, 1);
  assert.equal(summary.arms.baseline.workflowRunCount, 3);
  assert.deepEqual(
    [...new Set(summary.rows.map((row) => row.trial))].sort(),
    [1, 2, 3],
  );
  assert.equal(new Set(summary.rows.map((row) => row.runPath)).size, 6);
});

test("a claimed input commit requires resolved Git provenance", async () => {
  const source = await mkdtemp(join(tmpdir(), "evidence-combine-unverified-source-"));
  const output = await mkdtemp(join(tmpdir(), "evidence-combine-unverified-output-"));
  await runEvaluation({
    caseIds: ["noop-duplicate-news"],
    trials: 1,
    mode: "recorded",
    model: "recorded-fixture",
    timeoutMs: 30_000,
    outDir: source,
  });
  await assert.rejects(
    combineEvaluationSources({
      sources: [{ label: "source", root: source, trialOffset: 0 }],
      outDir: output,
      caseRoot: "cases",
      expectedTrialsPerCase: 1,
      inputCommit: "a".repeat(40),
    }),
    /requires verified Git provenance/,
  );
});

test("evaluation CLI and case selection support an isolated holdout root", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-holdout-root-"));
  await mkdir(join(root, "zeta"));
  await mkdir(join(root, "alpha"));
  assert.deepEqual(await resolveCaseSelection("all", root), ["alpha", "zeta"]);
  const parsed = parseEvaluateArgs([
    "--case-root", root,
    "--cases", "all",
    "--mode", "recorded",
    "--out", join(root, "out"),
    "--lock", join(root, "FREEZE.json"),
  ]);
  assert.equal(parsed.caseRoot, root);
  assert.equal(parsed.lock, join(root, "FREEZE.json"));
});

test("model execution errors retain trajectory usage instead of becoming zero-cost runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-evaluation-error-"));
  const runner = {
    async run(request: { trajectoryPath: string }): Promise<never> {
      await writeFile(
        request.trajectoryPath,
        `${JSON.stringify({ usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 } })}\n`,
        "utf8",
      );
      throw new ModelExecutionError("INVALID_OUTPUT", "model produced an invalid mutation");
    },
  };
  const summary = await runEvaluation({
    caseIds: ["repair-selector-drift"],
    trials: 1,
    mode: "live",
    model: "fixture-model",
    timeoutMs: 30_000,
    outDir: root,
    runner,
  });
  assert.equal(summary.rows.length, 2);
  assert.ok(summary.rows.every((row) => row.safeDecision === false));
  assert.ok(summary.rows.every((row) => row.durationMs === null));
  assert.ok(summary.rows.every((row) => row.totalTokens === 110));
  assert.ok(summary.rows.every((row) => row.cachedInputTokens === 40));
  assert.ok(summary.rows.every((row) => row.expectedAction === "REPAIR_ADAPTER"));
  assert.ok(summary.rows.every((row) => row.reviewReady === false));
});

test("infrastructure or evaluator errors abort instead of becoming model failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-evaluation-infra-error-"));
  const runner = {
    async run(): Promise<never> {
      throw new Error("filesystem unavailable");
    },
  };
  await assert.rejects(
    runEvaluation({
      caseIds: ["repair-selector-drift"],
      trials: 1,
      mode: "live",
      model: "fixture-model",
      timeoutMs: 30_000,
      outDir: root,
      runner,
    }),
    /filesystem unavailable/,
  );
});

test("a missing artifact after a manifest exists is bundle corruption, not an allowlisted model error", async () => {
  const source = await mkdtemp(join(tmpdir(), "evidence-combine-corrupt-source-"));
  const output = await mkdtemp(join(tmpdir(), "evidence-combine-corrupt-output-"));
  await runEvaluation({
    caseIds: ["noop-duplicate-news"],
    trials: 1,
    mode: "recorded",
    model: "recorded-fixture",
    timeoutMs: 30_000,
    outDir: source,
  });
  await rm(join(source, "runs", "noop-duplicate-news", "trial-1", "baseline", "gate.json"));
  await assert.rejects(
    combineEvaluationSources({
      sources: [{ label: "source", root: source, trialOffset: 0 }],
      outDir: output,
      caseRoot: "cases",
      expectedTrialsPerCase: 1,
      modelErrorKeys: ["source:1:noop-duplicate-news:baseline"],
    }),
    /ENOENT/,
  );
});
