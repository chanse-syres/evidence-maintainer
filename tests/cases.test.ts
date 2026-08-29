import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { copyCaseWorkspace, loadOracle, loadPublicCase } from "../src/core/case-loader.ts";
import { BaselineResultSchema, ChallengerVerdictSchema, MaintainerProposalSchema } from "../src/core/schemas.ts";
import { generateHoldoutCases, HOLDOUT_CASE_IDS } from "../scripts/generate-holdout-cases.ts";

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
      for (const evidenceId of oracle.requiredEvidenceIds) {
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

test("human-review cases require escalation, exact missing information, and zero mutation", async () => {
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
    assert.equal(oracle.requiredChallengerVerdict, "ESCALATE");
    assert.deepEqual(oracle.allowedChangedFiles, []);
    assert.ok(oracle.requiredMinimumInformation.length >= 2);
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
