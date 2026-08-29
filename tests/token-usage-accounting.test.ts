import assert from "node:assert/strict";
import test from "node:test";
import { RunManifestSchema } from "../src/core/schemas.ts";
import { buildTokenUsageAccounting } from "../src/evaluation/token-usage-accounting.ts";

const incompleteProxy = { requestCount: 1, accountedRequestCount: 0, complete: false };
const completeProxy = { requestCount: 1, accountedRequestCount: 1, complete: true };

test("trajectory totals account for a session without rewriting proxy request coverage", () => {
  const result = buildTokenUsageAccounting([{
    role: "baseline",
    usage: { input: 100, cachedInput: 20, output: 30 },
    source: "TRAJECTORY_TURN_COMPLETED",
    trajectoryPath: "trajectories/baseline.jsonl",
    proxyLedgerPath: "trajectories/baseline.proxy.jsonl",
    trajectoryAggregateCaptured: true,
    proxyRequestCoverage: incompleteProxy,
  }]);

  assert.deepEqual(result.tokenUsage, { input: 100, cachedInput: 20, output: 30 });
  assert.deepEqual(result.tokenUsageAccounting.sessionCoverage, {
    sessionCount: 1,
    accountedSessionCount: 1,
    complete: true,
  });
  assert.deepEqual(result.tokenUsageAccounting.proxyRequestCoverage, incompleteProxy);
  assert.equal(result.tokenUsageAccounting.aggregateSource, "TRAJECTORY");
});

test("mixed advanced accounting sums sessions while retaining incomplete request receipts", () => {
  const result = buildTokenUsageAccounting([
    {
      role: "maintainer",
      usage: { input: 100, cachedInput: 20, output: 30 },
      source: "PROXY_REQUEST_SUM",
      trajectoryPath: "trajectories/maintainer.jsonl",
      proxyLedgerPath: "trajectories/maintainer.proxy.jsonl",
      trajectoryAggregateCaptured: true,
      proxyRequestCoverage: completeProxy,
    },
    {
      role: "challenger",
      usage: { input: 80, cachedInput: 10, output: 20 },
      source: "TRAJECTORY_TURN_COMPLETED",
      trajectoryPath: "trajectories/challenger.jsonl",
      proxyLedgerPath: "trajectories/challenger.proxy.jsonl",
      trajectoryAggregateCaptured: true,
      proxyRequestCoverage: incompleteProxy,
    },
    {
      role: "reviser",
      usage: { input: 70, cachedInput: 5, output: 15 },
      source: "TRAJECTORY_TURN_COMPLETED",
      trajectoryPath: "trajectories/reviser.jsonl",
      proxyLedgerPath: "trajectories/reviser.proxy.jsonl",
      trajectoryAggregateCaptured: true,
      proxyRequestCoverage: incompleteProxy,
    },
  ]);

  assert.deepEqual(result.tokenUsage, { input: 250, cachedInput: 35, output: 65 });
  assert.equal(result.tokenUsageAccounting.aggregateSource, "MIXED");
  assert.deepEqual(result.tokenUsageAccounting.proxyRequestCoverage, {
    requestCount: 3,
    accountedRequestCount: 1,
    complete: false,
  });
});

test("one unavailable session makes the run aggregate unavailable", () => {
  const result = buildTokenUsageAccounting([
    {
      role: "maintainer",
      usage: { input: 100, cachedInput: 20, output: 30 },
      source: "TRAJECTORY_TURN_COMPLETED",
      trajectoryPath: "trajectories/maintainer.jsonl",
      proxyLedgerPath: "trajectories/maintainer.proxy.jsonl",
      trajectoryAggregateCaptured: true,
      proxyRequestCoverage: incompleteProxy,
    },
    {
      role: "challenger",
      trajectoryPath: "trajectories/challenger.jsonl",
      proxyLedgerPath: "trajectories/challenger.proxy.jsonl",
      trajectoryAggregateCaptured: false,
      proxyRequestCoverage: incompleteProxy,
    },
    {
      role: "reviser",
      usage: { input: 60, cachedInput: 5, output: 10 },
      source: "TRAJECTORY_TURN_COMPLETED",
      trajectoryPath: "trajectories/reviser.jsonl",
      proxyLedgerPath: "trajectories/reviser.proxy.jsonl",
      trajectoryAggregateCaptured: true,
      proxyRequestCoverage: incompleteProxy,
    },
  ]);

  assert.equal(result.tokenUsage, null);
  assert.deepEqual(result.tokenUsageAccounting.sessionCoverage, {
    sessionCount: 3,
    accountedSessionCount: 2,
    complete: false,
  });
  assert.equal(result.tokenUsageAccounting.aggregateSource, "UNAVAILABLE");
});

test("manifest validation rejects a token aggregate that disagrees with its sessions", () => {
  const accounting = buildTokenUsageAccounting([{
    role: "baseline",
    usage: { input: 100, cachedInput: 20, output: 30 },
    source: "TRAJECTORY_TURN_COMPLETED",
    trajectoryPath: "trajectories/baseline.jsonl",
    proxyLedgerPath: "trajectories/baseline.proxy.jsonl",
    trajectoryAggregateCaptured: true,
    proxyRequestCoverage: incompleteProxy,
  }]);
  const manifest = {
    schemaVersion: 2,
    projectId: "evidence-maintainer",
    runId: "run-1",
    caseId: "case-1",
    arm: "baseline",
    mode: "live",
    model: "gpt-5.6-terra",
    startedAt: "2026-08-29T00:00:00.000Z",
    finishedAt: "2026-08-29T00:00:01.000Z",
    durationMs: 1000,
    timeoutMs: 10000,
    promptSha256: "a".repeat(64),
    outputSchemaSha256: "b".repeat(64),
    caseSetSha256: "c".repeat(64),
    trajectoryPaths: ["trajectories/baseline.jsonl"],
    proxyLedgerPaths: ["trajectories/baseline.proxy.jsonl"],
    artifactSha256: {},
    tokenUsage: { input: 101, cachedInput: 20, output: 30 },
    tokenUsageAccounting: accounting.tokenUsageAccounting,
    runtimeImages: [{ role: "baseline", imageId: "d".repeat(64) }],
    outcome: "PASS",
  };

  assert.throws(() => RunManifestSchema.parse(manifest), /aggregate token usage/i);
});
