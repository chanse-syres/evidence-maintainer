import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256Text } from "../src/core/canonical-json.ts";
import {
  CaseOracleV4Schema,
  PolicyV4Schema,
  type AuthorityValidity,
  type CaseOracleV4,
} from "../src/core/schemas.ts";
import { json, observation } from "./generate-holdout-cases.ts";

const capturedAt = "2026-08-29T20:00:00.000Z";
const adapterCommand = "node --experimental-strip-types --test adapter.test.ts";
const releaseDigest = "89f0c287c01ca7af66eeb8197089dfe1484f544d5e93f4982df8a9fd46fc3189";

interface HoldoutV4Definition {
  id: string;
  title: string;
  description: string;
  createdFrom: string;
  allowedWritePaths: string[];
  requiredCommands: string[];
  files: Record<string, string>;
  verifierFiles?: Record<string, string>;
  oracle: CaseOracleV4;
}

function policyV4(input: {
  cutoff?: string;
  authorityByField?: Record<string, string>;
  authorityValidity: AuthorityValidity[];
  retryLimit?: number;
  invariants: string[];
  rules: string[];
}) {
  return PolicyV4Schema.parse({
    schemaVersion: 2,
    cutoff: input.cutoff ?? "2026-08-29T20:00:00.000Z",
    authorityByField: input.authorityByField ?? {},
    authorityValidity: input.authorityValidity,
    retryLimit: input.retryLimit ?? 3,
    invariants: input.invariants,
    rules: input.rules,
  });
}

function baseOracle(input: {
  caseId: string;
  requiredEvidenceSourceBundles: string[][];
  allowedChangedFiles?: string[];
  expectedCommandExitCodes?: Record<string, number>;
  hiddenProbePath?: string | null;
}) {
  return {
    schemaVersion: 3 as const,
    caseId: input.caseId,
    requiredEvidenceSourceBundles: input.requiredEvidenceSourceBundles,
    forbiddenEvidenceClaims: [],
    allowedChangedFiles: input.allowedChangedFiles ?? [],
    expectedCommandExitCodes: input.expectedCommandExitCodes ?? {},
    hiddenProbePath: input.hiddenProbePath ?? null,
  };
}

function manifestObservation(id: string, observedAt: string, signatureValid = true) {
  return observation({
    id,
    sourceId: "official-release-manifest",
    observedAt,
    effectiveAt: observedAt,
    authorityScope: ["release-manifest"],
    subjectId: "release-42",
    kind: "signed-manifest",
    status: 200,
    contentType: "application/json",
    schemaFingerprint: "release-manifest-v5",
    facts: {
      generation: 42,
      digest: releaseDigest,
      signatureValid,
      expectedReplicas: ["east", "west"],
    },
  });
}

function replicaObservation(input: {
  id: string;
  sourceId: "official-replica-east" | "official-replica-west";
  observedAt: string;
  generation?: number;
  digest?: string;
  complete?: boolean;
}) {
  return observation({
    id: input.id,
    sourceId: input.sourceId,
    observedAt: input.observedAt,
    effectiveAt: input.observedAt,
    authorityScope: ["replica-confirmation"],
    subjectId: "release-42",
    kind: "replica-confirmation",
    status: 200,
    contentType: "application/json",
    schemaFingerprint: "replica-confirmation-v3",
    facts: {
      generation: input.generation ?? 42,
      digest: input.digest ?? releaseDigest,
      complete: input.complete ?? true,
    },
  });
}

function futureCondition(
  sourceId: string,
  kind: string,
  factPath: string,
  expectedValue: string | number | boolean,
) {
  return {
    selector: { sourceId, subjectId: "release-42", kind, factPath },
    operator: "EQUALS" as const,
    expectedValue,
  };
}

const definitions: HoldoutV4Definition[] = [
  {
    id: "update-bitemporal-assay-calibration",
    title: "Bitemporal assay calibration reconciliation",
    description: "A final assay must be recomputed with the signed calibration that governed its exact instrument occurrence when the measurement was taken.",
    createdFrom: "Synthetic bitemporal laboratory calibration pattern",
    allowedWritePaths: ["input/canonical.json"],
    requiredCommands: [],
    files: {
      "input/canonical.json": json([{
        id: "assay-440",
        sampleId: "sample-220",
        sampleClass: "serum",
        instrumentId: "spectrometer-a",
        instrumentOccurrenceId: "spectrometer-a-module-2026-04",
        measuredAt: "2026-08-29T19:20:00.000Z",
        rawSignal: 742,
        normalizedConcentration: 70,
        calibrationRevision: "cal-16",
        unit: "mg/L",
        status: "final",
      }]),
      "input/observations.json": json([
        observation({
          id: "obs-assay-440",
          sourceId: "official-assay-ledger",
          observedAt: "2026-08-29T19:22:00.000Z",
          effectiveAt: "2026-08-29T19:20:00.000Z",
          authorityScope: ["assay-measurement", "sample-class", "instrument-occurrence"],
          subjectId: "assay-440",
          kind: "final-assay",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "final-assay-v4",
          facts: {
            sampleId: "sample-220",
            sampleClass: "serum",
            instrumentId: "spectrometer-a",
            instrumentOccurrenceId: "spectrometer-a-module-2026-04",
            measuredAt: "2026-08-29T19:20:00.000Z",
            rawSignal: 742,
            status: "final",
          },
        }),
        observation({
          id: "obs-calibration-cal-16",
          sourceId: "official-calibration-registry",
          observedAt: "2026-08-01T08:05:00.000Z",
          effectiveAt: "2026-08-01T08:00:00.000Z",
          authorityScope: ["calibration-revision"],
          subjectId: "spectrometer-a-module-2026-04",
          kind: "signed-calibration",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "calibration-v6",
          facts: {
            revision: "cal-16",
            blankOffset: 42,
            scale: 0.1,
            eligibleSampleClasses: ["serum"],
            signatureValid: true,
          },
        }),
        observation({
          id: "obs-calibration-cal-17",
          sourceId: "official-calibration-registry",
          observedAt: "2026-08-29T19:05:00.000Z",
          effectiveAt: "2026-08-29T19:00:00.000Z",
          authorityScope: ["calibration-revision"],
          subjectId: "spectrometer-a-module-2026-04",
          kind: "signed-calibration",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "calibration-v6",
          facts: {
            revision: "cal-17",
            blankOffset: 12,
            scale: 0.1,
            eligibleSampleClasses: ["serum"],
            signatureValid: true,
          },
        }),
        observation({
          id: "obs-calibration-cal-18",
          sourceId: "official-calibration-registry",
          observedAt: "2026-08-29T19:25:00.000Z",
          effectiveAt: "2026-08-29T20:10:00.000Z",
          authorityScope: ["calibration-revision"],
          subjectId: "spectrometer-a-module-2026-04",
          kind: "signed-calibration",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "calibration-v6",
          facts: {
            revision: "cal-18",
            blankOffset: 10,
            scale: 0.12,
            eligibleSampleClasses: ["serum"],
            signatureValid: true,
          },
        }),
      ]),
      "input/policy.json": json(policyV4({
        authorityByField: {
          normalizedConcentration: "official-assay-ledger+official-calibration-registry",
          calibrationRevision: "official-calibration-registry",
        },
        authorityValidity: [
          {
            mode: "SNAPSHOT_MAX_AGE",
            sourceId: "official-assay-ledger",
            authorityScope: "assay-measurement",
            maxAgeMinutes: 60,
          },
          {
            mode: "EFFECTIVE_UNTIL_SUPERSEDED",
            sourceId: "official-calibration-registry",
            authorityScope: "calibration-revision",
            applicabilityFactPath: "facts.revision",
          },
        ],
        invariants: [
          "Assay, sample, instrument-occurrence, measurement-time, raw-signal, unit, and final-status identity remain unchanged",
          "A calibration belongs only to its exact instrument occurrence and declared sample class",
          "A later-published or future-effective calibration never rewrites an earlier measurement",
        ],
        rules: [
          "Use the latest signed calibration for the exact instrument occurrence and sample class whose effectiveAt is at or before measuredAt",
          "Normalized concentration equals (rawSignal minus blankOffset) times scale",
          "Store the controlling calibration revision together with the normalized concentration",
        ],
      })),
    },
    oracle: CaseOracleV4Schema.parse({
      ...baseOracle({
        caseId: "update-bitemporal-assay-calibration",
        requiredEvidenceSourceBundles: [[
          "official-assay-ledger",
          "official-calibration-registry",
        ]],
        allowedChangedFiles: ["input/canonical.json"],
      }),
      expectedAction: "UPDATE_DATA",
      requiredRecordProperties: [{
        file: "input/canonical.json",
        recordId: "assay-440",
        properties: {
          normalizedConcentration: 73,
          calibrationRevision: "cal-17",
        },
      }],
      preservedRecordProperties: [{
        file: "input/canonical.json",
        recordId: "assay-440",
        propertyPaths: [
          "id",
          "sampleId",
          "sampleClass",
          "instrumentId",
          "instrumentOccurrenceId",
          "measuredAt",
          "rawSignal",
          "unit",
          "status",
        ],
      }],
    }),
  },
  {
    id: "repair-epoch-delta-materialization",
    title: "Epoch-scoped delta materialization repair",
    description: "A delta adapter must choose one complete epoch and apply its ordered key operations without leaking state across resets.",
    createdFrom: "Synthetic generation-scoped event materialization pattern",
    allowedWritePaths: ["adapter.ts"],
    requiredCommands: [adapterCommand],
    files: {
      "input/canonical.json": json([]),
      "input/observations.json": json([observation({
        id: "obs-epoch-delta-contract",
        sourceId: "official-delta-stream-contract",
        observedAt: "2026-08-29T19:45:00.000Z",
        effectiveAt: "2026-08-29T19:40:00.000Z",
        authorityScope: ["delta-stream-contract"],
        subjectId: "inventory-projection",
        kind: "signed-schema-contract",
        status: 200,
        contentType: "application/json",
        schemaFingerprint: "epoch-delta-v3",
        facts: {
          epochField: "epoch",
          sequenceField: "sequence",
          beginKind: "BEGIN",
          commitKind: "COMMIT",
          mutationKinds: ["UPSERT", "DELETE"],
          outputOrder: "key-ascending",
        },
      })]),
      "input/policy.json": json(policyV4({
        authorityValidity: [{
          mode: "SNAPSHOT_MAX_AGE",
          sourceId: "official-delta-stream-contract",
          authorityScope: "delta-stream-contract",
          maxAgeMinutes: 60,
        }],
        invariants: [
          "State from different epochs is never combined",
          "Only one complete valid epoch is materialized",
          "Deletes and later key reuse are interpreted inside the selected epoch",
          "Output is sorted by key",
        ],
        rules: [
          "An epoch is complete and valid only when its events form one unique contiguous sequence beginning with BEGIN at sequence zero and ending with COMMIT",
          "Choose the numerically greatest complete valid epoch and ignore incomplete or invalid epochs",
          "Apply the selected epoch in sequence order from an empty state; UPSERT sets a key and DELETE removes it",
          "Throw when no complete valid epoch exists",
        ],
      })),
      "adapter.ts": [
        "export interface DeltaEvent {",
        "  epoch: number;",
        "  sequence: number;",
        "  kind: \"BEGIN\" | \"UPSERT\" | \"DELETE\" | \"COMMIT\";",
        "  key?: string;",
        "  value?: number;",
        "}",
        "",
        "export function materializeEpoch(events: DeltaEvent[]): Array<{ key: string; value: number }> {",
        "  const state = new Map<string, number>();",
        "  for (const event of events) {",
        "    if (event.kind === \"UPSERT\" && event.key !== undefined && event.value !== undefined) {",
        "      state.set(event.key, event.value);",
        "    } else if (event.kind === \"DELETE\" && event.key !== undefined) {",
        "      state.delete(event.key);",
        "    }",
        "  }",
        "  return [...state].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => ({ key, value }));",
        "}",
        "",
      ].join("\n"),
      "adapter.test.ts": [
        "import assert from \"node:assert/strict\";",
        "import test from \"node:test\";",
        "import { materializeEpoch } from \"./adapter.ts\";",
        "",
        "test(\"materializes one complete epoch\", () => {",
        "  assert.deepEqual(materializeEpoch([",
        "    { epoch: 1, sequence: 0, kind: \"BEGIN\" },",
        "    { epoch: 1, sequence: 1, kind: \"UPSERT\", key: \"a\", value: 1 },",
        "    { epoch: 1, sequence: 2, kind: \"COMMIT\" },",
        "  ]), [{ key: \"a\", value: 1 }]);",
        "});",
        "",
        "test(\"isolates and orders the greatest complete epoch\", () => {",
        "  assert.deepEqual(materializeEpoch([",
        "    { epoch: 4, sequence: 0, kind: \"BEGIN\" },",
        "    { epoch: 4, sequence: 1, kind: \"UPSERT\", key: \"shared\", value: 4 },",
        "    { epoch: 4, sequence: 2, kind: \"UPSERT\", key: \"old\", value: 8 },",
        "    { epoch: 4, sequence: 3, kind: \"COMMIT\" },",
        "    { epoch: 5, sequence: 0, kind: \"BEGIN\" },",
        "    { epoch: 5, sequence: 2, kind: \"DELETE\", key: \"shared\" },",
        "    { epoch: 5, sequence: 1, kind: \"UPSERT\", key: \"shared\", value: 9 },",
        "    { epoch: 5, sequence: 3, kind: \"UPSERT\", key: \"current\", value: 10 },",
        "    { epoch: 5, sequence: 4, kind: \"COMMIT\" },",
        "  ]), [{ key: \"current\", value: 10 }]);",
        "});",
        "",
        "test(\"throws when no complete valid epoch exists\", () => {",
        "  assert.throws(() => materializeEpoch([",
        "    { epoch: 6, sequence: 0, kind: \"BEGIN\" },",
        "    { epoch: 6, sequence: 1, kind: \"UPSERT\", key: \"partial\", value: 6 },",
        "  ]), /No complete valid epoch/);",
        "});",
        "",
      ].join("\n"),
    },
    verifierFiles: {
      "hidden-probes.json": json({
        schemaVersion: 1,
        exportName: "materializeEpoch",
        cases: [
          {
            id: "falls-back-from-incomplete-higher-epoch",
            args: [[
              { epoch: 8, sequence: 0, kind: "BEGIN" },
              { epoch: 8, sequence: 1, kind: "UPSERT", key: "stable", value: 8 },
              { epoch: 8, sequence: 2, kind: "COMMIT" },
              { epoch: 9, sequence: 0, kind: "BEGIN" },
              { epoch: 9, sequence: 1, kind: "UPSERT", key: "partial", value: 9 },
            ]],
            expected: [{ key: "stable", value: 8 }],
          },
          {
            id: "rejects-duplicate-sequence-in-higher-epoch",
            args: [[
              { epoch: 10, sequence: 0, kind: "BEGIN" },
              { epoch: 10, sequence: 1, kind: "UPSERT", key: "fallback", value: 10 },
              { epoch: 10, sequence: 2, kind: "COMMIT" },
              { epoch: 11, sequence: 0, kind: "BEGIN" },
              { epoch: 11, sequence: 1, kind: "UPSERT", key: "x", value: 1 },
              { epoch: 11, sequence: 1, kind: "UPSERT", key: "x", value: 2 },
              { epoch: 11, sequence: 2, kind: "COMMIT" },
            ]],
            expected: [{ key: "fallback", value: 10 }],
          },
          {
            id: "applies-delete-and-key-reuse-in-sequence-order",
            args: [[
              { epoch: 12, sequence: 3, kind: "UPSERT", key: "a", value: 3 },
              { epoch: 12, sequence: 0, kind: "BEGIN" },
              { epoch: 12, sequence: 2, kind: "DELETE", key: "a" },
              { epoch: 12, sequence: 1, kind: "UPSERT", key: "a", value: 1 },
              { epoch: 12, sequence: 4, kind: "UPSERT", key: "b", value: 2 },
              { epoch: 12, sequence: 5, kind: "COMMIT" },
            ]],
            expected: [{ key: "a", value: 3 }, { key: "b", value: 2 }],
          },
        ],
      }),
    },
    oracle: CaseOracleV4Schema.parse({
      ...baseOracle({
        caseId: "repair-epoch-delta-materialization",
        requiredEvidenceSourceBundles: [["official-delta-stream-contract"]],
        allowedChangedFiles: ["adapter.ts"],
        expectedCommandExitCodes: { [adapterCommand]: 0 },
        hiddenProbePath: "verifier/hidden-probes.json",
      }),
      expectedAction: "REPAIR_ADAPTER",
      requiredPublicCommands: [adapterCommand],
      requiresHiddenProbe: true,
    }),
  },
  {
    id: "retry-signed-release-quorum",
    title: "Signed release quorum retry",
    description: "A release remains unpublished until a valid signed manifest establishes its generation and digest and both independent replicas match those facts and report completion.",
    createdFrom: "Synthetic independently confirmed publication quorum pattern",
    allowedWritePaths: [],
    requiredCommands: [],
    files: {
      "input/canonical.json": json([{
        id: "release-42",
        generation: 42,
        digest: releaseDigest,
        status: "pending",
        published: false,
      }]),
      "input/observations.json": json([
        manifestObservation("obs-manifest-42", "2026-08-29T19:50:00.000Z"),
        replicaObservation({
          id: "obs-replica-east-42",
          sourceId: "official-replica-east",
          observedAt: "2026-08-29T19:52:00.000Z",
        }),
        replicaObservation({
          id: "obs-replica-west-41",
          sourceId: "official-replica-west",
          observedAt: "2026-08-29T19:53:00.000Z",
          generation: 41,
          digest: "3b4bbb98a16f01e7c77c5fa48daef582475e5360da12b1d37154c6b5f9ac3cf0",
        }),
      ]),
      "input/policy.json": json(policyV4({
        authorityValidity: [
          {
            mode: "SNAPSHOT_MAX_AGE",
            sourceId: "official-release-manifest",
            authorityScope: "release-manifest",
            maxAgeMinutes: 60,
          },
          {
            mode: "SNAPSHOT_MAX_AGE",
            sourceId: "official-replica-east",
            authorityScope: "replica-confirmation",
            maxAgeMinutes: 60,
          },
          {
            mode: "SNAPSHOT_MAX_AGE",
            sourceId: "official-replica-west",
            authorityScope: "replica-confirmation",
            maxAgeMinutes: 60,
          },
        ],
        retryLimit: 3,
        invariants: [
          "The currently published release remains unchanged until the full quorum is satisfied",
          "Manifest and replica confirmations must bind the same release occurrence",
          "A partial or mismatched quorum is never published",
        ],
        rules: [
          "The signed manifest establishes generation 42 and its digest; it must have a valid signature, and both named replica authorities must independently match that generation and digest and report complete status",
          "Retry no earlier than 2026-08-29T20:05:00.000Z and no later than 2026-08-29T20:20:00.000Z; use two or three attempts and escalate no later than attempt three",
          "Future acceptance conditions bind source, release subject, observation kind, and fact path rather than current evidence IDs",
        ],
      })),
    },
    oracle: CaseOracleV4Schema.parse({
      ...baseOracle({
        caseId: "retry-signed-release-quorum",
        requiredEvidenceSourceBundles: [[
          "official-release-manifest",
          "official-replica-east",
          "official-replica-west",
        ]],
      }),
      expectedAction: "RETRY_LATER",
      retryWindow: {
        earliestNotBefore: "2026-08-29T20:05:00.000Z",
        latestNotBefore: "2026-08-29T20:20:00.000Z",
        minimumAttempts: 2,
        maximumAttempts: 3,
        latestEscalationAttempt: 3,
      },
      requiredPreserveRecordIds: ["release-42"],
      requiredFutureConditions: [
        futureCondition("official-release-manifest", "signed-manifest", "facts.generation", 42),
        futureCondition("official-release-manifest", "signed-manifest", "facts.digest", releaseDigest),
        futureCondition("official-release-manifest", "signed-manifest", "facts.signatureValid", true),
        futureCondition("official-replica-east", "replica-confirmation", "facts.generation", 42),
        futureCondition("official-replica-east", "replica-confirmation", "facts.digest", releaseDigest),
        futureCondition("official-replica-east", "replica-confirmation", "facts.complete", true),
        futureCondition("official-replica-west", "replica-confirmation", "facts.generation", 42),
        futureCondition("official-replica-west", "replica-confirmation", "facts.digest", releaseDigest),
        futureCondition("official-replica-west", "replica-confirmation", "facts.complete", true),
      ],
      satisfyingObservations: [
        manifestObservation("future-manifest-42", "2026-08-29T20:06:00.000Z"),
        replicaObservation({
          id: "future-replica-east-42",
          sourceId: "official-replica-east",
          observedAt: "2026-08-29T20:07:00.000Z",
        }),
        replicaObservation({
          id: "future-replica-west-42",
          sourceId: "official-replica-west",
          observedAt: "2026-08-29T20:08:00.000Z",
        }),
      ],
      nearMissObservationFixtures: [
        {
          id: "west-generation-still-lagging",
          observations: [
            manifestObservation("near-manifest-a", "2026-08-29T20:06:00.000Z"),
            replicaObservation({
              id: "near-east-a",
              sourceId: "official-replica-east",
              observedAt: "2026-08-29T20:07:00.000Z",
            }),
            replicaObservation({
              id: "near-west-a",
              sourceId: "official-replica-west",
              observedAt: "2026-08-29T20:08:00.000Z",
              generation: 41,
            }),
          ],
        },
        {
          id: "west-digest-mismatch",
          observations: [
            manifestObservation("near-manifest-b", "2026-08-29T20:06:00.000Z"),
            replicaObservation({
              id: "near-east-b",
              sourceId: "official-replica-east",
              observedAt: "2026-08-29T20:07:00.000Z",
            }),
            replicaObservation({
              id: "near-west-b",
              sourceId: "official-replica-west",
              observedAt: "2026-08-29T20:08:00.000Z",
              digest: "681743610aaee6f1aa12cb3c600e9d7675d7fe3e74d20d317fd69775e1f2e744",
            }),
          ],
        },
        {
          id: "east-not-complete",
          observations: [
            manifestObservation("near-manifest-c", "2026-08-29T20:06:00.000Z"),
            replicaObservation({
              id: "near-east-c",
              sourceId: "official-replica-east",
              observedAt: "2026-08-29T20:07:00.000Z",
              complete: false,
            }),
            replicaObservation({
              id: "near-west-c",
              sourceId: "official-replica-west",
              observedAt: "2026-08-29T20:08:00.000Z",
            }),
          ],
        },
        {
          id: "manifest-signature-invalid",
          observations: [
            manifestObservation("near-manifest-d", "2026-08-29T20:06:00.000Z", false),
            replicaObservation({
              id: "near-east-d",
              sourceId: "official-replica-east",
              observedAt: "2026-08-29T20:07:00.000Z",
            }),
            replicaObservation({
              id: "near-west-d",
              sourceId: "official-replica-west",
              observedAt: "2026-08-29T20:08:00.000Z",
            }),
          ],
        },
        {
          id: "west-confirmation-missing",
          observations: [
            manifestObservation("near-manifest-e", "2026-08-29T20:06:00.000Z"),
            replicaObservation({
              id: "near-east-e",
              sourceId: "official-replica-east",
              observedAt: "2026-08-29T20:07:00.000Z",
            }),
          ],
        },
      ],
    }),
  },
  {
    id: "noop-post-cutoff-reclassification",
    title: "Post-cutoff classification revision",
    description: "A newer signed classification is visible, but it becomes effective after the canonical snapshot cutoff.",
    createdFrom: "Synthetic point-in-time policy classification pattern",
    allowedWritePaths: [],
    requiredCommands: [],
    files: {
      "input/canonical.json": json([{
        id: "policy-77",
        classification: "restricted",
        classificationRevision: "r7",
        effectiveFrom: "2026-08-29T19:00:00.000Z",
        status: "active",
      }]),
      "input/observations.json": json([
        observation({
          id: "obs-classification-r7",
          sourceId: "official-classification-register",
          observedAt: "2026-08-29T19:05:00.000Z",
          effectiveAt: "2026-08-29T19:00:00.000Z",
          authorityScope: ["classification"],
          subjectId: "policy-77",
          kind: "signed-classification",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "classification-v4",
          facts: {
            classification: "restricted",
            revision: "r7",
            signatureValid: true,
          },
        }),
        observation({
          id: "obs-classification-r8",
          sourceId: "official-classification-register",
          observedAt: "2026-08-29T19:55:00.000Z",
          effectiveAt: "2026-08-29T20:30:00.000Z",
          authorityScope: ["classification"],
          subjectId: "policy-77",
          kind: "signed-classification",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "classification-v4",
          facts: {
            classification: "open",
            revision: "r8",
            signatureValid: true,
          },
        }),
      ]),
      "input/policy.json": json(policyV4({
        authorityByField: {
          classification: "official-classification-register",
          classificationRevision: "official-classification-register",
          effectiveFrom: "official-classification-register",
        },
        authorityValidity: [{
          mode: "EFFECTIVE_UNTIL_SUPERSEDED",
          sourceId: "official-classification-register",
          authorityScope: "classification",
          applicabilityFactPath: "facts.revision",
        }],
        invariants: [
          "Canonical classification represents the signed revision effective at the cutoff",
          "Publication or observation time never substitutes for effective time",
          "No files change when canonical state already matches the controlling revision",
        ],
        rules: [
          "Choose the latest signed classification whose effectiveAt is at or before the cutoff",
          "Treat a signed future-effective revision as context, not current authority",
        ],
      })),
    },
    oracle: CaseOracleV4Schema.parse({
      ...baseOracle({
        caseId: "noop-post-cutoff-reclassification",
        requiredEvidenceSourceBundles: [["official-classification-register"]],
      }),
      expectedAction: "NO_ACTION",
      requiredAuthoritySources: ["official-classification-register"],
    }),
  },
  {
    id: "review-composite-asset-identity",
    title: "Composite asset identity review",
    description: "An inspection names a display label shared by two registered assets but omits the serial and site needed to bind one occurrence.",
    createdFrom: "Synthetic composite physical-asset identity pattern",
    allowedWritePaths: [],
    requiredCommands: [],
    files: {
      "input/canonical.json": json([{
        id: "inspection-882",
        assetLabel: "Rotor Unit 8",
        assetSerial: null,
        siteCode: null,
        finding: "seal wear",
        status: "unresolved",
      }]),
      "input/observations.json": json([
        observation({
          id: "obs-inspection-882",
          sourceId: "official-inspection-log",
          observedAt: "2026-08-29T19:45:00.000Z",
          effectiveAt: "2026-08-29T19:40:00.000Z",
          authorityScope: ["inspection", "asset-reference"],
          subjectId: "inspection-882",
          kind: "signed-inspection",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "inspection-v5",
          facts: {
            assetLabel: "Rotor Unit 8",
            assetSerial: null,
            siteCode: null,
            finding: "seal wear",
            signatureValid: true,
          },
        }),
        observation({
          id: "obs-asset-east-8",
          sourceId: "official-asset-registry",
          observedAt: "2026-08-29T19:30:00.000Z",
          effectiveAt: "2026-08-01T00:00:00.000Z",
          authorityScope: ["asset-identity"],
          subjectId: "asset-east-8",
          kind: "asset-record",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "asset-record-v6",
          facts: {
            assetLabel: "Rotor Unit 8",
            assetSerial: "E-8804",
            siteCode: "EAST",
            lifecycleStatus: "active",
          },
        }),
        observation({
          id: "obs-asset-west-8",
          sourceId: "official-asset-registry",
          observedAt: "2026-08-29T19:31:00.000Z",
          effectiveAt: "2026-08-01T00:00:00.000Z",
          authorityScope: ["asset-identity"],
          subjectId: "asset-west-8",
          kind: "asset-record",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "asset-record-v6",
          facts: {
            assetLabel: "Rotor Unit 8",
            assetSerial: "W-8819",
            siteCode: "WEST",
            lifecycleStatus: "active",
          },
        }),
      ]),
      "input/policy.json": json(policyV4({
        authorityByField: {
          assetSerial: "official-inspection-log+official-asset-registry",
          siteCode: "official-inspection-log+official-asset-registry",
        },
        authorityValidity: [
          {
            mode: "SNAPSHOT_MAX_AGE",
            sourceId: "official-inspection-log",
            authorityScope: "inspection",
            maxAgeMinutes: 60,
          },
          {
            mode: "SNAPSHOT_MAX_AGE",
            sourceId: "official-asset-registry",
            authorityScope: "asset-identity",
            maxAgeMinutes: 60,
          },
        ],
        invariants: [
          "A display label is not a stable asset occurrence identifier",
          "Distinct site and serial pairs remain distinct even when labels match",
          "No maintenance record is mutated without one exact asset occurrence",
        ],
        rules: [
          "Bind an inspection only when its asset serial and site code identify exactly one registry occurrence",
          "When either binding field is absent and multiple occurrences match the label, request both missing fields from the inspection authority",
        ],
      })),
    },
    oracle: CaseOracleV4Schema.parse({
      ...baseOracle({
        caseId: "review-composite-asset-identity",
        requiredEvidenceSourceBundles: [[
          "official-inspection-log",
          "official-asset-registry",
        ]],
      }),
      expectedAction: "HUMAN_REVIEW",
      reviewRequirements: {
        subjectId: "inspection-882",
        acceptableTargetEvidenceIds: ["obs-inspection-882"],
        requiredFactPaths: ["facts.assetSerial", "facts.siteCode"],
      },
    }),
  },
];

export const HOLDOUT_V4_CASE_IDS = definitions.map((definition) => definition.id) as readonly string[];

export async function writeV4Case(root: string, definition: HoldoutV4Definition): Promise<void> {
  const caseDir = resolve(root, definition.id);
  await rm(caseDir, { recursive: true, force: true });
  const provenance = [];
  const agentVisibleFiles = [];
  for (const [relativePath, content] of Object.entries(definition.files).sort(([left], [right]) =>
    left.localeCompare(right))) {
    const fullPath = resolve(caseDir, "workspace", ...relativePath.split("/"));
    await mkdir(resolve(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content, "utf8");
    const path = "workspace/" + relativePath;
    agentVisibleFiles.push(path);
    provenance.push({
      sourceId: "holdout-v4-" + relativePath.replaceAll("/", "-"),
      path,
      sourceClass: "SYNTHETIC",
      capturedAt,
      transformation: "Synthetic V4 holdout fixture created before the frozen evaluation campaign",
      permissionBasis: "Created for this benchmark",
      sha256: sha256Text(content),
    });
  }
  for (const [relativePath, content] of Object.entries(definition.verifierFiles ?? {}).sort(([left], [right]) =>
    left.localeCompare(right))) {
    const fullPath = resolve(caseDir, "verifier", ...relativePath.split("/"));
    await mkdir(resolve(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content, "utf8");
  }
  await writeFile(resolve(caseDir, "case.json"), json({
    schemaVersion: 1,
    id: definition.id,
    title: definition.title,
    description: definition.description,
    sourceClass: "SYNTHETIC",
    createdFrom: definition.createdFrom,
    agentVisibleFiles,
    allowedWritePaths: definition.allowedWritePaths,
    requiredCommands: definition.requiredCommands,
    provenance,
  }), "utf8");
  await writeFile(resolve(caseDir, "oracle.json"), json(CaseOracleV4Schema.parse(definition.oracle)), "utf8");
}

export async function generateHoldoutV4Cases(
  root = resolve("holdout", "v4", "cases"),
): Promise<string[]> {
  for (const definition of definitions) await writeV4Case(root, definition);
  return [...HOLDOUT_V4_CASE_IDS];
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const ids = await generateHoldoutV4Cases();
  process.stdout.write("Generated " + ids.length + " holdout-v4 cases:\n" + ids.join("\n") + "\n");
}
