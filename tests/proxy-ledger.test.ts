import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readProxyLedger } from "../src/agents/proxy-ledger.ts";

test("proxy ledger sums every successful gateway request and reports coverage", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-proxy-ledger-"));
  const path = join(root, "proxy.jsonl");
  await writeFile(path, [
    { schemaVersion: 1, sequence: 1, type: "proxy_started" },
    { schemaVersion: 1, sequence: 2, type: "upstream_response", upstreamStatus: 200, usageCaptured: true, usage: { input: 10, cachedInput: 2, output: 3 } },
    { schemaVersion: 1, sequence: 3, type: "upstream_response", upstreamStatus: 200, usageCaptured: true, usage: { input: 20, cachedInput: 5, output: 7 } },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
  const summary = await readProxyLedger(path);
  assert.deepEqual(summary.usage, { input: 30, cachedInput: 7, output: 10 });
  assert.deepEqual(summary.accountedUsage, { input: 30, cachedInput: 7, output: 10 });
  assert.deepEqual(summary.coverage, { requestCount: 2, accountedRequestCount: 2, complete: true });
  assert.equal(summary.budgetExhausted, false);
  assert.equal(summary.proxyFailure, false);
});

test("missing usage stays incomplete and owned budget exhaustion remains distinct", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-proxy-ledger-incomplete-"));
  const path = join(root, "proxy.jsonl");
  await writeFile(path, [
    { schemaVersion: 1, sequence: 1, type: "upstream_response", upstreamStatus: 200, usageCaptured: false, usage: null },
    { schemaVersion: 1, sequence: 2, type: "request_rejected", reason: "budget_exhausted" },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
  const summary = await readProxyLedger(path);
  assert.equal(summary.usage, null);
  assert.equal(summary.accountedUsage, null);
  assert.deepEqual(summary.coverage, { requestCount: 1, accountedRequestCount: 0, complete: false });
  assert.equal(summary.budgetExhausted, true);
});

test("partial usage is retained for conflict checks without becoming the canonical sum", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-proxy-ledger-partial-"));
  const path = join(root, "proxy.jsonl");
  await writeFile(path, [
    { schemaVersion: 1, sequence: 1, type: "upstream_response", upstreamStatus: 200, usageCaptured: true, usage: { input: 10, cachedInput: 2, output: 3 } },
    { schemaVersion: 1, sequence: 2, type: "upstream_response", upstreamStatus: 200, usageCaptured: false, usage: null },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
  const summary = await readProxyLedger(path);
  assert.equal(summary.usage, null);
  assert.deepEqual(summary.accountedUsage, { input: 10, cachedInput: 2, output: 3 });
  assert.deepEqual(summary.coverage, { requestCount: 2, accountedRequestCount: 1, complete: false });
});
