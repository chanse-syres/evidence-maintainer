import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  copyCaseWorkspaceV4,
  loadOracleV4,
  loadPublicCaseV4,
} from "../src/core/case-loader.ts";
import { evaluateAuthorityValidity } from "../src/core/authority-validity.ts";
import { evaluateFutureConditions } from "../src/core/future-conditions.ts";
import { applyOperations } from "../src/core/mutation-engine.ts";
import {
  DecisionPackageSchema,
  type DecisionPackage,
  type EvidenceAssessment,
} from "../src/core/schemas.ts";
import { evaluateDecisionPackage } from "../src/core/semantic-evaluator.ts";
import { snapshotTree } from "../src/core/tree-snapshot.ts";

const EXPECTED_V4_CASE_IDS = [
  "update-bitemporal-assay-calibration",
  "repair-epoch-delta-materialization",
  "retry-signed-release-quorum",
  "noop-post-cutoff-reclassification",
  "review-composite-asset-identity",
] as const;

const REFERENCE_ADAPTER = `export interface DeltaEvent {
  epoch: number;
  sequence: number;
  kind: "BEGIN" | "UPSERT" | "DELETE" | "COMMIT";
  key?: string;
  value?: number;
}

export function materializeEpoch(events: DeltaEvent[]): Array<{ key: string; value: number }> {
  const epochs = new Map<number, DeltaEvent[]>();
  for (const event of events) {
    const group = epochs.get(event.epoch) ?? [];
    group.push(event);
    epochs.set(event.epoch, group);
  }
  for (const epoch of [...epochs.keys()].sort((left, right) => right - left)) {
    const group = epochs.get(epoch)!.sort((left, right) => left.sequence - right.sequence);
    if (group.length < 2 || group[0]?.kind !== "BEGIN" || group[0]?.sequence !== 0) continue;
    if (group.at(-1)?.kind !== "COMMIT") continue;
    if (group.some((event, index) => event.sequence !== index)) continue;
    const state = new Map<string, number>();
    let valid = true;
    for (const event of group.slice(1, -1)) {
      if (event.kind === "UPSERT" && event.key !== undefined && event.value !== undefined) {
        state.set(event.key, event.value);
      } else if (event.kind === "DELETE" && event.key !== undefined) {
        state.delete(event.key);
      } else {
        valid = false;
      }
    }
    if (!valid) continue;
    return [...state].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => ({ key, value }));
  }
  throw new Error("No complete valid epoch");
}
`;

interface V4GeneratorModule {
  HOLDOUT_V4_CASE_IDS: readonly string[];
  generateHoldoutV4Cases(root?: string): Promise<string[]>;
}

interface HiddenProbe {
  schemaVersion: number;
  exportName: string;
  cases: Array<{ id: string; args: unknown[]; expected: unknown }>;
}

async function generator(): Promise<V4GeneratorModule> {
  return import("../scripts/generate-holdout-v4-cases.ts") as Promise<V4GeneratorModule>;
}

async function run(command: string, cwd: string): Promise<{ code: number; output: string }> {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(command, {
    cwd,
    env,
    shell: true,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
  const [code] = await once(child, "close") as [number | null, NodeJS.Signals | null];
  return { code: code ?? 1, output: Buffer.concat(chunks).toString("utf8") };
}

test("holdout-v4 is a reproducible fresh five-action pack", async () => {
  const generatorModule = await generator();
  assert.deepEqual(generatorModule.HOLDOUT_V4_CASE_IDS, EXPECTED_V4_CASE_IDS);

  const generatedRoot = await mkdtemp(join(tmpdir(), "evidence-holdout-v4-"));
  assert.deepEqual(await generatorModule.generateHoldoutV4Cases(generatedRoot), EXPECTED_V4_CASE_IDS);

  const actions = new Set<string>();
  for (const caseId of EXPECTED_V4_CASE_IDS) {
    const loaded = await loadPublicCaseV4(join(generatedRoot, caseId));
    const oracle = await loadOracleV4(join(generatedRoot, caseId));
    assert.equal(loaded.manifest.id, caseId);
    assert.equal(loaded.policy.schemaVersion, 2);
    assert.equal(oracle.schemaVersion, 3);
    assert.equal(oracle.caseId, caseId);
    assert.match(loaded.workspaceHash, /^[a-f0-9]{64}$/);
    actions.add(oracle.expectedAction);
  }
  assert.deepEqual(
    [...actions].sort(),
    ["HUMAN_REVIEW", "NO_ACTION", "REPAIR_ADAPTER", "RETRY_LATER", "UPDATE_DATA"],
  );

  assert.deepEqual(
    await snapshotTree(resolve("holdout", "v4", "cases")),
    await snapshotTree(generatedRoot),
  );

  const previousIds = new Set<string>();
  for (const root of [resolve("holdout", "cases"), resolve("holdout", "v3", "cases")]) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory()) previousIds.add(entry.name);
    }
  }
  assert.deepEqual(
    EXPECTED_V4_CASE_IDS.filter((caseId) => previousIds.has(caseId)),
    [],
    "V4 must not reuse a prior holdout identity",
  );
});

test("V4 state decisions have one explicit authoritative route", async () => {
  const update = await loadPublicCaseV4(resolve("holdout", "v4", "cases", EXPECTED_V4_CASE_IDS[0]));
  const updateOracle = await loadOracleV4(update.caseDir);
  assert.equal(updateOracle.expectedAction, "UPDATE_DATA");
  for (const requirement of updateOracle.requiredRecordProperties) {
    for (const property of Object.keys(requirement.properties)) {
      assert.ok(
        update.policy.authorityByField[property],
        `changed property ${property} must have public authority`,
      );
    }
  }
  const updateValidity = evaluateAuthorityValidity(update.policy, update.observations);
  assert.ok(updateValidity.validObservationIds.includes("obs-assay-440"));
  assert.ok(updateValidity.validObservationIds.includes("obs-calibration-cal-17"));
  assert.ok(!updateValidity.validObservationIds.includes("obs-calibration-cal-18"));

  const noop = await loadPublicCaseV4(resolve("holdout", "v4", "cases", EXPECTED_V4_CASE_IDS[3]));
  const noopOracle = await loadOracleV4(noop.caseDir);
  assert.equal(noopOracle.expectedAction, "NO_ACTION");
  assert.deepEqual(noop.manifest.allowedWritePaths, []);
  assert.deepEqual(noopOracle.allowedChangedFiles, []);
  const noopValidity = evaluateAuthorityValidity(noop.policy, noop.observations);
  assert.ok(noopValidity.validObservationIds.includes("obs-classification-r7"));
  assert.ok(!noopValidity.validObservationIds.includes("obs-classification-r8"));

  const review = await loadPublicCaseV4(resolve("holdout", "v4", "cases", EXPECTED_V4_CASE_IDS[4]));
  const reviewOracle = await loadOracleV4(review.caseDir);
  assert.equal(reviewOracle.expectedAction, "HUMAN_REVIEW");
  assert.deepEqual(review.manifest.allowedWritePaths, []);
  assert.deepEqual(reviewOracle.allowedChangedFiles, []);
  assert.deepEqual(reviewOracle.reviewRequirements.requiredFactPaths.sort(), [
    "facts.assetSerial",
    "facts.siteCode",
  ]);
  assert.ok(reviewOracle.reviewRequirements.acceptableTargetEvidenceIds.includes("obs-inspection-882"));
});

test("V4 retry conditions accept a fresh complete quorum and reject every near miss", async () => {
  const loaded = await loadPublicCaseV4(resolve("holdout", "v4", "cases", EXPECTED_V4_CASE_IDS[2]));
  const oracle = await loadOracleV4(loaded.caseDir);
  assert.equal(oracle.expectedAction, "RETRY_LATER");

  assert.ok(
    loaded.policy.rules.includes(
      "The signed manifest establishes generation 42 and its digest; it must have a valid signature, and both named replica authorities must independently match that generation and digest and report complete status",
    ),
    "the public quorum rule must match the graded manifest and replica semantics",
  );
  assert.ok(
    loaded.policy.rules.includes(
      "Retry no earlier than 2026-08-29T20:05:00.000Z and no later than 2026-08-29T20:20:00.000Z; use two or three attempts and escalate no later than attempt three",
    ),
    "the complete graded retry window and attempt bounds must be public",
  );

  assert.equal(
    evaluateFutureConditions(oracle.requiredFutureConditions, oracle.satisfyingObservations).passed,
    true,
  );
  for (const fixture of oracle.nearMissObservationFixtures) {
    assert.equal(
      evaluateFutureConditions(oracle.requiredFutureConditions, fixture.observations).passed,
      false,
      `${fixture.id} must remain insufficient`,
    );
  }

  const frozenIds = new Set(loaded.observations.map((observation) => observation.id));
  assert.ok(
    oracle.satisfyingObservations.every((observation) => !frozenIds.has(observation.id)),
    "future satisfaction must not require frozen evidence identities",
  );
  assert.ok(
    oracle.requiredFutureConditions.every((condition) =>
      condition.selector.sourceId.length > 0
      && condition.selector.subjectId === "release-42"
      && condition.selector.factPath.startsWith("facts.")),
  );
});

test("V4 adapter starts broken while an independent repair clears public and private probes", async () => {
  const caseDir = resolve("holdout", "v4", "cases", EXPECTED_V4_CASE_IDS[1]);
  const loaded = await loadPublicCaseV4(caseDir);
  const oracle = await loadOracleV4(caseDir);
  assert.equal(oracle.expectedAction, "REPAIR_ADAPTER");
  assert.equal(oracle.requiresHiddenProbe, true);
  assert.ok(oracle.hiddenProbePath);

  const starter = await run(loaded.manifest.requiredCommands[0], join(caseDir, "workspace"));
  assert.notEqual(starter.code, 0);
  assert.match(starter.output, /pass 1/i);
  assert.match(starter.output, /fail 2/i);

  const publicAdapterTests = await readFile(join(caseDir, "workspace", "adapter.test.ts"), "utf8");
  assert.match(
    publicAdapterTests,
    /assert\.throws\([\s\S]*No complete valid epoch/,
    "the public suite must exercise the documented no-valid-epoch error",
  );

  const root = await mkdtemp(join(tmpdir(), "evidence-holdout-v4-reference-"));
  const workspace = await copyCaseWorkspaceV4(caseDir, join(root, "workspace"));
  await writeFile(join(workspace, "adapter.ts"), `export interface DeltaEvent {
  epoch: number;
  sequence: number;
  kind: "BEGIN" | "UPSERT" | "DELETE" | "COMMIT";
  key?: string;
  value?: number;
}

export function materializeEpoch(events: DeltaEvent[]): Array<{ key: string; value: number }> {
  const epochs = new Map<number, DeltaEvent[]>();
  for (const event of events) {
    const group = epochs.get(event.epoch) ?? [];
    group.push(event);
    epochs.set(event.epoch, group);
  }
  for (const epoch of [...epochs.keys()].sort((left, right) => right - left)) {
    const group = epochs.get(epoch)!.sort((left, right) => left.sequence - right.sequence);
    if (group.length < 2 || group[0]?.kind !== "BEGIN" || group[0]?.sequence !== 0) continue;
    if (group.at(-1)?.kind !== "COMMIT") continue;
    if (group.some((event, index) => event.sequence !== index)) continue;
    const state = new Map<string, number>();
    let valid = true;
    for (const event of group.slice(1, -1)) {
      if (event.kind === "UPSERT" && event.key !== undefined && event.value !== undefined) {
        state.set(event.key, event.value);
      } else if (event.kind === "DELETE" && event.key !== undefined) {
        state.delete(event.key);
      } else {
        valid = false;
      }
    }
    if (!valid) continue;
    return [...state].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => ({ key, value }));
  }
  throw new Error("No complete valid epoch");
}
`, "utf8");

  const repaired = await run(loaded.manifest.requiredCommands[0], workspace);
  assert.equal(repaired.code, 0, repaired.output);

  const probe = JSON.parse(
    await readFile(resolve(caseDir, ...oracle.hiddenProbePath.split("/")), "utf8"),
  ) as HiddenProbe;
  const adapter = await import(`${pathToFileURL(join(workspace, "adapter.ts")).href}?v4-reference`);
  const implementation = adapter[probe.exportName] as (...args: unknown[]) => unknown;
  for (const entry of probe.cases) {
    assert.deepEqual(implementation(...entry.args), entry.expected, entry.id);
  }
});

function assessment(evidenceId: string, factPath: string): EvidenceAssessment {
  return {
    evidenceId,
    factPath,
    disposition: "SUPPORT",
    reason: "The named public authority supports the reference decision.",
  };
}

test("every intended V4 action has a passing reference decision", async () => {
  for (const caseId of EXPECTED_V4_CASE_IDS) {
    const caseDir = resolve("holdout", "v4", "cases", caseId);
    const loaded = await loadPublicCaseV4(caseDir);
    const oracle = await loadOracleV4(caseDir);
    const root = await mkdtemp(join(tmpdir(), "evidence-holdout-v4-decision-"));
    const workspace = await copyCaseWorkspaceV4(caseDir, join(root, "workspace"));
    const before = await snapshotTree(workspace);

    let packageValue: DecisionPackage;
    if (oracle.expectedAction === "UPDATE_DATA") {
      packageValue = DecisionPackageSchema.parse({
        schemaVersion: 3,
        caseId,
        action: "UPDATE_DATA",
        firstMaterialDivergence: "The canonical assay still uses calibration cal-16.",
        failureOwner: "canonical-assay",
        evidenceAssessments: [
          assessment("obs-assay-440", "facts.rawSignal"),
          assessment("obs-calibration-cal-17", "facts.revision"),
        ],
        affectedEntities: ["assay-440"],
        affectedFiles: ["input/canonical.json"],
        operations: [{
          kind: "SET_RECORD_FIELDS",
          file: "input/canonical.json",
          recordId: "assay-440",
          assignments: [
            { field: "normalizedConcentration", value: 73 },
            { field: "calibrationRevision", value: "cal-17" },
          ],
        }],
        preservedInvariants: [loaded.policy.invariants[0]],
        unresolvedUncertainty: [],
        reviewRequest: null,
        retryPlan: null,
        summary: "Apply the signed calibration that governed the measurement.",
      });
    } else if (oracle.expectedAction === "REPAIR_ADAPTER") {
      const original = await readFile(join(workspace, "adapter.ts"), "utf8");
      packageValue = DecisionPackageSchema.parse({
        schemaVersion: 3,
        caseId,
        action: "REPAIR_ADAPTER",
        firstMaterialDivergence: "The starter combines mutation state across epoch boundaries.",
        failureOwner: "delta-adapter",
        evidenceAssessments: [assessment("obs-epoch-delta-contract", "facts.epochField")],
        affectedEntities: ["inventory-projection"],
        affectedFiles: ["adapter.ts"],
        operations: [{
          kind: "REPLACE_TEXT",
          file: "adapter.ts",
          find: original,
          replace: REFERENCE_ADAPTER,
          expectedCount: 1,
        }],
        preservedInvariants: [loaded.policy.invariants[0]],
        unresolvedUncertainty: [],
        reviewRequest: null,
        retryPlan: null,
        summary: "Materialize only the greatest complete valid epoch.",
      });
    } else if (oracle.expectedAction === "RETRY_LATER") {
      packageValue = DecisionPackageSchema.parse({
        schemaVersion: 3,
        caseId,
        action: "RETRY_LATER",
        firstMaterialDivergence: "The west replica has not reached the signed manifest generation.",
        failureOwner: "replica-publication",
        evidenceAssessments: [
          assessment("obs-manifest-42", "facts.generation"),
          assessment("obs-replica-east-42", "facts.generation"),
          assessment("obs-replica-west-41", "facts.generation"),
        ],
        affectedEntities: ["release-42"],
        affectedFiles: [],
        operations: [],
        preservedInvariants: [loaded.policy.invariants[0]],
        unresolvedUncertainty: ["The west replica may converge during the retry window."],
        reviewRequest: null,
        retryPlan: {
          notBefore: "2026-08-29T20:10:00.000Z",
          maxAttempts: 3,
          escalateAfterAttempt: 3,
          preserveRecordIds: ["release-42"],
          acceptanceConditions: oracle.requiredFutureConditions,
        },
        summary: "Wait for the independently confirmed three-source quorum.",
      });
    } else if (oracle.expectedAction === "NO_ACTION") {
      packageValue = DecisionPackageSchema.parse({
        schemaVersion: 3,
        caseId,
        action: "NO_ACTION",
        firstMaterialDivergence: "Revision r8 becomes effective after the snapshot cutoff.",
        failureOwner: "temporal-authority",
        evidenceAssessments: [
          assessment("obs-classification-r7", "facts.classification"),
          assessment("obs-classification-r8", "effectiveAt"),
        ],
        affectedEntities: ["policy-77"],
        affectedFiles: [],
        operations: [],
        preservedInvariants: [loaded.policy.invariants[0]],
        unresolvedUncertainty: [],
        reviewRequest: null,
        retryPlan: null,
        summary: "Keep the classification effective at the cutoff.",
      });
    } else {
      packageValue = DecisionPackageSchema.parse({
        schemaVersion: 3,
        caseId,
        action: "HUMAN_REVIEW",
        firstMaterialDivergence: "The inspection omits both fields needed to bind one asset occurrence.",
        failureOwner: "inspection-identity",
        evidenceAssessments: [
          assessment("obs-inspection-882", "facts.assetLabel"),
          assessment("obs-asset-east-8", "facts.assetSerial"),
        ],
        affectedEntities: ["inspection-882"],
        affectedFiles: [],
        operations: [],
        preservedInvariants: [loaded.policy.invariants[0]],
        unresolvedUncertainty: ["The inspection could refer to either registered asset."],
        reviewRequest: {
          subjectId: "inspection-882",
          targetEvidenceId: "obs-inspection-882",
          requestedFactPaths: ["facts.assetSerial", "facts.siteCode"],
        },
        retryPlan: null,
        summary: "Request the missing composite identity from the inspection authority.",
      });
    }

    await applyOperations(workspace, packageValue.operations);
    const after = await snapshotTree(workspace);
    const commandResults: Record<string, { exitCode: number; stdout: string; stderr: string }> = {};
    for (const command of loaded.manifest.requiredCommands) {
      commandResults[command] = { exitCode: 0, stdout: "# pass 2\n# fail 0\n", stderr: "" };
    }
    if (oracle.hiddenProbePath) {
      commandResults["hidden:" + oracle.hiddenProbePath] = {
        exitCode: 0,
        stdout: "# pass 3\n# fail 0\n",
        stderr: "",
      };
    }
    const result = await evaluateDecisionPackage({
      loadedCase: loaded,
      oracle,
      package: packageValue,
      workspace,
      before,
      after,
      commandResults,
      submissionMode: true,
      liveWriteAttempted: false,
    });
    assert.equal(
      result.operationalDecisionIntegrity,
      true,
      caseId + ": " + result.checks.filter((check) => !check.passed).map((check) => check.summary).join("; "),
    );
  }
});
