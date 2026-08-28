import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { copyCaseWorkspace, loadOracle, loadPublicCase } from "../src/core/case-loader.ts";

export const CORE_CASE_IDS = [
  "update-official-commitment",
  "update-transfer-destination",
  "update-authoritative-rating",
  "repair-selector-drift",
  "repair-json-nesting",
  "repair-pagination",
  "retry-deferred-406",
  "retry-timeout-cache",
  "retry-partial-document",
  "noop-duplicate-news",
  "noop-newer-publication-stale-effective",
  "noop-filtered-removal",
] as const;

async function run(command: string, cwd: string): Promise<{ code: number; output: string }> {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(command, { cwd, env, shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const chunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
  const [code] = await once(child, "close") as [number | null, NodeJS.Signals | null];
  return { code: code ?? 1, output: Buffer.concat(chunks).toString("utf8") };
}

test("the core suite contains twelve hash-verified cases with a balanced action distribution", async () => {
  const actual = (await readdir(resolve("cases"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && CORE_CASE_IDS.includes(entry.name as typeof CORE_CASE_IDS[number]))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(actual, [...CORE_CASE_IDS].sort());

  const distribution = new Map<string, number>();
  for (const caseId of CORE_CASE_IDS) {
    const caseDir = resolve("cases", caseId);
    const loaded = await loadPublicCase(caseDir);
    const oracle = await loadOracle(caseDir);
    const copyRoot = await mkdtemp(join(tmpdir(), `evidence-suite-${caseId}-`));
    await copyCaseWorkspace(caseDir, join(copyRoot, "workspace"));
    assert.equal(loaded.manifest.id, caseId);
    assert.match(loaded.workspaceHash, /^[a-f0-9]{64}$/);
    assert.equal(oracle.caseId, caseId);
    distribution.set(oracle.expectedAction, (distribution.get(oracle.expectedAction) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries([...distribution].sort()), {
    NO_ACTION: 3,
    REPAIR_ADAPTER: 3,
    RETRY_LATER: 3,
    UPDATE_DATA: 3,
  });
});

test("each untouched adapter case passes its old fixture and fails exactly its new fixture", async () => {
  for (const caseId of ["repair-selector-drift", "repair-json-nesting", "repair-pagination"] as const) {
    const caseDir = resolve("cases", caseId);
    const loaded = await loadPublicCase(caseDir);
    assert.equal(loaded.manifest.requiredCommands.length, 1);
    const result = await run(loaded.manifest.requiredCommands[0], join(caseDir, "workspace"));
    assert.notEqual(result.code, 0, `${caseId} must begin broken on its new fixture`);
    assert.match(result.output, /pass 1/i);
    assert.match(result.output, /fail 1/i);
  }
});
