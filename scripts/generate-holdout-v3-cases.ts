import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  json,
  observation,
  policy,
  writeCase,
  type HoldoutDefinition,
} from "./generate-holdout-cases.ts";

const adapterCommand = "node --experimental-strip-types --test adapter.test.ts";

const definitions: HoldoutDefinition[] = [
  {
    id: "update-effective-energy-tariff",
    title: "Metered-energy tariff reconciliation",
    description: "A metered billing window and an effective tariff revision jointly determine the canonical charge.",
    createdFrom: "Synthetic effective-dated utility billing pattern",
    allowedWritePaths: ["input/canonical.json"],
    requiredCommands: [],
    files: {
      "input/canonical.json": json([{
        id: "account-314",
        windowStart: "2026-08-20T00:00:00.000Z",
        windowEnd: "2026-08-21T00:00:00.000Z",
        usageKwh: 18,
        chargeCents: 396,
        tariffRevision: "rev-11",
        status: "open",
      }]),
      "input/observations.json": json([
        observation({
          id: "obs-meter-window-314",
          sourceId: "official-meter-ledger",
          observedAt: "2026-08-28T16:02:00.000Z",
          effectiveAt: "2026-08-21T00:00:00.000Z",
          authorityScope: ["usage-kwh", "billing-window"],
          subjectId: "account-314",
          kind: "settled-meter-window",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "meter-window-v3",
          facts: {
            windowStart: "2026-08-20T00:00:00.000Z",
            windowEnd: "2026-08-21T00:00:00.000Z",
            usageKwh: 26.5,
            settlementState: "final",
          },
        }),
        observation({
          id: "obs-tariff-rev-12",
          sourceId: "official-tariff-register",
          observedAt: "2026-08-18T09:00:00.000Z",
          effectiveAt: "2026-08-19T00:00:00.000Z",
          authorityScope: ["energy-rate", "tariff-revision"],
          subjectId: "residential-standard",
          kind: "signed-tariff",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "tiered-tariff-v2",
          facts: {
            revision: "rev-12",
            baseChargeCents: 120,
            firstTierLimitKwh: 20,
            firstTierCentsPerKwh: 14,
            excessTierCentsPerKwh: 22,
            signatureValid: true,
          },
        }),
      ]),
      "input/policy.json": json(policy({
        cutoff: "2026-08-28T23:00:00.000Z",
        authorityByField: {
          usageKwh: "official-meter-ledger",
          chargeCents: "official-meter-ledger+official-tariff-register",
          tariffRevision: "official-tariff-register",
        },
        invariants: [
          "Billing identity, window, and status remain unchanged",
          "Only a final meter settlement and a signed tariff effective at the window start may control the charge",
        ],
        rules: [
          "Use the latest signed tariff whose effective time is at or before the billing-window start",
          "Charge cents equal base charge plus the first-tier usage times its rate plus excess usage times its rate, rounded to the nearest cent",
        ],
      })),
    },
    oracle: {
      expectedAction: "UPDATE_DATA",
      requiredEvidenceIds: ["obs-meter-window-314", "obs-tariff-rev-12"],
      evidenceAssessmentBundles: [[
        { evidenceId: "obs-meter-window-314", factPath: "facts.usageKwh", disposition: "SUPPORT", reason: "The final meter window supplies settled usage." },
        { evidenceId: "obs-meter-window-314", factPath: "facts.settlementState", disposition: "SUPPORT", reason: "Only final settlement may update the bill." },
        { evidenceId: "obs-tariff-rev-12", factPath: "effectiveAt", disposition: "SUPPORT", reason: "The tariff is effective before the billing window begins." },
        { evidenceId: "obs-tariff-rev-12", factPath: "facts.revision", disposition: "SUPPORT", reason: "The signed revision identifies the applied tariff." },
        { evidenceId: "obs-tariff-rev-12", factPath: "facts.signatureValid", disposition: "SUPPORT", reason: "A signed tariff is required." },
      ]],
      allowedEvidenceAssessments: [
        { evidenceId: "obs-meter-window-314", factPath: "facts.usageKwh", disposition: "SUPPORT", reason: "The final meter window supplies settled usage." },
        { evidenceId: "obs-meter-window-314", factPath: "facts.settlementState", disposition: "SUPPORT", reason: "Only final settlement may update the bill." },
        { evidenceId: "obs-tariff-rev-12", factPath: "effectiveAt", disposition: "SUPPORT", reason: "The tariff is effective before the billing window begins." },
        { evidenceId: "obs-tariff-rev-12", factPath: "facts.revision", disposition: "SUPPORT", reason: "The signed revision identifies the applied tariff." },
        { evidenceId: "obs-tariff-rev-12", factPath: "facts.signatureValid", disposition: "SUPPORT", reason: "A signed tariff is required." },
      ],
      allowedChangedFiles: ["input/canonical.json"],
      expectedRecords: [{
        file: "input/canonical.json",
        recordId: "account-314",
        fields: {
          usageKwh: 26.5,
          chargeCents: 543,
          tariffRevision: "rev-12",
        },
      }],
      requiredChallengerVerdict: "CONFIRM",
    },
  },
  {
    id: "repair-generation-bound-pagination",
    title: "Generation-bound pagination repair",
    description: "An adapter must materialize one complete snapshot when a paginated source rolls generations between requests.",
    createdFrom: "Synthetic generation-bound cursor pagination pattern",
    allowedWritePaths: ["adapter.ts"],
    requiredCommands: [adapterCommand],
    files: {
      "input/canonical.json": json([]),
      "input/observations.json": json([observation({
        id: "obs-generation-cursor-contract",
        sourceId: "official-catalog-api",
        observedAt: "2026-08-28T18:00:00.000Z",
        authorityScope: ["pagination-contract", "snapshot-generation"],
        kind: "schema-contract",
        status: 200,
        contentType: "application/json",
        schemaFingerprint: "generation-cursor-v4",
        facts: {
          requestCursorField: "requestCursor",
          responseCursorField: "nextCursor",
          generationField: "generation",
          restartMarker: null,
        },
      })]),
      "input/policy.json": json(policy({
        invariants: [
          "Records from different generations are never combined",
          "Record order follows the selected page chain",
          "A trailing incomplete generation is not silently published",
        ],
        rules: [
          "A complete chain begins at a null request cursor, retains one generation, links each next cursor to the following request cursor, and ends at a null next cursor",
          "Select the last complete chain in the captured sequence; reject the capture if a newer chain begins but does not complete",
        ],
      })),
      "adapter.ts": `export interface CatalogRecord { id: string; value: number }
export interface CatalogPage {
  generation: number;
  requestCursor: string | null;
  nextCursor: string | null;
  records: CatalogRecord[];
}

export function materializeSnapshot(pages: CatalogPage[]): CatalogRecord[] {
  const records = new Map<string, CatalogRecord>();
  for (const page of pages) {
    for (const record of page.records) records.set(record.id, record);
  }
  return [...records.values()];
}
`,
      "adapter.test.ts": `import assert from "node:assert/strict";
import test from "node:test";
import { materializeSnapshot } from "./adapter.ts";

test("materializes one stable generation", () => {
  assert.deepEqual(materializeSnapshot([
    { generation: 7, requestCursor: null, nextCursor: "c1", records: [{ id: "a", value: 1 }] },
    { generation: 7, requestCursor: "c1", nextCursor: null, records: [{ id: "b", value: 2 }] },
  ]), [{ id: "a", value: 1 }, { id: "b", value: 2 }]);
});

test("discards an abandoned generation after an explicit restart", () => {
  assert.deepEqual(materializeSnapshot([
    { generation: 8, requestCursor: null, nextCursor: "old-1", records: [{ id: "old", value: 8 }] },
    { generation: 9, requestCursor: null, nextCursor: "new-1", records: [{ id: "new-a", value: 9 }] },
    { generation: 9, requestCursor: "new-1", nextCursor: null, records: [{ id: "new-b", value: 10 }] },
  ]), [{ id: "new-a", value: 9 }, { id: "new-b", value: 10 }]);
});
`,
    },
    verifierFiles: {
      "hidden-probes.json": json({
        schemaVersion: 1,
        exportName: "materializeSnapshot",
        cases: [
          {
            id: "unseen-three-page-restart",
            args: [[
              { generation: 14, requestCursor: null, nextCursor: "stale", records: [{ id: "stale", value: 1 }] },
              { generation: 15, requestCursor: null, nextCursor: "p1", records: [{ id: "x", value: 2 }] },
              { generation: 15, requestCursor: "p1", nextCursor: "p2", records: [{ id: "y", value: 3 }] },
              { generation: 15, requestCursor: "p2", nextCursor: null, records: [{ id: "z", value: 4 }] },
            ]],
            expected: [{ id: "x", value: 2 }, { id: "y", value: 3 }, { id: "z", value: 4 }],
          },
        ],
      }),
    },
    oracle: {
      expectedAction: "REPAIR_ADAPTER",
      requiredEvidenceIds: ["obs-generation-cursor-contract"],
      evidenceAssessmentBundles: [[
        { evidenceId: "obs-generation-cursor-contract", factPath: "facts.requestCursorField", disposition: "SUPPORT", reason: "The request cursor marks chain boundaries." },
        { evidenceId: "obs-generation-cursor-contract", factPath: "facts.responseCursorField", disposition: "SUPPORT", reason: "The response cursor links adjacent pages." },
        { evidenceId: "obs-generation-cursor-contract", factPath: "facts.generationField", disposition: "SUPPORT", reason: "Generation identity prevents mixed snapshots." },
      ]],
      allowedEvidenceAssessments: [
        { evidenceId: "obs-generation-cursor-contract", factPath: "facts.requestCursorField", disposition: "SUPPORT", reason: "The request cursor marks chain boundaries." },
        { evidenceId: "obs-generation-cursor-contract", factPath: "facts.responseCursorField", disposition: "SUPPORT", reason: "The response cursor links adjacent pages." },
        { evidenceId: "obs-generation-cursor-contract", factPath: "facts.generationField", disposition: "SUPPORT", reason: "Generation identity prevents mixed snapshots." },
      ],
      allowedChangedFiles: ["adapter.ts"],
      expectedRecords: [],
      requiredChallengerVerdict: "CONFIRM",
      expectedCommandExitCodes: { [adapterCommand]: 0 },
      hiddenProbePath: "verifier/hidden-probes.json",
    },
  },
  {
    id: "retry-shard-watermark-barrier",
    title: "Sharded index publication barrier",
    description: "A signed index manifest and two shard watermarks disagree inside the allowed publication window.",
    createdFrom: "Synthetic multi-shard atomic publication pattern",
    allowedWritePaths: [],
    requiredCommands: [],
    files: {
      "input/canonical.json": json([{
        id: "search-index",
        generation: 204,
        shardWatermarks: { east: 40, west: 76 },
        status: "active",
      }]),
      "input/observations.json": json([
        observation({
          id: "obs-index-manifest-205",
          sourceId: "official-index-manifest",
          observedAt: "2026-08-28T17:02:00.000Z",
          authorityScope: ["index-generation", "shard-watermarks"],
          subjectId: "search-index",
          kind: "signed-manifest",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "index-manifest-v5",
          facts: { generation: 205, eastWatermark: 41, westWatermark: 77, signatureValid: true },
        }),
        observation({
          id: "obs-east-shard-205",
          sourceId: "official-east-shard",
          observedAt: "2026-08-28T17:03:00.000Z",
          authorityScope: ["east-shard"],
          subjectId: "search-index",
          kind: "shard-status",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "shard-status-v2",
          facts: { generation: 205, watermark: 41, complete: true },
        }),
        observation({
          id: "obs-west-shard-204",
          sourceId: "official-west-shard",
          observedAt: "2026-08-28T17:04:00.000Z",
          authorityScope: ["west-shard"],
          subjectId: "search-index",
          kind: "shard-status",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "shard-status-v2",
          facts: { generation: 204, watermark: 76, complete: true },
        }),
      ]),
      "input/policy.json": json(policy({
        cutoff: "2026-08-28T17:06:00.000Z",
        freshnessWindowMinutes: 20,
        retryLimit: 3,
        invariants: [
          "A manifest and all shards publish atomically at one generation",
          "Generation 204 remains available until every generation-205 shard agrees with the manifest",
        ],
        rules: [
          "Manifest generation and each shard generation and watermark must agree before publication",
          "Inside the publication window, retry eight minutes after the latest relevant observation and escalate after three attempts",
        ],
      })),
    },
    oracle: {
      expectedAction: "RETRY_LATER",
      requiredEvidenceIds: ["obs-index-manifest-205", "obs-east-shard-205", "obs-west-shard-204"],
      evidenceAssessmentBundles: [[
        { evidenceId: "obs-index-manifest-205", factPath: "facts.generation", disposition: "SUPPORT", reason: "The manifest declares the candidate generation." },
        { evidenceId: "obs-east-shard-205", factPath: "facts.generation", disposition: "SUPPORT", reason: "The east shard has reached the candidate generation." },
        { evidenceId: "obs-west-shard-204", factPath: "facts.generation", disposition: "SUPPORT", reason: "The west shard remains one generation behind." },
      ]],
      allowedEvidenceAssessments: [
        { evidenceId: "obs-index-manifest-205", factPath: "facts.generation", disposition: "SUPPORT", reason: "The manifest declares the candidate generation." },
        { evidenceId: "obs-east-shard-205", factPath: "facts.generation", disposition: "SUPPORT", reason: "The east shard has reached the candidate generation." },
        { evidenceId: "obs-west-shard-204", factPath: "facts.generation", disposition: "SUPPORT", reason: "The west shard remains one generation behind." },
      ],
      allowedChangedFiles: [],
      expectedRecords: [],
      requiredChallengerVerdict: "CONFIRM",
      expectedRetryPlan: {
        notBefore: "2026-08-28T17:12:00.000Z",
        maxAttempts: 3,
        escalateAfterAttempt: 3,
        preserveRecordIds: ["search-index"],
        agreementChecks: [
          {
            leftEvidenceId: "obs-index-manifest-205",
            leftFactPath: "facts.generation",
            rightEvidenceId: "obs-east-shard-205",
            rightFactPath: "facts.generation",
          },
          {
            leftEvidenceId: "obs-index-manifest-205",
            leftFactPath: "facts.generation",
            rightEvidenceId: "obs-west-shard-204",
            rightFactPath: "facts.generation",
          },
          {
            leftEvidenceId: "obs-index-manifest-205",
            leftFactPath: "facts.eastWatermark",
            rightEvidenceId: "obs-east-shard-205",
            rightFactPath: "facts.watermark",
          },
          {
            leftEvidenceId: "obs-index-manifest-205",
            leftFactPath: "facts.westWatermark",
            rightEvidenceId: "obs-west-shard-204",
            rightFactPath: "facts.watermark",
          },
        ],
        valueChecks: [
          { evidenceId: "obs-index-manifest-205", factPath: "facts.signatureValid", expectedValue: true },
          { evidenceId: "obs-east-shard-205", factPath: "facts.complete", expectedValue: true },
          { evidenceId: "obs-west-shard-204", factPath: "facts.complete", expectedValue: true },
        ],
      },
    },
  },
  {
    id: "noop-future-effective-correction",
    title: "Future-effective levy revision",
    description: "A newer official levy revision is published before the cutoff but does not become effective until afterward.",
    createdFrom: "Synthetic bitemporal policy materialization pattern",
    allowedWritePaths: [],
    requiredCommands: [],
    files: {
      "input/canonical.json": json([{
        id: "district-levy-9",
        rate: 0.012,
        materializedRevision: "rev-18",
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        status: "active",
      }]),
      "input/observations.json": json([
        observation({
          id: "obs-levy-rev-18",
          sourceId: "official-levy-register",
          observedAt: "2026-08-01T08:00:00.000Z",
          effectiveAt: "2026-08-01T00:00:00.000Z",
          authorityScope: ["levy-rate", "revision"],
          subjectId: "district-levy-9",
          kind: "signed-revision",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "levy-revision-v2",
          facts: { revision: "rev-18", rate: 0.012, signatureValid: true },
        }),
        observation({
          id: "obs-levy-rev-19",
          sourceId: "official-levy-register",
          observedAt: "2026-08-29T16:00:00.000Z",
          effectiveAt: "2026-09-01T00:00:00.000Z",
          authorityScope: ["levy-rate", "revision"],
          subjectId: "district-levy-9",
          kind: "signed-revision",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "levy-revision-v2",
          facts: { revision: "rev-19", rate: 0.014, signatureValid: true },
        }),
      ]),
      "input/policy.json": json(policy({
        cutoff: "2026-08-29T23:00:00.000Z",
        authorityByField: {
          rate: "official-levy-register",
          materializedRevision: "official-levy-register",
          effectiveFrom: "official-levy-register",
        },
        invariants: [
          "Canonical state represents the authoritative revision effective at the cutoff",
          "Publication time never substitutes for effective time",
        ],
        rules: [
          "Choose the latest signed revision with effectiveAt at or before the cutoff",
          "Do not write when that effective revision already matches canonical state",
        ],
      })),
    },
    oracle: {
      expectedAction: "NO_ACTION",
      requiredEvidenceIds: ["obs-levy-rev-18", "obs-levy-rev-19"],
      evidenceAssessmentBundles: [[
        { evidenceId: "obs-levy-rev-18", factPath: "effectiveAt", disposition: "SUPPORT", reason: "Revision 18 is effective at the cutoff." },
        { evidenceId: "obs-levy-rev-18", factPath: "facts.rate", disposition: "SUPPORT", reason: "The effective rate matches canonical state." },
        { evidenceId: "obs-levy-rev-19", factPath: "effectiveAt", disposition: "REJECT", reason: "Revision 19 is future-effective and cannot control the cutoff snapshot." },
      ]],
      allowedEvidenceAssessments: [
        { evidenceId: "obs-levy-rev-18", factPath: "effectiveAt", disposition: "SUPPORT", reason: "Revision 18 is effective at the cutoff." },
        { evidenceId: "obs-levy-rev-18", factPath: "facts.rate", disposition: "SUPPORT", reason: "The effective rate matches canonical state." },
        { evidenceId: "obs-levy-rev-19", factPath: "effectiveAt", disposition: "REJECT", reason: "Revision 19 is future-effective and cannot control the cutoff snapshot." },
      ],
      allowedChangedFiles: [],
      expectedRecords: [],
      requiredChallengerVerdict: "CONFIRM",
    },
  },
  {
    id: "review-reused-supplier-identity",
    title: "Reused supplier-name attribution",
    description: "An award names a supplier whose trading name is shared by a dissolved entity and its successor.",
    createdFrom: "Synthetic legal-entity occurrence identity pattern",
    allowedWritePaths: [],
    requiredCommands: [],
    files: {
      "input/canonical.json": json([{
        id: "award-882",
        supplierName: "Harbor Analytics",
        supplierLegalEntityId: null,
        supplierJurisdiction: null,
        status: "pending-attribution",
      }]),
      "input/observations.json": json([
        observation({
          id: "obs-award-882",
          sourceId: "official-award-register",
          observedAt: "2026-08-28T15:00:00.000Z",
          effectiveAt: "2026-08-28T14:30:00.000Z",
          authorityScope: ["award", "supplier-reference"],
          subjectId: "award-882",
          kind: "signed-award",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "award-v3",
          facts: {
            supplierName: "Harbor Analytics",
            supplierRegistrationId: null,
            supplierJurisdiction: null,
            signatureValid: true,
          },
        }),
        observation({
          id: "obs-harbor-old",
          sourceId: "official-business-register",
          observedAt: "2026-08-28T12:00:00.000Z",
          authorityScope: ["legal-entity-identity"],
          subjectId: "entity-old-44",
          kind: "entity-record",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "entity-record-v5",
          facts: {
            tradingName: "Harbor Analytics",
            registrationId: "OR-4401",
            jurisdiction: "OR",
            entityStatus: "dissolved",
            dissolvedAt: "2026-07-31T00:00:00.000Z",
          },
        }),
        observation({
          id: "obs-harbor-new",
          sourceId: "official-business-register",
          observedAt: "2026-08-28T12:01:00.000Z",
          authorityScope: ["legal-entity-identity"],
          subjectId: "entity-new-91",
          kind: "entity-record",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "entity-record-v5",
          facts: {
            tradingName: "Harbor Analytics",
            registrationId: "WA-9107",
            jurisdiction: "WA",
            entityStatus: "active",
            formedAt: "2026-08-01T00:00:00.000Z",
          },
        }),
      ]),
      "input/policy.json": json(policy({
        authorityByField: {
          supplierLegalEntityId: "official-award-register+official-business-register",
          supplierJurisdiction: "official-award-register+official-business-register",
        },
        invariants: [
          "A trading name is not a legal-entity identifier",
          "A dissolved entity and a successor remain distinct occurrences even when names match",
        ],
        rules: [
          "Attribute an award only when its supplier registration and jurisdiction bind exactly one registry occurrence",
          "Request the missing binding fields when multiple occurrences share the supplied name",
        ],
      })),
    },
    oracle: {
      expectedAction: "HUMAN_REVIEW",
      requiredEvidenceIds: ["obs-award-882", "obs-harbor-old", "obs-harbor-new"],
      evidenceAssessmentBundles: [[
        { evidenceId: "obs-award-882", factPath: "facts.supplierRegistrationId", disposition: "CONTEXT", reason: "The award omits the registration needed for occurrence binding." },
        { evidenceId: "obs-harbor-old", factPath: "facts.registrationId", disposition: "CONTEXT", reason: "One historical entity owns the shared trading name." },
        { evidenceId: "obs-harbor-new", factPath: "facts.registrationId", disposition: "CONTEXT", reason: "A distinct active entity also owns the shared trading name." },
      ]],
      allowedEvidenceAssessments: [
        { evidenceId: "obs-award-882", factPath: "facts.supplierRegistrationId", disposition: "CONTEXT", reason: "The award omits the registration needed for occurrence binding." },
        { evidenceId: "obs-harbor-old", factPath: "facts.registrationId", disposition: "CONTEXT", reason: "One historical entity owns the shared trading name." },
        { evidenceId: "obs-harbor-new", factPath: "facts.registrationId", disposition: "CONTEXT", reason: "A distinct active entity also owns the shared trading name." },
      ],
      allowedChangedFiles: [],
      expectedRecords: [],
      requiredChallengerVerdict: "CONFIRM",
      acceptableReviewRequests: [{
        subjectId: "award-882",
        targetEvidenceId: "obs-award-882",
        requestedFactPaths: ["facts.supplierJurisdiction", "facts.supplierRegistrationId"],
      }],
    },
  },
];

export const HOLDOUT_V3_CASE_IDS = definitions.map((definition) => definition.id) as readonly string[];

export async function generateHoldoutV3Cases(
  root = resolve("holdout", "v3", "cases"),
): Promise<string[]> {
  for (const definition of definitions) await writeCase(root, definition);
  return [...HOLDOUT_V3_CASE_IDS];
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const ids = await generateHoldoutV3Cases();
  process.stdout.write(`Generated ${ids.length} holdout-v3 cases:\n${ids.join("\n")}\n`);
}
