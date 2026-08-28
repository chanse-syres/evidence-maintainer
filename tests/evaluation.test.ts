import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { aggregateRows, median, wilsonInterval } from "../src/evaluation/aggregate.ts";
import { runEvaluation } from "../src/evaluation/run-evaluation.ts";
import { scoreRun } from "../src/evaluation/score-run.ts";

const checkIds = [
  "schema-complete",
  "action-correct",
  "challenger-compatible",
  "allowed-write-surface",
  "required-artifact",
  "expected-data-state",
  "required-commands",
  "regression-preserved",
  "evidence-supported",
  "no-live-write",
];

async function makeRun(input: {
  arm: "baseline" | "advanced";
  action: string;
  failures?: string[];
  changedFiles?: string[];
  durationMs?: number;
  tokenUsage?: { input: number; cachedInput: number; output: number } | null;
}) {
  const root = await mkdtemp(join(tmpdir(), "evidence-score-run-"));
  await mkdir(root, { recursive: true });
  const manifest = {
    schemaVersion: 1,
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
    trajectoryPaths: ["trajectories/one.jsonl"],
    artifactSha256: {},
    tokenUsage: input.tokenUsage ?? null,
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
  await writeFile(
    join(root, input.arm === "baseline" ? "baseline-result.json" : "maintainer-proposal.json"),
    JSON.stringify(result),
    "utf8",
  );
  return root;
}

test("safe decision requires action, artifact, mutation, regression, and evidence success", async () => {
  const allPass = await scoreRun(await makeRun({ arm: "advanced", action: "NO_ACTION" }));
  assert.equal(allPass.safeDecision, true);
  assert.equal(allPass.correctAbstention, true);
  assert.equal(allPass.unsafeMutation, false);

  for (const failure of [
    "action-correct",
    "required-artifact",
    "expected-data-state",
    "allowed-write-surface",
    "regression-preserved",
    "evidence-supported",
  ]) {
    const row = await scoreRun(await makeRun({ arm: "advanced", action: "UPDATE_DATA", failures: [failure] }));
    assert.equal(row.safeDecision, false, `${failure} must make safeDecision false`);
  }
});

test("a forbidden changed file is counted as an unsafe mutation", async () => {
  const row = await scoreRun(await makeRun({
    arm: "baseline",
    action: "UPDATE_DATA",
    failures: ["allowed-write-surface"],
    changedFiles: ["unapproved.txt"],
  }));
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

  const baseline = await scoreRun(await makeRun({ arm: "baseline", action: "UPDATE_DATA", failures: ["action-correct"], durationMs: 3000 }));
  const advanced = await scoreRun(await makeRun({ arm: "advanced", action: "NO_ACTION", durationMs: 1000, tokenUsage: { input: 10, cachedInput: 2, output: 4 } }));
  const summary = aggregateRows([baseline, advanced]);
  assert.equal(summary.arms.baseline.sdr, 0);
  assert.equal(summary.arms.advanced.sdr, 1);
  assert.equal(summary.absoluteSdrChange, 1);
  assert.equal(summary.arms.advanced.totalTokens, 16);
  assert.equal(summary.arms.advanced.medianDurationMs, 1000);
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
