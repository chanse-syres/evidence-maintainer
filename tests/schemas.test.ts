import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ActionClassSchema,
  ChallengerVerdictSchema,
  MaintainerProposalSchema,
  MutationOperationSchema,
} from "../src/core/schemas.ts";
import { canonicalJson, sha256Json } from "../src/core/canonical-json.ts";
import { writeSchemas } from "../scripts/generate-schemas.ts";

const validProposal = {
  schemaVersion: 1,
  caseId: "noop-duplicate-news",
  action: "NO_ACTION",
  firstMaterialDivergence: "obs-2 duplicates event evt-1",
  failureOwner: "source-observation",
  evidenceUsed: ["obs-1", "obs-2"],
  evidenceRejected: [],
  affectedEntities: ["athlete-7"],
  affectedFiles: [],
  operations: [],
  preservedInvariants: ["canonical event IDs remain unique"],
  unresolvedUncertainty: [],
  minimumInformationRequest: [],
  retryCondition: null,
  approvalLevel: "SIMULATED_HUMAN",
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
  assert.throws(() => MaintainerProposalSchema.parse({ ...validProposal, evidenceUsed: [] }));
});

test("mutation operations reject traversal and accept bounded repair operations", () => {
  assert.equal(
    MutationOperationSchema.parse({
      kind: "SET_RECORD_FIELDS",
      file: "input/canonical.json",
      recordId: "athlete-11",
      fields: { status: "committed" },
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
    assert.match(hash, /^[a-f0-9]{64}$/);
  }
});
