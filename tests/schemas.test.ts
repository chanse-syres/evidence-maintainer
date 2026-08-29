import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ActionClassSchema,
  AuthorityValiditySchema,
  CaseManifestSchema,
  ChallengerCritiqueSchema,
  DecisionPackageSchema,
  FutureConditionSchema,
  MaintainerProposalSchema,
  MutationOperationSchema,
  PolicyV4Schema,
  RetryPlanSchema,
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

const validDecisionPackage = {
  ...validProposal,
  schemaVersion: 3,
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

test("decision package is the exact shared contract for baseline, maintainer draft, and reviser", () => {
  for (const role of ["baseline", "maintainer", "reviser"] as const) {
    const parsed = DecisionPackageSchema.parse(validDecisionPackage);
    assert.equal(parsed.action, "NO_ACTION", `${role} must use the shared decision contract`);
    assert.equal(parsed.schemaVersion, 3);
  }
});

test("future condition requires values for comparisons and forbids them for EXISTS", () => {
  const selector = {
    sourceId: "official-roster",
    subjectId: "athlete-7",
    kind: null,
    factPath: "facts.status",
  };
  assert.equal(FutureConditionSchema.parse({ selector, operator: "EXISTS", expectedValue: null }).operator, "EXISTS");
  assert.equal(FutureConditionSchema.parse({ selector, operator: "EQUALS", expectedValue: "active" }).operator, "EQUALS");
  assert.throws(() => FutureConditionSchema.parse({ selector, operator: "EQUALS" }));
  assert.throws(() => FutureConditionSchema.parse({ selector, operator: "EXISTS" }));
  assert.throws(() => FutureConditionSchema.parse({ selector, operator: "EXISTS", expectedValue: true }), /does not accept expectedValue/i);
});

test("retry plans use future selectors and keep escalation within the retry budget", () => {
  const plan = {
    notBefore: "2026-08-29T20:00:00.000Z",
    maxAttempts: 3,
    escalateAfterAttempt: 2,
    preserveRecordIds: ["athlete-7"],
    acceptanceConditions: [{
      selector: {
        sourceId: "official-roster",
        subjectId: "athlete-7",
        kind: null,
        factPath: "facts.status",
      },
      operator: "EQUALS",
      expectedValue: "active",
    }],
  };
  assert.equal(RetryPlanSchema.parse(plan).acceptanceConditions.length, 1);
  assert.throws(() => RetryPlanSchema.parse({ ...plan, escalateAfterAttempt: 4 }), /retry budget/i);
});

test("authority validity supports explicit snapshot, supersession, and cutoff-event modes", () => {
  const rules = [
    {
      mode: "SNAPSHOT_MAX_AGE",
      sourceId: "official-roster",
      authorityScope: "status",
      maxAgeMinutes: 60,
    },
    {
      mode: "EFFECTIVE_UNTIL_SUPERSEDED",
      sourceId: "signed-commitments",
      authorityScope: "destination",
      applicabilityFactPath: "facts.applicable",
    },
    {
      mode: "EVENT_AT_CUTOFF",
      sourceId: "transaction-log",
      authorityScope: "membership",
      eventFactPath: "facts.eventType",
    },
  ] as const;
  for (const rule of rules) {
    assert.equal(AuthorityValiditySchema.parse(rule).mode, rule.mode);
  }
  const policy = PolicyV4Schema.parse({
    schemaVersion: 2,
    cutoff: "2026-08-29T19:00:00.000Z",
    authorityByField: { status: "official-roster" },
    authorityValidity: rules,
    retryLimit: 3,
    invariants: ["Stable identity is preserved"],
    rules: ["Evaluate authority using the declared validity mode"],
  });
  assert.equal(policy.authorityValidity.length, 3);
  assert.equal("freshnessWindowMinutes" in policy, false);
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

test("challenger critique is advisory and may accept a draft without findings", () => {
  const critique = ChallengerCritiqueSchema.parse({
    schemaVersion: 2,
    caseId: "noop-duplicate-news",
    recommendation: "ACCEPT_DRAFT",
    evidenceIds: [],
    critiqueCategories: [],
    findings: [],
    summary: "The no-action decision preserves the unique event.",
  });
  assert.equal(critique.recommendation, "ACCEPT_DRAFT");
  assert.throws(() => ChallengerCritiqueSchema.parse({ ...critique, recommendation: "REJECT" }));
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

test("schema generation writes only the two symmetric v4 agent contracts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidence-maintainer-schemas-"));
  const hashes = await writeSchemas(directory);
  assert.deepEqual(Object.keys(hashes).sort(), [
    "challenger-critique.schema.json",
    "decision-package.schema.json",
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
    "decision-package.schema.json",
    "challenger-critique.schema.json",
  ]) {
    const document = await readFile(join(root, name), "utf8");
    assert.equal(document.includes('"prefixItems": []'), false);
    assert.equal((JSON.parse(document) as { type?: string }).type, "object");
  }
});

test("generated contracts require every declared object property", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-strict-object-schema-"));
  await writeSchemas(root);
  for (const name of [
    "decision-package.schema.json",
    "challenger-critique.schema.json",
  ]) {
    const document = JSON.parse(await readFile(join(root, name), "utf8"));
    const missing: string[] = [];
    const visit = (value: unknown, path = "$."): void => {
      if (Array.isArray(value)) {
        value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
        return;
      }
      if (value === null || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (record.type === "object" && record.properties && typeof record.properties === "object") {
        const keys = Object.keys(record.properties);
        const required = Array.isArray(record.required) ? record.required : [];
        for (const key of keys) {
          if (!required.includes(key)) missing.push(`${path}${key}`);
        }
      }
      for (const [key, entry] of Object.entries(record)) visit(entry, `${path}${key}.`);
    };
    visit(document);
    assert.deepEqual(missing, [], `${name} must satisfy strict structured-output object requirements`);
  }
});
