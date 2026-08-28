import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  copyCaseWorkspace,
  loadOracle,
  loadPublicCase,
} from "../src/core/case-loader.ts";

const casesRoot = resolve("cases");

test("public case loading verifies hashes without exposing the evaluator oracle", async () => {
  const caseDir = join(casesRoot, "noop-duplicate-news");
  const loaded = await loadPublicCase(caseDir);
  assert.equal(loaded.manifest.id, "noop-duplicate-news");
  assert.equal("oracle" in loaded, false);
  assert.match(loaded.workspaceHash, /^[a-f0-9]{64}$/);
  assert.equal(loaded.observations.length, 2);
});

test("oracle loading is an explicit evaluator-only operation", async () => {
  const oracle = await loadOracle(join(casesRoot, "update-official-commitment"));
  assert.equal(oracle.expectedAction, "UPDATE_DATA");
  assert.deepEqual(oracle.allowedChangedFiles, ["input/canonical.json"]);
});

test("case copying excludes oracle bytes from the agent workspace", async () => {
  const runRoot = await mkdtemp(join(tmpdir(), "evidence-maintainer-copy-"));
  const copied = await copyCaseWorkspace(
    join(casesRoot, "noop-duplicate-news"),
    join(runRoot, "agent"),
  );
  const canonical = JSON.parse(await readFile(join(copied, "input", "canonical.json"), "utf8"));
  assert.equal(canonical[0].id, "athlete-7");
  await assert.rejects(() => readFile(join(runRoot, "agent", "oracle.json"), "utf8"));
});

test("a changed agent-visible fixture is rejected by its provenance hash", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-maintainer-tamper-"));
  const source = join(casesRoot, "noop-duplicate-news");
  const clone = join(root, "case");
  await cp(source, clone, { recursive: true });
  const canonicalPath = join(clone, "workspace", "input", "canonical.json");
  await writeFile(canonicalPath, "[]\n", "utf8");
  await assert.rejects(() => loadPublicCase(clone), /hash mismatch/i);
});
