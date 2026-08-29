import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { LoadedPublicCase } from "../src/core/case-loader.ts";
import { evaluateDecisionPackage } from "../src/core/semantic-evaluator.ts";
import {
  CaseManifestSchema,
  CaseOracleV4Schema,
  DecisionPackageSchema,
  PolicySchema,
  SourceObservationSchema,
  type CaseOracleV4,
  type DecisionPackage,
} from "../src/core/schemas.ts";
import { snapshotTree } from "../src/core/tree-snapshot.ts";

const observation = SourceObservationSchema.parse({
  id: "obs-official",
  sourceId: "official-register",
  observedAt: "2026-08-29T18:00:00.000Z",
  effectiveAt: "2026-08-29T17:00:00.000Z",
  authorityScope: ["status"],
  subjectId: "subject-1",
  kind: "status-event",
  status: 200,
  contentType: "application/json",
  schemaFingerprint: "register-v1",
  facts: { status: "active", generation: 12, stableId: "stable-1", program: "North" },
});

const commonDecision = {
  schemaVersion: 3 as const,
  caseId: "semantic-case",
  firstMaterialDivergence: "The official register differs from the canonical state.",
  failureOwner: "canonical-state",
  evidenceAssessments: [{
    evidenceId: "obs-official",
    factPath: "facts.status",
    disposition: "SUPPORT" as const,
    reason: "The official register owns status.",
  }],
  affectedEntities: ["subject-1"],
  affectedFiles: [] as string[],
  preservedInvariants: ["Stable identity is preserved"],
  unresolvedUncertainty: [] as string[],
  summary: "Use the official status evidence.",
};

const oracleCommon = {
  schemaVersion: 3 as const,
  caseId: "semantic-case",
  requiredEvidenceSourceBundles: [["official-register"]],
  forbiddenEvidenceClaims: [],
  allowedChangedFiles: [] as string[],
  expectedCommandExitCodes: {},
  hiddenProbePath: null,
};

async function fixture(input: {
  initial?: unknown;
  final?: unknown;
  package: DecisionPackage;
  oracle: CaseOracleV4;
  observations?: typeof observation[];
  allowedWritePaths?: string[];
  commandResults?: Record<string, { exitCode: number; stdout: string; stderr: string }>;
}) {
  const root = await (await import("node:fs/promises")).mkdtemp(join(tmpdir(), "semantic-evaluator-"));
  const caseDir = join(root, "case");
  const workspace = join(root, "run");
  await mkdir(join(caseDir, "workspace", "input"), { recursive: true });
  await mkdir(join(workspace, "input"), { recursive: true });
  const initial = input.initial ?? [];
  await writeFile(join(caseDir, "workspace", "input", "canonical.json"), `${JSON.stringify(initial, null, 2)}\n`);
  await writeFile(join(workspace, "input", "canonical.json"), `${JSON.stringify(initial, null, 2)}\n`);
  const before = await snapshotTree(workspace);
  if (input.final !== undefined) {
    await writeFile(join(workspace, "input", "canonical.json"), `${JSON.stringify(input.final, null, 2)}\n`);
  }
  const after = await snapshotTree(workspace);
  const loadedCase: LoadedPublicCase = {
    caseDir,
    manifest: CaseManifestSchema.parse({
      schemaVersion: 1,
      id: "semantic-case",
      title: "Semantic evaluator fixture",
      description: "A deterministic semantic fixture.",
      sourceClass: "SYNTHETIC",
      createdFrom: "Unit test",
      agentVisibleFiles: ["workspace/input/canonical.json"],
      allowedWritePaths: input.allowedWritePaths ?? [],
      requiredCommands: [],
      provenance: [{
        sourceId: "canonical-fixture",
        path: "workspace/input/canonical.json",
        sourceClass: "SYNTHETIC",
        capturedAt: "2026-08-29T18:00:00.000Z",
        transformation: "Unit fixture",
        permissionBasis: "Created for this benchmark",
        sha256: "a".repeat(64),
      }],
    }),
    canonical: initial,
    observations: input.observations ?? [observation],
    policy: PolicySchema.parse({
      schemaVersion: 1,
      cutoff: "2026-08-29T20:00:00.000Z",
      authorityByField: { status: "official-register" },
      freshnessWindowMinutes: 60,
      retryLimit: 3,
      invariants: ["Stable identity is preserved"],
      rules: ["Use official authority"],
    }),
    workspaceFiles: [],
    workspaceHash: "fixture",
  };
  return evaluateDecisionPackage({
    loadedCase,
    oracle: input.oracle,
    package: input.package,
    workspace,
    before,
    after,
    commandResults: input.commandResults ?? {},
    submissionMode: true,
    liveWriteAttempted: false,
  });
}

function retryPackage(acceptanceConditions: unknown[], overrides: Record<string, unknown> = {}) {
  return DecisionPackageSchema.parse({
    ...commonDecision,
    action: "RETRY_LATER",
    operations: [],
    reviewRequest: null,
    retryPlan: {
      notBefore: "2026-08-29T20:30:00.000Z",
      maxAttempts: 3,
      escalateAfterAttempt: 2,
      preserveRecordIds: ["subject-1"],
      acceptanceConditions,
      ...overrides,
    },
  });
}

function retryOracle(requiredFutureConditions: unknown[]) {
  return CaseOracleV4Schema.parse({
    ...oracleCommon,
    expectedAction: "RETRY_LATER",
    retryWindow: {
      earliestNotBefore: "2026-08-29T20:15:00.000Z",
      latestNotBefore: "2026-08-29T21:00:00.000Z",
      minimumAttempts: 2,
      maximumAttempts: 3,
      latestEscalationAttempt: 3,
    },
    requiredPreserveRecordIds: ["subject-1"],
    requiredFutureConditions,
    satisfyingObservations: [observation],
    nearMissObservationFixtures: [{
      id: "insufficient-generation",
      observations: [SourceObservationSchema.parse({
        ...observation,
        id: "obs-near-miss",
        facts: { ...observation.facts, generation: 11 },
      })],
    }],
  });
}

const generationCondition = {
  selector: {
    sourceId: "official-register",
    subjectId: "subject-1",
    factPath: "facts.generation",
  },
  operator: "GREATER_THAN_OR_EQUAL",
  expectedValue: 12,
};

test("semantic evaluator accepts reordered conditions, duplicate harmless evidence, and a harmless condition", async () => {
  const statusExists = {
    selector: {
      sourceId: "official-register",
      subjectId: "subject-1",
      factPath: "facts.status",
    },
    operator: "EXISTS",
  };
  const packageValue = retryPackage([statusExists, generationCondition]);
  packageValue.evidenceAssessments.push({ ...packageValue.evidenceAssessments[0] });
  const result = await fixture({ package: packageValue, oracle: retryOracle([generationCondition]) });
  assert.equal(result.operationalDecisionIntegrity, true);
  assert.equal(result.artifactCorrect, true);
  assert.equal(result.contradictionFree, true);
});

test("semantic evaluator rejects contradictory, unknown-source, and impossible retry plans", async () => {
  const contradictory = retryPackage([
    generationCondition,
    { ...generationCondition, operator: "LESS_THAN_OR_EQUAL", expectedValue: 10 },
  ]);
  const unknownSource = retryPackage([{ ...generationCondition, selector: { ...generationCondition.selector, sourceId: "unknown" } }]);
  const impossibleTime = retryPackage([generationCondition], { notBefore: "2026-08-29T22:00:00.000Z" });
  for (const packageValue of [contradictory, unknownSource, impossibleTime]) {
    const result = await fixture({ package: packageValue, oracle: retryOracle([generationCondition]) });
    assert.equal(result.operationalDecisionIntegrity, false);
  }
  assert.equal((await fixture({ package: contradictory, oracle: retryOracle([generationCondition]) })).contradictionFree, false);
});

test("semantic evaluator allows extra review facts but requires every decision-bearing fact", async () => {
  const oracle = CaseOracleV4Schema.parse({
    ...oracleCommon,
    expectedAction: "HUMAN_REVIEW",
    reviewRequirements: {
      subjectId: "subject-1",
      acceptableTargetEvidenceIds: ["obs-official"],
      requiredFactPaths: ["facts.stableId"],
    },
  });
  const packageValue = DecisionPackageSchema.parse({
    ...commonDecision,
    action: "HUMAN_REVIEW",
    operations: [],
    reviewRequest: {
      subjectId: "subject-1",
      targetEvidenceId: "obs-official",
      requestedFactPaths: ["facts.stableId", "facts.program"],
    },
    retryPlan: null,
  });
  assert.equal((await fixture({ package: packageValue, oracle })).operationalDecisionIntegrity, true);
  const missing = DecisionPackageSchema.parse({
    ...packageValue,
    reviewRequest: { ...packageValue.reviewRequest, requestedFactPaths: ["facts.program"] },
  });
  assert.equal((await fixture({ package: missing, oracle })).artifactCorrect, false);
});

test("semantic evaluator permits harmless record properties but preserves declared fields", async () => {
  const oracle = CaseOracleV4Schema.parse({
    ...oracleCommon,
    expectedAction: "UPDATE_DATA",
    allowedChangedFiles: ["input/canonical.json"],
    requiredRecordProperties: [{
      file: "input/canonical.json",
      recordId: "subject-1",
      properties: { status: "active" },
    }],
    preservedRecordProperties: [{
      file: "input/canonical.json",
      recordId: "subject-1",
      propertyPaths: ["name", "note"],
    }],
  });
  const packageValue = DecisionPackageSchema.parse({
    ...commonDecision,
    action: "UPDATE_DATA",
    affectedFiles: ["input/canonical.json"],
    operations: [{
      kind: "SET_RECORD_FIELDS",
      file: "input/canonical.json",
      recordId: "subject-1",
      assignments: [{ field: "status", value: "active" }, { field: "extra", value: "harmless" }],
    }],
    reviewRequest: null,
    retryPlan: null,
  });
  const initial = [{ id: "subject-1", status: "pending", name: "Sam", note: "keep" }];
  const final = [{ id: "subject-1", status: "active", name: "Sam", note: "keep", extra: "harmless" }];
  assert.equal((await fixture({
    initial,
    final,
    package: packageValue,
    oracle,
    allowedWritePaths: ["input/canonical.json"],
  })).operationalDecisionIntegrity, true);
  const altered = [{ id: "subject-1", status: "active", name: "Different", note: "keep" }];
  assert.equal((await fixture({
    initial,
    final: altered,
    package: packageValue,
    oracle,
    allowedWritePaths: ["input/canonical.json"],
  })).artifactCorrect, false);
});

test("semantic evaluator requires both public and hidden repair execution evidence", async () => {
  const publicCommand = "node --test public";
  const probePath = "tests/private-probe.mjs";
  const oracle = CaseOracleV4Schema.parse({
    ...oracleCommon,
    expectedAction: "REPAIR_ADAPTER",
    allowedChangedFiles: ["input/canonical.json"],
    expectedCommandExitCodes: { [publicCommand]: 0 },
    hiddenProbePath: probePath,
    requiredPublicCommands: [publicCommand],
    requiresHiddenProbe: true,
  });
  const packageValue = DecisionPackageSchema.parse({
    ...commonDecision,
    action: "REPAIR_ADAPTER",
    affectedFiles: ["input/canonical.json"],
    operations: [{
      kind: "REPLACE_TEXT",
      file: "input/canonical.json",
      find: "pending",
      replace: "active",
      expectedCount: 1,
    }],
    reviewRequest: null,
    retryPlan: null,
  });
  const initial = [{ id: "subject-1", status: "pending" }];
  const final = [{ id: "subject-1", status: "active" }];
  const passing = {
    [publicCommand]: { exitCode: 0, stdout: "ok", stderr: "" },
    [`hidden:${probePath}`]: { exitCode: 0, stdout: "ok", stderr: "" },
  };
  assert.equal((await fixture({
    initial,
    final,
    package: packageValue,
    oracle,
    allowedWritePaths: ["input/canonical.json"],
    commandResults: passing,
  })).operationalDecisionIntegrity, true);
  assert.equal((await fixture({
    initial,
    final,
    package: packageValue,
    oracle,
    allowedWritePaths: ["input/canonical.json"],
    commandResults: { ...passing, [`hidden:${probePath}`]: { exitCode: 1, stdout: "", stderr: "failed" } },
  })).requiredCommandsPassed, false);
});

test("annotation mismatch is diagnostic and does not change ODI", async () => {
  const extraObservation = SourceObservationSchema.parse({
    ...observation,
    id: "obs-context",
    sourceId: "context-feed",
  });
  const packageValue = DecisionPackageSchema.parse({
    ...commonDecision,
    action: "NO_ACTION",
    evidenceAssessments: [
      ...commonDecision.evidenceAssessments,
      { evidenceId: "obs-context", factPath: "facts.status", disposition: "CONTEXT", reason: "Context only." },
    ],
    operations: [],
    reviewRequest: null,
    retryPlan: null,
  });
  const oracle = CaseOracleV4Schema.parse({
    ...oracleCommon,
    expectedAction: "NO_ACTION",
    requiredAuthoritySources: ["official-register"],
  });
  const result = await fixture({ package: packageValue, oracle, observations: [observation, extraObservation] });
  assert.equal(result.operationalDecisionIntegrity, true);
  assert.equal(result.annotationAligned, false);
  assert.equal(result.checks.find((entry) => entry.id === "annotation-aligned")?.blocking, false);
});
