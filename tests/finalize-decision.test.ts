import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ModelExecutionError } from "../src/agents/runner.ts";
import { sha256Text } from "../src/core/canonical-json.ts";
import {
  CaseOracleV4Schema,
  DecisionPackageSchema,
  PolicyV4Schema,
  SourceObservationSchema,
  type CaseOracleV4,
  type DecisionPackage,
} from "../src/core/schemas.ts";
import { finalizeDecision } from "../src/workflows/finalize-decision.ts";

const observation = SourceObservationSchema.parse({
  id: "obs-official",
  sourceId: "official-register",
  observedAt: "2026-08-29T19:30:00.000Z",
  effectiveAt: "2026-08-29T19:00:00.000Z",
  authorityScope: ["status"],
  subjectId: "subject-1",
  kind: "status-event",
  status: 200,
  contentType: "application/json",
  schemaFingerprint: "register-v1",
  facts: { status: "active" },
});

const policy = PolicyV4Schema.parse({
  schemaVersion: 2,
  cutoff: "2026-08-29T20:00:00.000Z",
  authorityByField: { status: "official-register" },
  authorityValidity: [{
    mode: "SNAPSHOT_MAX_AGE",
    sourceId: "official-register",
    authorityScope: "status",
    maxAgeMinutes: 60,
  }],
  retryLimit: 3,
  invariants: ["Stable identity is preserved"],
  rules: ["Use official authority"],
});

const commonPackage = {
  schemaVersion: 3 as const,
  caseId: "finalize-case",
  firstMaterialDivergence: "The official register controls the outcome.",
  failureOwner: "canonical-state",
  evidenceAssessments: [{
    evidenceId: "obs-official",
    factPath: "facts.status",
    disposition: "SUPPORT" as const,
    reason: "The official source owns status.",
  }],
  affectedEntities: ["subject-1"],
  affectedFiles: [] as string[],
  preservedInvariants: ["Stable identity is preserved"],
  unresolvedUncertainty: [] as string[],
  summary: "Follow the official status.",
};

async function writeCase(input: {
  oracle: CaseOracleV4;
  allowedWritePaths?: string[];
  requiredCommands?: string[];
  extraWorkspaceFiles?: Record<string, string>;
  hiddenFiles?: Record<string, string>;
}): Promise<string> {
  const caseDir = await mkdtemp(join(tmpdir(), "finalize-case-"));
  const workspaceFiles: Record<string, string> = {
    "input/canonical.json": `${JSON.stringify([{ id: "subject-1", status: "pending", name: "Sam" }], null, 2)}\n`,
    "input/observations.json": `${JSON.stringify([observation], null, 2)}\n`,
    "input/policy.json": `${JSON.stringify(policy, null, 2)}\n`,
    ...input.extraWorkspaceFiles,
  };
  for (const [path, content] of Object.entries(workspaceFiles)) {
    const target = join(caseDir, "workspace", ...path.split("/"));
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  for (const [path, content] of Object.entries(input.hiddenFiles ?? {})) {
    const target = join(caseDir, ...path.split("/"));
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  const agentVisibleFiles = Object.keys(workspaceFiles).sort().map((path) => `workspace/${path}`);
  await writeFile(join(caseDir, "case.json"), `${JSON.stringify({
    schemaVersion: 1,
    id: "finalize-case",
    title: "Finalizer fixture",
    description: "A V4 finalization fixture.",
    sourceClass: "SYNTHETIC",
    createdFrom: "Unit test",
    agentVisibleFiles,
    allowedWritePaths: input.allowedWritePaths ?? [],
    requiredCommands: input.requiredCommands ?? [],
    provenance: Object.entries(workspaceFiles).map(([path, content]) => ({
      sourceId: `fixture-${path.replaceAll("/", "-")}`,
      path: `workspace/${path}`,
      sourceClass: "SYNTHETIC",
      capturedAt: "2026-08-29T19:30:00.000Z",
      transformation: "Unit fixture",
      permissionBasis: "Created for this benchmark",
      sha256: sha256Text(content),
    })),
  }, null, 2)}\n`, "utf8");
  await writeFile(join(caseDir, "oracle.json"), `${JSON.stringify(input.oracle, null, 2)}\n`, "utf8");
  return caseDir;
}

function noActionPackage(): DecisionPackage {
  return DecisionPackageSchema.parse({
    ...commonPackage,
    action: "NO_ACTION",
    operations: [],
    reviewRequest: null,
    retryPlan: null,
  });
}

function noActionOracle(): CaseOracleV4 {
  return CaseOracleV4Schema.parse({
    schemaVersion: 3,
    caseId: "finalize-case",
    expectedAction: "NO_ACTION",
    requiredEvidenceSourceBundles: [["official-register"]],
    forbiddenEvidenceClaims: [],
    allowedChangedFiles: [],
    expectedCommandExitCodes: {},
    hiddenProbePath: null,
    requiredAuthoritySources: ["official-register"],
  });
}

test("shared finalizer emits byte-equivalent evidence for equivalent baseline and advanced packages", async () => {
  const caseDir = await writeCase({ oracle: noActionOracle() });
  const root = await mkdtemp(join(tmpdir(), "finalize-equivalent-"));
  const first = await finalizeDecision({
    caseDir,
    runRoot: join(root, "baseline"),
    package: noActionPackage(),
    submissionMode: true,
    liveWriteAttempted: false,
  });
  const second = await finalizeDecision({
    caseDir,
    runRoot: join(root, "advanced"),
    package: noActionPackage(),
    submissionMode: true,
    liveWriteAttempted: false,
  });
  assert.deepEqual(first.gate, second.gate);
  assert.deepEqual(first.commandResults, second.commandResults);
  assert.deepEqual(first.before, second.before);
  assert.deepEqual(first.after, second.after);
  for (const artifact of ["final-decision.json", "before-tree.json", "after-tree.json", "command-results.json", "gate.json"]) {
    assert.equal(
      await readFile(join(root, "baseline", artifact), "utf8"),
      await readFile(join(root, "advanced", artifact), "utf8"),
    );
  }
});

function updateOracle(allowedChangedFiles = ["input/canonical.json"]): CaseOracleV4 {
  return CaseOracleV4Schema.parse({
    schemaVersion: 3,
    caseId: "finalize-case",
    expectedAction: "UPDATE_DATA",
    requiredEvidenceSourceBundles: [["official-register"]],
    forbiddenEvidenceClaims: [],
    allowedChangedFiles,
    expectedCommandExitCodes: {},
    hiddenProbePath: null,
    requiredRecordProperties: [{ file: "input/canonical.json", recordId: "subject-1", properties: { status: "active" } }],
    preservedRecordProperties: [{ file: "input/canonical.json", recordId: "subject-1", propertyPaths: ["name"] }],
  });
}

test("finalizer rejects operations outside either write allowlist", async () => {
  const variants = [
    { manifest: ["input/canonical.json"], oracle: ["input/canonical.json"], file: "outside.json" },
    { manifest: ["input/canonical.json"], oracle: ["other.json"], file: "input/canonical.json" },
  ];
  for (const variant of variants) {
    const caseDir = await writeCase({
      oracle: updateOracle(variant.oracle),
      allowedWritePaths: variant.manifest,
    });
    const packageValue = DecisionPackageSchema.parse({
      ...commonPackage,
      action: "UPDATE_DATA",
      affectedFiles: [variant.file],
      operations: [{
        kind: "SET_RECORD_FIELDS",
        file: variant.file,
        recordId: "subject-1",
        assignments: [{ field: "status", value: "active" }],
      }],
      reviewRequest: null,
      retryPlan: null,
    });
    await assert.rejects(() => finalizeDecision({
      caseDir,
      runRoot: join(caseDir, "run"),
      package: packageValue,
      submissionMode: true,
      liveWriteAttempted: false,
    }), (error: unknown) => error instanceof ModelExecutionError && error.kind === "INVALID_OPERATION");
  }
});

test("finalizer rejects a mutation that leaves JSON invalid", async () => {
  const oracle = CaseOracleV4Schema.parse({
    schemaVersion: 3,
    caseId: "finalize-case",
    expectedAction: "REPAIR_ADAPTER",
    requiredEvidenceSourceBundles: [["official-register"]],
    forbiddenEvidenceClaims: [],
    allowedChangedFiles: ["input/canonical.json"],
    expectedCommandExitCodes: {},
    hiddenProbePath: null,
    requiredPublicCommands: [],
    requiresHiddenProbe: false,
  });
  const caseDir = await writeCase({ oracle, allowedWritePaths: ["input/canonical.json"] });
  const packageValue = DecisionPackageSchema.parse({
    ...commonPackage,
    action: "REPAIR_ADAPTER",
    affectedFiles: ["input/canonical.json"],
    operations: [{
      kind: "REPLACE_TEXT",
      file: "input/canonical.json",
      find: '"status": "pending"',
      replace: '"status":',
      expectedCount: 1,
    }],
    reviewRequest: null,
    retryPlan: null,
  });
  await assert.rejects(() => finalizeDecision({
    caseDir,
    runRoot: join(caseDir, "run"),
    package: packageValue,
    submissionMode: true,
    liveWriteAttempted: false,
  }), /invalid JSON/i);
});

test("finalizer records a hidden-probe failure as failed command evidence", async () => {
  const probePath = "private/hidden-probe.json";
  const oracle = CaseOracleV4Schema.parse({
    schemaVersion: 3,
    caseId: "finalize-case",
    expectedAction: "REPAIR_ADAPTER",
    requiredEvidenceSourceBundles: [["official-register"]],
    forbiddenEvidenceClaims: [],
    allowedChangedFiles: ["adapter.ts"],
    expectedCommandExitCodes: {},
    hiddenProbePath: probePath,
    requiredPublicCommands: [],
    requiresHiddenProbe: true,
  });
  const caseDir = await writeCase({
    oracle,
    allowedWritePaths: ["adapter.ts"],
    extraWorkspaceFiles: { "adapter.ts": "export function transform(value) { return value + 1; }\n" },
    hiddenFiles: {
      [probePath]: `${JSON.stringify({
        schemaVersion: 1,
        exportName: "transform",
        cases: [{ id: "hidden-1", args: [1], expected: 2 }],
      }, null, 2)}\n`,
    },
  });
  const packageValue = DecisionPackageSchema.parse({
    ...commonPackage,
    action: "REPAIR_ADAPTER",
    affectedFiles: ["adapter.ts"],
    operations: [{
      kind: "REPLACE_TEXT",
      file: "adapter.ts",
      find: "value + 1",
      replace: "value + 2",
      expectedCount: 1,
    }],
    reviewRequest: null,
    retryPlan: null,
  });
  const result = await finalizeDecision({
    caseDir,
    runRoot: join(caseDir, "run"),
    package: packageValue,
    submissionMode: true,
    liveWriteAttempted: false,
  });
  assert.equal(result.gate.status, "FAIL");
  assert.equal(result.commandResults[`hidden:${probePath}`].exitCode, 1);
  assert.equal(result.gate.checks.find((entry) => entry.id === "required-commands-passed")?.passed, false);
});

test("finalizer refuses a caller-supplied workspace", async () => {
  const caseDir = await writeCase({ oracle: noActionOracle() });
  const runRoot = join(caseDir, "run");
  await mkdir(join(runRoot, "workspace"), { recursive: true });
  await assert.rejects(() => finalizeDecision({
    caseDir,
    runRoot,
    package: noActionPackage(),
    submissionMode: true,
    liveWriteAttempted: false,
  }), /pre-mutated workspace/i);
});
