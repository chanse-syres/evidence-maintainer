import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { copyCaseWorkspace, loadOracle, loadPublicCase } from "../src/core/case-loader.ts";
import { BaselineResultSchema, ChallengerVerdictSchema, MaintainerProposalSchema } from "../src/core/schemas.ts";
import { snapshotTree } from "../src/core/tree-snapshot.ts";
import { generateHoldoutCases, HOLDOUT_CASE_IDS } from "../scripts/generate-holdout-cases.ts";
import { generateHoldoutV3Cases, HOLDOUT_V3_CASE_IDS } from "../scripts/generate-holdout-v3-cases.ts";

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
  "review-conflicting-authorities",
  "review-name-collision",
  "review-reintroduced-identity",
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

test("the full suite contains fifteen hash-verified cases with a balanced action distribution", async () => {
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
    if (oracle.expectedAction !== "RETRY_LATER") {
      const cutoffMs = new Date(loaded.policy.cutoff).getTime();
      const freshnessMs = loaded.policy.freshnessWindowMinutes * 60_000;
      const requiredEvidenceIds = new Set(
        oracle.evidenceAssessmentBundles.flat().map((assessment) => assessment.evidenceId),
      );
      for (const evidenceId of requiredEvidenceIds) {
        const observation = loaded.observations.find((entry) => entry.id === evidenceId);
        if (observation) {
          assert.ok(
            cutoffMs - new Date(observation.observedAt).getTime() <= freshnessMs,
            `${caseId} must not hide incidental staleness in required evidence ${evidenceId}`,
          );
        }
      }
    }
    if (oracle.expectedAction === "UPDATE_DATA") {
      for (const expectation of oracle.expectedRecords) {
        const records = JSON.parse(
          await readFile(join(caseDir, "workspace", ...expectation.file.split("/")), "utf8"),
        ) as Array<Record<string, unknown>>;
        const current = records.find((entry) => entry.id === expectation.recordId);
        assert.ok(current, `${caseId} must expose the adjudicated record`);
        for (const [field, expectedValue] of Object.entries(expectation.fields)) {
          if (JSON.stringify(current[field]) !== JSON.stringify(expectedValue)) {
            assert.ok(
              loaded.policy.authorityByField[field],
              `${caseId} must publicly identify authority for changed field ${field}`,
            );
          }
        }
      }
    }
    distribution.set(oracle.expectedAction, (distribution.get(oracle.expectedAction) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries([...distribution].sort()), {
    HUMAN_REVIEW: 3,
    NO_ACTION: 3,
    REPAIR_ADAPTER: 3,
    RETRY_LATER: 3,
    UPDATE_DATA: 3,
  });
});

test("the untouched holdout generator creates one hash-verified case per action", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-holdout-cases-"));
  assert.deepEqual(await generateHoldoutCases(root), [...HOLDOUT_CASE_IDS]);
  const actions = new Set<string>();
  for (const caseId of HOLDOUT_CASE_IDS) {
    const loaded = await loadPublicCase(join(root, caseId));
    const oracle = await loadOracle(join(root, caseId));
    assert.equal(loaded.manifest.id, caseId);
    assert.match(loaded.workspaceHash, /^[a-f0-9]{64}$/);
    actions.add(oracle.expectedAction);
  }
  assert.deepEqual(
    [...actions].sort(),
    ["HUMAN_REVIEW", "NO_ACTION", "REPAIR_ADAPTER", "RETRY_LATER", "UPDATE_DATA"],
  );
});

test("the checked-in untouched holdout is byte-identical to the generator output", async () => {
  const generatedRoot = await mkdtemp(join(tmpdir(), "evidence-holdout-byte-check-"));
  await generateHoldoutCases(generatedRoot);
  const checkedIn = await snapshotTree(resolve("holdout", "cases"));
  const generated = await snapshotTree(generatedRoot);
  assert.deepEqual(checkedIn, generated);
});

test("the holdout release-skew case is inside its visible transient window", async () => {
  const loaded = await loadPublicCase(resolve("holdout", "cases", "retry-release-generation-skew"));
  const cutoff = new Date(loaded.policy.cutoff).getTime();
  const earliestAllowed = cutoff - loaded.policy.freshnessWindowMinutes * 60_000;
  assert.ok(
    loaded.observations.every((observation) => new Date(observation.observedAt).getTime() >= earliestAllowed),
    "every release-skew observation must be inside the policy's visible freshness window",
  );
});

test("holdout-v3 is reproducible, balanced, and checked in byte-for-byte", async () => {
  const generatedRoot = await mkdtemp(join(tmpdir(), "evidence-holdout-v3-check-"));
  assert.deepEqual(await generateHoldoutV3Cases(generatedRoot), [...HOLDOUT_V3_CASE_IDS]);
  const actions = new Set<string>();
  for (const caseId of HOLDOUT_V3_CASE_IDS) {
    const loaded = await loadPublicCase(join(generatedRoot, caseId));
    const oracle = await loadOracle(join(generatedRoot, caseId));
    assert.equal(loaded.manifest.id, caseId);
    assert.match(loaded.workspaceHash, /^[a-f0-9]{64}$/);
    actions.add(oracle.expectedAction);
  }
  assert.deepEqual(
    [...actions].sort(),
    ["HUMAN_REVIEW", "NO_ACTION", "REPAIR_ADAPTER", "RETRY_LATER", "UPDATE_DATA"],
  );
  assert.deepEqual(
    await snapshotTree(resolve("holdout", "v3", "cases")),
    await snapshotTree(generatedRoot),
  );
});

test("holdout-v3 pagination starter is broken and the bounded reference repair passes", async () => {
  const caseId = "repair-generation-bound-pagination";
  const caseDir = resolve("holdout", "v3", "cases", caseId);
  const loaded = await loadPublicCase(caseDir);
  const starter = await run(loaded.manifest.requiredCommands[0], join(caseDir, "workspace"));
  assert.notEqual(starter.code, 0);
  assert.match(starter.output, /pass 1/i);
  assert.match(starter.output, /fail 1/i);

  const root = await mkdtemp(join(tmpdir(), "evidence-holdout-v3-reference-"));
  const workspace = await copyCaseWorkspace(caseDir, join(root, "workspace"));
  await writeFile(join(workspace, "adapter.ts"), `export interface CatalogRecord { id: string; value: number }
export interface CatalogPage {
  generation: number;
  requestCursor: string | null;
  nextCursor: string | null;
  records: CatalogRecord[];
}

export function materializeSnapshot(pages: CatalogPage[]): CatalogRecord[] {
  let current: { generation: number; nextCursor: string | null; records: CatalogRecord[] } | null = null;
  let completed: CatalogRecord[] | null = null;
  for (const page of pages) {
    if (page.requestCursor === null) {
      current = { generation: page.generation, nextCursor: page.nextCursor, records: [...page.records] };
    } else if (
      current !== null &&
      page.generation === current.generation &&
      page.requestCursor === current.nextCursor
    ) {
      current.records.push(...page.records);
      current.nextCursor = page.nextCursor;
    } else {
      current = null;
    }
    if (current?.nextCursor === null) {
      completed = [...current.records];
      current = null;
    }
  }
  if (current !== null || completed === null) throw new Error("No complete terminal generation");
  return completed;
}
`, "utf8");
  const reference = await run(loaded.manifest.requiredCommands[0], workspace);
  assert.equal(reference.code, 0, reference.output);
});

test("human-review cases require an exact resolving-information request and zero mutation", async () => {
  for (const caseId of [
    "review-conflicting-authorities",
    "review-name-collision",
    "review-reintroduced-identity",
  ] as const) {
    const caseDir = resolve("cases", caseId);
    const loaded = await loadPublicCase(caseDir);
    const oracle = await loadOracle(caseDir);
    assert.deepEqual(loaded.manifest.allowedWritePaths, []);
    assert.equal(oracle.expectedAction, "HUMAN_REVIEW");
    assert.equal(oracle.requiredChallengerVerdict, "CONFIRM");
    assert.deepEqual(oracle.allowedChangedFiles, []);
    assert.ok(oracle.acceptableReviewRequests.length >= 1);
    assert.ok(oracle.acceptableReviewRequests.every((request) => request.requestedFactPaths.length >= 1));
    assert.ok(oracle.acceptableReviewRequests.every((request) => request.targetEvidenceId.length >= 1));
    assert.equal(oracle.expectedRetryPlan, null);
  }
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

test("recorded offline fixtures cover every core case and all three agent roles", async () => {
  const fixtures = JSON.parse(
    await readFile(resolve("artifacts", "recorded", "runner-fixtures.json"), "utf8"),
  ) as Record<string, unknown>;
  for (const caseId of CORE_CASE_IDS) {
    BaselineResultSchema.parse(fixtures[`${caseId}:baseline`]);
    MaintainerProposalSchema.parse(fixtures[`${caseId}:maintainer`]);
    ChallengerVerdictSchema.parse(fixtures[`${caseId}:challenger`]);
  }
});

test("holdout invalidations are immutable versioned disclosures", async () => {
  const expected = [
    {
      file: "INVALIDATION-v1.json",
      campaign: "holdout-v1",
      status: "INVALID_EVALUATOR_ABORTED_NO_SCORE",
      freezeIdentity: "2e876ef3189eef5dc6103ab5714d4c2ffba6a2b8",
    },
    {
      file: "INVALIDATION-v2.json",
      campaign: "holdout-v2",
      status: "INVALID_FOR_PRIMARY_SAFE_DECISION_RATE",
      freezeIdentity: "8fbdfb94c237a7634b091332d3dcfbd9ed10b8c7",
    },
    {
      file: "INVALIDATION-v3.json",
      campaign: "holdout-v3",
      status: "INVALID_FOR_SYSTEM_COMPARISON",
      freezeIdentity: "f69d58d67c919456807c505a2e5aeea991f01a86",
    },
  ] as const;

  const files = (await readdir(resolve("holdout")))
    .filter((entry) => /^INVALIDATION-v\d+\.json$/.test(entry))
    .sort();
  for (const expectedRecord of expected) {
    assert.ok(files.includes(expectedRecord.file), `${expectedRecord.file} must remain a separate disclosure`);
  }

  for (const expectedRecord of expected) {
    const record = JSON.parse(
      await readFile(resolve("holdout", expectedRecord.file), "utf8"),
    ) as Record<string, unknown>;
    assert.equal(record.schemaVersion, 1);
    assert.equal(record.campaign, expectedRecord.campaign);
    assert.equal(record.status, expectedRecord.status);
    assert.equal(
      record.freezeCommit ?? record.frozenHarnessCommit,
      expectedRecord.freezeIdentity,
      `${expectedRecord.file} must remain bound to its original frozen campaign`,
    );
  }
});

test("v3 invalidation preserves evidence without permitting a system comparison", async () => {
  const record = JSON.parse(
    await readFile(resolve("holdout", "INVALIDATION-v3.json"), "utf8"),
  ) as {
    publicComparisonEligible: boolean;
    freezeTag: string;
    freezeCommit: string;
    freezeLockSha256: string;
    runDirectory: string;
    completedWorkflowSlots: number;
    defects: Array<{ defectId: string; affectedCaseIds?: string[] }>;
    rawDescriptiveCounts: {
      allWorkflowSlots: Record<string, number>;
      baseline: Record<string, number>;
      advanced: Record<string, number>;
    };
  };

  assert.equal(record.publicComparisonEligible, false);
  assert.equal(record.freezeTag, "holdout-freeze-v3");
  assert.equal(record.freezeCommit, "f69d58d67c919456807c505a2e5aeea991f01a86");
  assert.equal(record.freezeLockSha256, "42c230c4d5f017b79c93be3487fa22404a02eda93f88acd5075a6e4f09994b7d");
  assert.equal(record.runDirectory, "artifacts/evaluation/holdout-v3");
  assert.equal(record.completedWorkflowSlots, 30);
  assert.deepEqual(
    record.defects.map((defect) => defect.defectId),
    ["ASYMMETRIC_CHALLENGER", "SEMANTICALLY_INVALID_CASES"],
  );
  assert.deepEqual(record.defects[1]?.affectedCaseIds, [
    "retry-shard-watermark-barrier",
    "update-effective-energy-tariff",
  ]);
  assert.deepEqual(record.rawDescriptiveCounts.allWorkflowSlots, {
    completed: 30,
    correctActions: 30,
    sourceCoveragePasses: 30,
    forbiddenMutations: 0,
  });
  assert.equal(record.rawDescriptiveCounts.baseline.workflowSlots, 15);
  assert.equal(record.rawDescriptiveCounts.baseline.operationalDecisionIntegrityPasses, 15);
  assert.equal(record.rawDescriptiveCounts.advanced.workflowSlots, 15);
  assert.equal(record.rawDescriptiveCounts.advanced.operationalDecisionIntegrityPasses, 14);
});

test("no invalidated v1-v3 campaign is selected as the public comparison", async () => {
  const selection = JSON.parse(
    await readFile(resolve("config", "public-comparison.json"), "utf8"),
  ) as {
    schemaVersion: number;
    status: string;
    selectedCampaign: string | null;
    selectedSummary: string | null;
    excludedCampaigns: Array<{ campaign: string; invalidation: string }>;
  };

  assert.equal(selection.schemaVersion, 1);
  assert.equal(selection.status, "PENDING_VALID_V4_CAMPAIGN");
  assert.equal(selection.selectedCampaign, null);
  assert.equal(selection.selectedSummary, null);
  assert.deepEqual(selection.excludedCampaigns, [
    { campaign: "holdout-v1", invalidation: "holdout/INVALIDATION-v1.json" },
    { campaign: "holdout-v2", invalidation: "holdout/INVALIDATION-v2.json" },
    { campaign: "holdout-v3", invalidation: "holdout/INVALIDATION-v3.json" },
  ]);
});
