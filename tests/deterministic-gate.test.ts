import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { copyCaseWorkspace, loadOracle, loadPublicCase } from "../src/core/case-loader.ts";
import { applyOperations } from "../src/core/mutation-engine.ts";
import { runDeterministicGate } from "../src/core/deterministic-gate.ts";
import { buildEvidenceLedger } from "../src/core/evidence-ledger.ts";
import { diffTrees, snapshotTree } from "../src/core/tree-snapshot.ts";
import type { ChallengerVerdict, MaintainerProposal } from "../src/core/schemas.ts";

const noopProposal: MaintainerProposal = {
  schemaVersion: 1,
  caseId: "noop-duplicate-news",
  action: "NO_ACTION",
  firstMaterialDivergence: "obs-2 is publication duplication, not a new occurrence",
  failureOwner: "source-observation",
  evidenceUsed: ["obs-1", "obs-2"],
  evidenceRejected: [],
  affectedEntities: ["athlete-7"],
  affectedFiles: [],
  operations: [],
  preservedInvariants: ["Canonical event IDs remain unique"],
  unresolvedUncertainty: [],
  minimumInformationRequest: [],
  retryCondition: null,
  approvalLevel: "SIMULATED_HUMAN",
  summary: "No canonical change is justified.",
};

function confirming(caseId: string, evidenceIds: string[]): ChallengerVerdict {
  return {
    schemaVersion: 1,
    caseId,
    verdict: "CONFIRM",
    evidenceIds,
    violations: [],
    residualRisks: [],
    summary: "The proposed action matches the available evidence and preserves policy.",
  };
}

test("a correct no-action proposal passes all checks with no changed files", async () => {
  const caseDir = resolve("cases", "noop-duplicate-news");
  const loadedCase = await loadPublicCase(caseDir);
  const oracle = await loadOracle(caseDir);
  const root = await mkdtemp(join(tmpdir(), "evidence-gate-noop-"));
  const workspace = await copyCaseWorkspace(caseDir, join(root, "workspace"));
  const before = await snapshotTree(workspace);
  const after = await snapshotTree(workspace);
  const result = await runDeterministicGate({
    loadedCase,
    oracle,
    workspace,
    before,
    after,
    proposal: noopProposal,
    challenger: confirming(noopProposal.caseId, ["obs-1", "obs-2"]),
    commandResults: {},
    submissionMode: true,
    liveWriteAttempted: false,
  });
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.changedFiles, []);
  assert.equal(result.checks.length, 10);
  assert.ok(result.checks.every((check) => check.passed));
});

test("a correct data update can cite immutable ledger events and passes", async () => {
  const caseDir = resolve("cases", "update-official-commitment");
  const loadedCase = await loadPublicCase(caseDir);
  const oracle = await loadOracle(caseDir);
  const root = await mkdtemp(join(tmpdir(), "evidence-gate-update-"));
  const workspace = await copyCaseWorkspace(caseDir, join(root, "workspace"));
  const before = await snapshotTree(workspace);
  const officialEvent = buildEvidenceLedger(loadedCase).find(
    (event) => event.evidenceIds.includes("obs-official-commitment"),
  );
  assert.ok(officialEvent);
  const proposal: MaintainerProposal = {
    ...noopProposal,
    caseId: "update-official-commitment",
    action: "UPDATE_DATA",
    firstMaterialDivergence: "The official announcement supersedes discovery data.",
    evidenceUsed: [officialEvent.id],
    affectedEntities: ["athlete-11"],
    affectedFiles: ["input/canonical.json"],
    operations: [{
      kind: "SET_RECORD_FIELDS",
      file: "input/canonical.json",
      recordId: "athlete-11",
      assignments: [
        { field: "status", value: "committed" },
        { field: "team", value: "Coastal State" },
      ],
    }],
    preservedInvariants: ["Stable athlete identity is preserved"],
    summary: "Apply the official commitment state.",
  };
  await applyOperations(workspace, proposal.operations);
  const after = await snapshotTree(workspace);
  const result = await runDeterministicGate({
    loadedCase,
    oracle,
    workspace,
    before,
    after,
    proposal,
    challenger: confirming(proposal.caseId, proposal.evidenceUsed),
    commandResults: {},
    submissionMode: true,
    liveWriteAttempted: false,
  });
  const updated = JSON.parse(await readFile(join(workspace, "input", "canonical.json"), "utf8"));
  assert.equal(result.status, "PASS");
  assert.equal(updated[0].status, "committed");
  assert.equal(updated[0].team, "Coastal State");
});

test("a write outside the allowed surface fails even when the action is correct", async () => {
  const caseDir = resolve("cases", "noop-duplicate-news");
  const loadedCase = await loadPublicCase(caseDir);
  const oracle = await loadOracle(caseDir);
  const root = await mkdtemp(join(tmpdir(), "evidence-gate-forbidden-"));
  const workspace = await copyCaseWorkspace(caseDir, join(root, "workspace"));
  const before = await snapshotTree(workspace);
  await writeFile(join(workspace, "unapproved.txt"), "harmful\n", "utf8");
  const after = await snapshotTree(workspace);
  const result = await runDeterministicGate({
    loadedCase,
    oracle,
    workspace,
    before,
    after,
    proposal: noopProposal,
    challenger: confirming(noopProposal.caseId, noopProposal.evidenceUsed),
    commandResults: {},
    submissionMode: true,
    liveWriteAttempted: false,
  });
  assert.equal(result.status, "FAIL");
  assert.ok(result.checks.some((check) => check.id === "allowed-write-surface" && !check.passed));
});

test("tree diffs report sorted added, removed, and modified paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-tree-diff-"));
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "keep.txt"), "before", "utf8");
  await writeFile(join(root, "remove.txt"), "remove", "utf8");
  const before = await snapshotTree(root);
  await writeFile(join(root, "keep.txt"), "after", "utf8");
  await writeFile(join(root, "nested", "add.txt"), "add", "utf8");
  await (await import("node:fs/promises")).rm(join(root, "remove.txt"));
  const after = await snapshotTree(root);
  assert.deepEqual(diffTrees(before, after), {
    added: ["nested/add.txt"],
    removed: ["remove.txt"],
    modified: ["keep.txt"],
  });
});

test("bounded record updates reject ambiguous, absent, non-array, and traversal targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-mutation-errors-"));
  await writeFile(join(root, "duplicate.json"), '[{"id":"x"},{"id":"x"}]\n', "utf8");
  await writeFile(join(root, "object.json"), '{"id":"x"}\n', "utf8");
  await assert.rejects(() => applyOperations(root, [{
    kind: "SET_RECORD_FIELDS",
    file: "duplicate.json",
    recordId: "x",
    assignments: [{ field: "status", value: "new" }],
  }]), /duplicate/i);
  await assert.rejects(() => applyOperations(root, [{
    kind: "SET_RECORD_FIELDS",
    file: "duplicate.json",
    recordId: "missing",
    assignments: [{ field: "status", value: "new" }],
  }]), /record/i);
  await assert.rejects(() => applyOperations(root, [{
    kind: "SET_RECORD_FIELDS",
    file: "object.json",
    recordId: "x",
    assignments: [{ field: "status", value: "new" }],
  }]), /array/i);
  await assert.rejects(() => applyOperations(root, [{
    kind: "SET_RECORD_FIELDS",
    file: "../outside.json",
    recordId: "x",
    assignments: [{ field: "status", value: "new" }],
  }]), /path|normalized|relative/i);
});
