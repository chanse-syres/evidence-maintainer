import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ActionClassSchema,
  CaseManifestSchema,
  ChallengerVerdictSchema,
  MaintainerProposalSchema,
  MutationOperationSchema,
} from "../src/core/schemas.ts";
import { canonicalJson, sha256Json } from "../src/core/canonical-json.ts";
import { writeSchemas } from "../scripts/generate-schemas.ts";

const validProposal = {
  schemaVersion: 2,
  caseId: "noop-duplicate-news",
  action: "NO_ACTION",
  firstMaterialDivergence: "obs-2 duplicates event evt-1",
  failureOwner: "source-observation",
  evidenceAssessments: [{
    evidenceId: "obs-1",
    factPath: "facts.eventId",
    disposition: "SUPPORT",
    reason: "The event identity is authoritative.",
  }],
  affectedEntities: ["athlete-7"],
  affectedFiles: [],
  operations: [],
  preservedInvariants: ["canonical event IDs remain unique"],
  unresolvedUncertainty: [],
  reviewRequest: null,
  retryPlan: null,
  summary: "No canonical change is justified.",
};

test("action schema exposes the five maintenance decisions in stable order", () => {
  assert.deepEqual(ActionClassSchema.options, [
    "UPDATE_DATA",
    "REPAIR_ADAPTER",
    "RETRY_LATER",
    "NO_ACTION",
    "HUMAN_REVIEW",
  ]);
});

test("canonical JSON sorts object keys recursively while retaining array order", () => {
  assert.equal(
    canonicalJson({ z: [{ b: 2, a: 1 }, 3], a: true }),
    '{"a":true,"z":[{"a":1,"b":2},3]}',
  );
  assert.equal(sha256Json({ b: 2, a: 1 }), sha256Json({ a: 1, b: 2 }));
  assert.notEqual(sha256Json([1, 2]), sha256Json([2, 1]));
});

test("canonical JSON rejects values that cannot be represented deterministically", () => {
  for (const value of [undefined, () => 1, Symbol("x"), 1n, Number.NaN, Infinity]) {
    assert.throws(() => canonicalJson(value));
  }
  assert.throws(() => canonicalJson({ nested: undefined }));
});

test("maintainer proposals require a valid action and evidence-linked contract", () => {
  assert.deepEqual(MaintainerProposalSchema.parse(validProposal), validProposal);
  assert.throws(() => MaintainerProposalSchema.parse({ ...validProposal, action: "DELETE" }));
  assert.throws(() => MaintainerProposalSchema.parse({ ...validProposal, evidenceAssessments: [] }));
  assert.throws(() => MaintainerProposalSchema.parse({
    ...validProposal,
    evidenceAssessments: [{
      evidenceId: "obs-1",
      factPath: "not-a-fact-path",
      disposition: "SUPPORT",
      reason: "Invalid path.",
    }],
  }));
});

test("mutation operations reject traversal and accept bounded repair operations", () => {
  assert.equal(
    MutationOperationSchema.parse({
      kind: "SET_RECORD_FIELDS",
      file: "input/canonical.json",
      recordId: "athlete-11",
      assignments: [{ field: "status", value: "committed" }],
    }).kind,
    "SET_RECORD_FIELDS",
  );
  assert.equal(
    MutationOperationSchema.parse({
      kind: "REPLACE_TEXT",
      file: "adapter.ts",
      find: ".old-card",
      replace: "[data-athlete-id]",
      expectedCount: 1,
    }).kind,
    "REPLACE_TEXT",
  );
  assert.throws(() => MutationOperationSchema.parse({
    kind: "NO_MUTATION",
    reason: "wait",
    file: "../live.json",
  }));
});

test("challenger verdicts require evidence-linked reasons", () => {
  const verdict = ChallengerVerdictSchema.parse({
    schemaVersion: 1,
    caseId: "noop-duplicate-news",
    verdict: "CONFIRM",
    evidenceIds: ["obs-1"],
    violations: [],
    residualRisks: [],
    summary: "The no-action decision preserves the unique event.",
  });
  assert.equal(verdict.verdict, "CONFIRM");
  assert.throws(() => ChallengerVerdictSchema.parse({ ...verdict, evidenceIds: [] }));
});

test("case provenance binds each hash to one agent-visible relative path", () => {
  const manifest = {
    schemaVersion: 1,
    id: "noop-duplicate-news",
    title: "Duplicate coverage is not a new event",
    description: "Two articles report one already-canonical commitment.",
    sourceClass: "SYNTHETIC",
    createdFrom: "Public-data maintenance pattern",
    agentVisibleFiles: ["workspace/input/canonical.json"],
    allowedWritePaths: [],
    requiredCommands: [],
    provenance: [{
      sourceId: "canonical-fixture",
      path: "workspace/input/canonical.json",
      sourceClass: "SYNTHETIC",
      capturedAt: "2026-08-28T18:00:00.000Z",
      transformation: "Synthetic fixture",
      permissionBasis: "Created for this benchmark",
      sha256: "a".repeat(64),
    }],
  };
  assert.equal(CaseManifestSchema.parse(manifest).provenance[0].path, manifest.provenance[0].path);
  const withoutPath = { ...manifest.provenance[0] } as Partial<typeof manifest.provenance[0]>;
  Reflect.deleteProperty(withoutPath, "path");
  assert.throws(() => CaseManifestSchema.parse({ ...manifest, provenance: [withoutPath] }));
});

test("schema generation writes the three public agent contracts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidence-maintainer-schemas-"));
  const hashes = await writeSchemas(directory);
  assert.deepEqual(Object.keys(hashes).sort(), [
    "baseline-result.schema.json",
    "challenger-verdict.schema.json",
    "maintainer-proposal.schema.json",
  ]);
  for (const [name, hash] of Object.entries(hashes)) {
    const parsed = JSON.parse(await readFile(join(directory, name), "utf8"));
    assert.equal(parsed.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.doesNotMatch(
      JSON.stringify(parsed),
      /"(?:propertyNames|oneOf)"/,
      `${name} must stay inside the Codex structured-output schema subset`,
    );
    assert.match(hash, /^[a-f0-9]{64}$/);
  }
});

test("generated contracts encode required empty arrays without empty tuple schemas", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-empty-array-schema-"));
  await writeSchemas(root);
  for (const name of [
    "baseline-result.schema.json",
    "maintainer-proposal.schema.json",
    "challenger-verdict.schema.json",
  ]) {
    const document = await readFile(join(root, name), "utf8");
    assert.equal(document.includes('"prefixItems": []'), false);
    assert.equal((JSON.parse(document) as { type?: string }).type, "object");
  }
});
