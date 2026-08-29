import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { copyCaseWorkspace, loadOracle, loadPublicCase } from "../src/core/case-loader.ts";
import { runDeterministicGate } from "../src/core/deterministic-gate.ts";
import { applyOperations, MutationApplicationError } from "../src/core/mutation-engine.ts";
import {
  ChallengerVerdictSchema,
  CaseOracleSchema,
  MaintainerProposalSchema,
  type CaseOracle,
  type ChallengerVerdict,
  type MaintainerProposal,
} from "../src/core/schemas.ts";
import { diffTrees, snapshotTree } from "../src/core/tree-snapshot.ts";

const fixtures = JSON.parse(
  await readFile(resolve("artifacts", "recorded", "runner-fixtures.json"), "utf8"),
) as Record<string, unknown>;

function fixtureProposal(caseId: string): MaintainerProposal {
  return MaintainerProposalSchema.parse(fixtures[`${caseId}:maintainer`]);
}

function fixtureVerdict(caseId: string): ChallengerVerdict {
  return ChallengerVerdictSchema.parse(fixtures[`${caseId}:challenger`]);
}

async function gateFixture(input: {
  caseId: string;
  proposal?: MaintainerProposal;
  challenger?: ChallengerVerdict;
  applyProposal?: boolean;
  extraWrite?: { path: string; content: string };
  oracleTransform?: (oracle: CaseOracle) => CaseOracle;
}) {
  const caseDir = resolve("cases", input.caseId);
  const loadedCase = await loadPublicCase(caseDir);
  const loadedOracle = await loadOracle(caseDir);
  const oracle = input.oracleTransform ? input.oracleTransform(loadedOracle) : loadedOracle;
  const root = await mkdtemp(join(tmpdir(), `evidence-gate-${input.caseId}-`));
  const workspace = await copyCaseWorkspace(caseDir, join(root, "workspace"));
  const proposal = input.proposal ?? fixtureProposal(input.caseId);
  const challenger = input.challenger ?? fixtureVerdict(input.caseId);
  const before = await snapshotTree(workspace);
  if (input.applyProposal) await applyOperations(workspace, proposal.operations);
  if (input.extraWrite) {
    await writeFile(join(workspace, input.extraWrite.path), input.extraWrite.content, "utf8");
  }
  const after = await snapshotTree(workspace);
  const result = await runDeterministicGate({
    loadedCase,
    oracle,
    workspace,
    before,
    after,
    proposal,
    challenger,
    commandResults: {},
    submissionMode: true,
    liveWriteAttempted: false,
  });
  return { result, workspace };
}

test("a correct no-action proposal passes all checks with no changed files", async () => {
  const { result } = await gateFixture({ caseId: "noop-duplicate-news" });
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.changedFiles, []);
  assert.equal(result.checks.length, 11);
  assert.ok(result.checks.every((entry) => entry.passed));
});

test("field-level evidence assessments must cite an existing observation and fact", async () => {
  const valid = fixtureProposal("noop-duplicate-news");
  const proposal = MaintainerProposalSchema.parse({
    ...valid,
    evidenceAssessments: valid.evidenceAssessments.map((entry, index) => index === 0
      ? { ...entry, evidenceId: "invented-observation" }
      : { ...entry, factPath: "facts.notPresent" }),
  });
  const { result } = await gateFixture({ caseId: proposal.caseId, proposal });
  const evidence = result.checks.find((entry) => entry.id === "evidence-supported");
  assert.equal(result.status, "FAIL");
  assert.equal(evidence?.passed, false);
  assert.ok(evidence?.details.some((detail) => /Unknown observation/.test(detail)));
  assert.ok(evidence?.details.some((detail) => /Unknown fact path/.test(detail)));
});

test("conflicting dispositions for the same observation field are rejected", async () => {
  const valid = fixtureProposal("noop-duplicate-news");
  const first = valid.evidenceAssessments[0];
  const proposal = MaintainerProposalSchema.parse({
    ...valid,
    evidenceAssessments: [
      ...valid.evidenceAssessments,
      { ...first, disposition: "REJECT", reason: "Contradictory adjudication." },
    ],
  });
  const { result } = await gateFixture({ caseId: proposal.caseId, proposal });
  const evidence = result.checks.find((entry) => entry.id === "evidence-supported");
  assert.equal(result.status, "FAIL");
  assert.ok(evidence?.details.some((detail) => /Conflicting dispositions/.test(detail)));
});

test("unadjudicated extra evidence assessments are rejected", async () => {
  const valid = fixtureProposal("noop-duplicate-news");
  const proposal = MaintainerProposalSchema.parse({
    ...valid,
    evidenceAssessments: [
      ...valid.evidenceAssessments,
      {
        evidenceId: "obs-1",
        factPath: "observedAt",
        disposition: "CONTEXT",
        reason: "An additional claim that is not part of the adjudicated proof.",
      },
    ],
  });
  const { result } = await gateFixture({ caseId: proposal.caseId, proposal });
  const evidence = result.checks.find((entry) => entry.id === "evidence-supported");
  assert.equal(result.status, "FAIL");
  assert.equal(evidence?.passed, false);
  assert.ok(evidence?.details.some((detail) => /Unexpected assessment/.test(detail)));
});

test("one complete adjudicated evidence bundle passes when the oracle permits a fair variant", async () => {
  const valid = fixtureProposal("noop-duplicate-news");
  const alternate = {
    ...valid.evidenceAssessments[1],
    disposition: "REJECT" as const,
    reason: "The syndicated occurrence is unsafe as independent authority.",
  };
  const proposal = MaintainerProposalSchema.parse({
    ...valid,
    evidenceAssessments: [valid.evidenceAssessments[0], alternate],
  });
  const { result } = await gateFixture({
    caseId: proposal.caseId,
    proposal,
    oracleTransform: (oracle) => CaseOracleSchema.parse({
      ...oracle,
      evidenceAssessmentBundles: [
        oracle.evidenceAssessmentBundles[0],
        [oracle.evidenceAssessmentBundles[0][0], alternate],
      ],
      allowedEvidenceAssessments: [...oracle.allowedEvidenceAssessments, alternate],
    }),
  });
  assert.equal(result.status, "PASS");
});

test("duplicate coverage may reject a coverage-only status claim without invalidating a complete proof", async () => {
  const valid = fixtureProposal("noop-duplicate-news");
  const proposal = MaintainerProposalSchema.parse({
    ...valid,
    evidenceAssessments: [
      {
        evidenceId: "obs-1",
        factPath: "facts.eventId",
        disposition: "SUPPORT",
        reason: "The official observation establishes the canonical occurrence.",
      },
      {
        evidenceId: "obs-2",
        factPath: "facts.eventId",
        disposition: "SUPPORT",
        reason: "The coverage identifies the same occurrence.",
      },
      {
        evidenceId: "obs-2",
        factPath: "facts.status",
        disposition: "REJECT",
        reason: "Coverage-only authority cannot establish a canonical status change.",
      },
    ],
  });
  const { result } = await gateFixture({ caseId: proposal.caseId, proposal });
  assert.equal(result.status, "PASS");
});

test("challenger citation coverage is reported separately from proposal evidence", async () => {
  const proposal = fixtureProposal("noop-duplicate-news");
  const challenger = ChallengerVerdictSchema.parse({
    ...fixtureVerdict(proposal.caseId),
    evidenceIds: ["obs-1"],
  });
  const { result } = await gateFixture({ caseId: proposal.caseId, proposal, challenger });
  assert.equal(result.checks.find((entry) => entry.id === "evidence-supported")?.passed, true);
  assert.equal(result.checks.find((entry) => entry.id === "challenger-evidence-supported")?.passed, false);
  assert.equal(result.status, "FAIL");
});

test("Challenger evidence IDs must match the adjudicated set exactly", async () => {
  const proposal = fixtureProposal("noop-duplicate-news");
  const challenger = ChallengerVerdictSchema.parse({
    ...fixtureVerdict(proposal.caseId),
    evidenceIds: ["obs-1", "obs-2", "obs-1"],
  });
  const { result } = await gateFixture({ caseId: proposal.caseId, proposal, challenger });
  const evidence = result.checks.find((entry) => entry.id === "challenger-evidence-supported");
  assert.equal(result.status, "FAIL");
  assert.ok(evidence?.details.some((detail) => /Duplicate Challenger/.test(detail)));
});

test("a confirming Challenger cannot retain blocking residual risk", async () => {
  const proposal = fixtureProposal("noop-duplicate-news");
  const challenger = ChallengerVerdictSchema.parse({
    ...fixtureVerdict(proposal.caseId),
    residualRisks: ["The proposal may still be unsafe."],
  });
  const { result } = await gateFixture({ caseId: proposal.caseId, proposal, challenger });
  assert.equal(result.status, "FAIL");
  assert.equal(result.checks.find((entry) => entry.id === "challenger-compatible")?.passed, false);
});

test("a correct data update must produce the complete adjudicated artifact", async () => {
  const caseId = "update-official-commitment";
  const { result, workspace } = await gateFixture({ caseId, applyProposal: true });
  const updated = JSON.parse(await readFile(join(workspace, "input", "canonical.json"), "utf8"));
  assert.equal(result.status, "PASS");
  assert.equal(updated[0].status, "committed");
  assert.equal(updated[0].team, "Coastal State");

  const valid = fixtureProposal(caseId);
  const proposal = MaintainerProposalSchema.parse({
    ...valid,
    evidenceAssessments: valid.evidenceAssessments.map((entry) => ({
      ...entry,
      disposition: "REJECT",
      reason: "Incorrectly rejected authority.",
    })),
  });
  const rejected = await gateFixture({ caseId, proposal, applyProposal: true });
  assert.equal(rejected.result.status, "FAIL");
  assert.equal(rejected.result.checks.find((entry) => entry.id === "evidence-supported")?.passed, false);
});

test("a structured retry plan must match the bounded adjudicated plan exactly", async () => {
  const caseId = "retry-deferred-406";
  assert.equal((await gateFixture({ caseId })).result.status, "PASS");
  const valid = fixtureProposal(caseId);
  assert.equal(valid.action, "RETRY_LATER");
  const early = MaintainerProposalSchema.parse({
    ...valid,
    retryPlan: { ...valid.retryPlan, notBefore: "2026-08-28T17:19:00.000Z" },
  });
  const extra = MaintainerProposalSchema.parse({
    ...valid,
    retryPlan: {
      ...valid.retryPlan,
      preserveRecordIds: [...valid.retryPlan.preserveRecordIds, "invented-record"],
    },
  });
  assert.equal((await gateFixture({ caseId, proposal: early })).result.status, "FAIL");
  assert.equal((await gateFixture({ caseId, proposal: extra })).result.status, "FAIL");
});

test("human review requires one exact resolving-information bundle", async () => {
  const caseId = "review-name-collision";
  assert.equal((await gateFixture({ caseId })).result.status, "PASS");
  const valid = fixtureProposal(caseId);
  assert.equal(valid.action, "HUMAN_REVIEW");
  const sourceBound = MaintainerProposalSchema.parse({
    ...valid,
    reviewRequest: {
      ...valid.reviewRequest,
      targetEvidenceId: "obs-name-only-award",
    },
  });
  assert.equal((await gateFixture({ caseId, proposal: sourceBound })).result.status, "PASS");
  const wrongSource = MaintainerProposalSchema.parse({
    ...sourceBound,
    reviewRequest: { ...sourceBound.reviewRequest, targetEvidenceId: "invented-observation" },
  });
  const wrongSourceResult = await gateFixture({ caseId, proposal: wrongSource });
  assert.equal(wrongSourceResult.result.status, "FAIL");
  const wrongSubject = MaintainerProposalSchema.parse({
    ...sourceBound,
    reviewRequest: { ...sourceBound.reviewRequest, subjectId: "Unknown Jordan Lee" },
  });
  const rejected = await gateFixture({ caseId, proposal: wrongSubject });
  assert.equal(rejected.result.status, "FAIL");
  assert.equal(rejected.result.checks.find((entry) => entry.id === "required-artifact")?.passed, false);
});

test("a write outside the allowed surface fails even when the action is correct", async () => {
  const { result } = await gateFixture({
    caseId: "noop-duplicate-news",
    extraWrite: { path: "unapproved.txt", content: "not allowed\n" },
  });
  assert.equal(result.status, "FAIL");
  assert.equal(result.checks.find((entry) => entry.id === "allowed-write-surface")?.passed, false);
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
  const assignment = [{ field: "status", value: "new" }] as const;
  await assert.rejects(() => applyOperations(root, [{
    kind: "SET_RECORD_FIELDS", file: "duplicate.json", recordId: "x", assignments: [...assignment],
  }]), /duplicate/i);
  await assert.rejects(() => applyOperations(root, [{
    kind: "SET_RECORD_FIELDS", file: "duplicate.json", recordId: "missing", assignments: [...assignment],
  }]), /record/i);
  await assert.rejects(() => applyOperations(root, [{
    kind: "SET_RECORD_FIELDS", file: "object.json", recordId: "x", assignments: [...assignment],
  }]), /array/i);
  await assert.rejects(() => applyOperations(root, [{
    kind: "SET_RECORD_FIELDS", file: "../outside.json", recordId: "x", assignments: [...assignment],
  }]), /path|normalized|relative/i);
});

test("a text mutation that corrupts JSON is classified as a candidate mutation error", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-mutation-invalid-json-"));
  await writeFile(join(root, "records.json"), '[{"id":"x","status":"old"}]\n', "utf8");
  await assert.rejects(
    () => applyOperations(root, [
      {
        kind: "REPLACE_TEXT",
        file: "records.json",
        find: '"status":"old"',
        replace: '"status":',
        expectedCount: 1,
      },
      {
        kind: "SET_RECORD_FIELDS",
        file: "records.json",
        recordId: "x",
        assignments: [{ field: "status", value: "new" }],
      },
    ]),
    (error: unknown) => error instanceof MutationApplicationError && /valid JSON/i.test(error.message),
  );
});
