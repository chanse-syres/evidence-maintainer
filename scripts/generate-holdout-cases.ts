import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256Text } from "../src/core/canonical-json.ts";
import type { ActionClass } from "../src/core/schemas.ts";

interface HoldoutDefinition {
  id: string;
  title: string;
  description: string;
  createdFrom: string;
  allowedWritePaths: string[];
  requiredCommands: string[];
  files: Record<string, string>;
  oracle: {
    expectedAction: ActionClass;
    requiredEvidenceIds: string[];
    allowedChangedFiles: string[];
    expectedRecords: Array<{ file: string; recordId: string; fields: Record<string, unknown> }>;
    requiredChallengerVerdict: "CONFIRM" | "REJECT" | "ESCALATE";
    requiredMinimumInformation?: string[];
    requiredRetryConditionIncludes?: string[];
    expectedCommandExitCodes?: Record<string, number>;
  };
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const capturedAt = "2026-08-28T23:30:00.000Z";
const adapterCommand = "node --experimental-strip-types --test adapter.test.ts";

function policy(input: {
  cutoff?: string;
  authorityByField?: Record<string, string>;
  freshnessWindowMinutes?: number;
  retryLimit?: number;
  invariants: string[];
  rules: string[];
}) {
  return {
    schemaVersion: 1,
    cutoff: input.cutoff ?? "2026-08-28T23:00:00.000Z",
    authorityByField: input.authorityByField ?? {},
    freshnessWindowMinutes: input.freshnessWindowMinutes ?? 10_080,
    retryLimit: input.retryLimit ?? 2,
    invariants: input.invariants,
    rules: input.rules,
  };
}

function observation(input: {
  id: string;
  sourceId: string;
  observedAt: string;
  effectiveAt?: string | null;
  authorityScope?: string[];
  subjectId?: string | null;
  kind: string;
  status?: number | null;
  contentType?: string | null;
  schemaFingerprint?: string | null;
  facts: Record<string, unknown>;
}) {
  return {
    id: input.id,
    sourceId: input.sourceId,
    observedAt: input.observedAt,
    effectiveAt: input.effectiveAt ?? null,
    authorityScope: input.authorityScope ?? [],
    subjectId: input.subjectId ?? null,
    kind: input.kind,
    status: input.status ?? null,
    contentType: input.contentType ?? null,
    schemaFingerprint: input.schemaFingerprint ?? null,
    facts: input.facts,
  };
}

const definitions: HoldoutDefinition[] = [
  {
    id: "update-gauge-unit-normalization",
    title: "Normalize an authoritative gauge reading without widening its scope",
    description: "An approved river-gauge observation changes stage height in feet while canonical storage uses meters.",
    createdFrom: "Synthetic public-data unit-normalization maintenance pattern",
    allowedWritePaths: ["input/canonical.json"],
    requiredCommands: [],
    files: {
      "input/canonical.json": json([{
        id: "gauge-1042",
        stageMeters: 3.6576,
        stageMeasuredAt: "2026-08-27T12:00:00.000Z",
        dischargeCubicMetersPerSecond: 24.7,
        stationStatus: "active",
      }]),
      "input/observations.json": json([observation({
        id: "obs-approved-stage-feet",
        sourceId: "official-river-gauge",
        observedAt: "2026-08-28T15:02:00.000Z",
        effectiveAt: "2026-08-28T15:00:00.000Z",
        authorityScope: ["stage-height", "stage-measurement-time"],
        subjectId: "gauge-1042",
        kind: "approved-reading",
        status: 200,
        contentType: "application/json",
        schemaFingerprint: "gauge-reading-feet-v1",
        facts: { stageValue: 12.5, stageUnit: "ft", qualityCode: "approved" },
      })]),
      "input/policy.json": json(policy({
        authorityByField: {
          stageMeters: "official-river-gauge",
          stageMeasuredAt: "official-river-gauge",
        },
        invariants: [
          "Station identity and fields outside the observation authority scope remain unchanged",
          "Canonical stage height is stored in meters to four decimal places",
        ],
        rules: [
          "An approved reading controls only stage height and its measurement time",
          "Convert feet to meters using exactly 1 foot = 0.3048 meters and round to four decimal places",
        ],
      })),
    },
    oracle: {
      expectedAction: "UPDATE_DATA",
      requiredEvidenceIds: ["obs-approved-stage-feet"],
      allowedChangedFiles: ["input/canonical.json"],
      expectedRecords: [{
        file: "input/canonical.json",
        recordId: "gauge-1042",
        fields: {
          stageMeters: 3.81,
          stageMeasuredAt: "2026-08-28T15:00:00.000Z",
          dischargeCubicMetersPerSecond: 24.7,
          stationStatus: "active",
        },
      }],
      requiredChallengerVerdict: "CONFIRM",
    },
  },
  {
    id: "repair-offset-transition",
    title: "Repair per-endpoint offsets across a civil-time fallback",
    description: "A transit feed moves from UTC timestamps to local wall-clock values with an offset on each endpoint.",
    createdFrom: "Synthetic public-transit timestamp-contract transition",
    allowedWritePaths: ["adapter.ts"],
    requiredCommands: [adapterCommand],
    files: {
      "input/canonical.json": json([]),
      "input/observations.json": json([observation({
        id: "obs-local-offset-contract",
        sourceId: "official-transit-api",
        observedAt: "2026-08-28T18:00:00.000Z",
        authorityScope: ["timestamp-encoding"],
        kind: "schema-change",
        status: 200,
        contentType: "application/json",
        schemaFingerprint: "closure-local-offset-v2",
        facts: {
          legacyEncoding: "UTC ISO timestamp",
          currentEncoding: "local wall-clock timestamp with a separate offsetMinutes on each endpoint",
        },
      })]),
      "input/policy.json": json(policy({
        invariants: [
          "Legacy UTC input remains unchanged",
          "Closure identity and input order remain stable",
          "Normalized instants are independent of the host timezone and end after start",
        ],
        rules: [
          "Apply each endpoint's own offset rather than a record-wide offset",
          "A local wall-clock end may precede its start during a daylight-saving fallback",
        ],
      })),
      "adapter.ts": `export interface ClosureInput {
  id: string;
  start: string;
  end: string;
  startOffsetMinutes?: number;
  endOffsetMinutes?: number;
}

export interface Closure { id: string; startUtc: string; endUtc: string }

function toUtc(value: string, offsetMinutes?: number): string {
  if (value.endsWith("Z")) return new Date(value).toISOString();
  const wallClockAsUtc = Date.parse(\`${"${value}"}Z\`);
  return new Date(wallClockAsUtc - (offsetMinutes ?? 0) * 60_000).toISOString();
}

export function normalizeClosures(rows: ClosureInput[]): Closure[] {
  return rows.map((row) => ({
    id: row.id,
    startUtc: toUtc(row.start, row.startOffsetMinutes),
    endUtc: toUtc(row.end, row.startOffsetMinutes),
  }));
}
`,
      "adapter.test.ts": `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeClosures } from "./adapter.ts";

const load = (path: string) => JSON.parse(readFileSync(path, "utf8"));

test("legacy UTC timestamps remain unchanged", () => {
  assert.deepEqual(normalizeClosures(load("fixtures/legacy.json")), [{
    id: "closure-legacy",
    startUtc: "2026-10-10T08:00:00.000Z",
    endUtc: "2026-10-10T09:00:00.000Z",
  }]);
});

test("each current endpoint uses its declared offset", () => {
  assert.deepEqual(normalizeClosures(load("fixtures/current.json")), [
    {
      id: "closure-fallback",
      startUtc: "2026-11-01T08:30:00.000Z",
      endUtc: "2026-11-01T09:15:00.000Z",
    },
    {
      id: "closure-normal",
      startUtc: "2026-11-02T17:00:00.000Z",
      endUtc: "2026-11-02T18:00:00.000Z",
    },
  ]);
});
`,
      "fixtures/legacy.json": json([{
        id: "closure-legacy",
        start: "2026-10-10T08:00:00.000Z",
        end: "2026-10-10T09:00:00.000Z",
      }]),
      "fixtures/current.json": json([
        {
          id: "closure-fallback",
          start: "2026-11-01T01:30:00",
          startOffsetMinutes: -420,
          end: "2026-11-01T01:15:00",
          endOffsetMinutes: -480,
        },
        {
          id: "closure-normal",
          start: "2026-11-02T09:00:00",
          startOffsetMinutes: -480,
          end: "2026-11-02T10:00:00",
          endOffsetMinutes: -480,
        },
      ]),
    },
    oracle: {
      expectedAction: "REPAIR_ADAPTER",
      requiredEvidenceIds: ["obs-local-offset-contract"],
      allowedChangedFiles: ["adapter.ts"],
      expectedRecords: [],
      requiredChallengerVerdict: "CONFIRM",
      expectedCommandExitCodes: { [adapterCommand]: 0 },
    },
  },
  {
    id: "retry-release-generation-skew",
    title: "Defer a complete payload that belongs to the wrong release generation",
    description: "A signed manifest and a schema-valid payload are individually healthy but belong to adjacent release generations.",
    createdFrom: "Synthetic multi-artifact publication-skew pattern",
    allowedWritePaths: [],
    requiredCommands: [],
    files: {
      "input/canonical.json": json([{
        id: "catalog-cache",
        generation: 87,
        payloadSha256: "7777777777777777777777777777777777777777777777777777777777777777",
        status: "active",
      }]),
      "input/observations.json": json([
        observation({
          id: "obs-manifest-generation-88",
          sourceId: "official-release-manifest",
          observedAt: "2026-08-28T16:54:00.000Z",
          authorityScope: ["release-generation", "payload-hash"],
          subjectId: "catalog-release",
          kind: "signed-manifest",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "release-manifest-v3",
          facts: {
            generation: 88,
            payloadSha256: "8888888888888888888888888888888888888888888888888888888888888888",
            signatureValid: true,
          },
        }),
        observation({
          id: "obs-payload-generation-87",
          sourceId: "official-release-payload",
          observedAt: "2026-08-28T16:55:00.000Z",
          authorityScope: ["release-payload"],
          subjectId: "catalog-release",
          kind: "dataset",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "catalog-payload-v5",
          facts: {
            generation: 87,
            payloadSha256: "7777777777777777777777777777777777777777777777777777777777777777",
            schemaValid: true,
            complete: true,
          },
        }),
      ]),
      "input/policy.json": json(policy({
        retryLimit: 3,
        freshnessWindowMinutes: 30,
        invariants: [
          "Manifest and payload from different generations are never combined",
          "The generation-87 cache remains available until a complete atomic release is observed",
        ],
        rules: [
          "Proceed only when manifest generation, payload generation, and payload hash agree",
          "Publication skew inside the window is transient: retry after 10 minutes and escalate after three unsuccessful attempts",
        ],
      })),
    },
    oracle: {
      expectedAction: "RETRY_LATER",
      requiredEvidenceIds: ["obs-manifest-generation-88", "obs-payload-generation-87"],
      allowedChangedFiles: [],
      expectedRecords: [],
      requiredChallengerVerdict: "CONFIRM",
      requiredRetryConditionIncludes: ["10 minutes", "generation 88", "third"],
    },
  },
  {
    id: "noop-superseded-amendment",
    title: "Materialize the terminal amendment rather than an intermediate change",
    description: "An official deadline extension is explicitly rescinded by the next authoritative revision before cutoff.",
    createdFrom: "Synthetic ordered-amendment materialization pattern",
    allowedWritePaths: [],
    requiredCommands: [],
    files: {
      "input/canonical.json": json([{
        id: "solicitation-77",
        deadline: "2026-09-10T21:00:00.000Z",
        status: "open",
        currency: "USD",
        materializedRevision: "rev-43",
      }]),
      "input/observations.json": json([
        observation({
          id: "obs-amendment-42",
          sourceId: "official-procurement-register",
          observedAt: "2026-08-28T14:00:00.000Z",
          effectiveAt: "2026-08-28T14:00:00.000Z",
          authorityScope: ["deadline", "revision-chain"],
          subjectId: "solicitation-77",
          kind: "amendment",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "procurement-revision-v2",
          facts: {
            revision: "rev-42",
            supersedes: "rev-41",
            deadline: "2026-09-17T21:00:00.000Z",
          },
        }),
        observation({
          id: "obs-rescission-43",
          sourceId: "official-procurement-register",
          observedAt: "2026-08-28T16:00:00.000Z",
          effectiveAt: "2026-08-28T16:00:00.000Z",
          authorityScope: ["deadline", "revision-chain"],
          subjectId: "solicitation-77",
          kind: "rescission",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "procurement-revision-v2",
          facts: {
            revision: "rev-43",
            supersedes: "rev-42",
            restoresRevision: "rev-41",
            deadline: "2026-09-10T21:00:00.000Z",
          },
        }),
      ]),
      "input/policy.json": json(policy({
        authorityByField: {
          deadline: "official-procurement-register",
          materializedRevision: "official-procurement-register",
        },
        invariants: [
          "Only the terminal reachable revision controls current contract state",
          "Superseded intermediate values do not survive materialization",
        ],
        rules: [
          "Follow the explicit supersession chain through the cutoff",
          "Do not write canonical state when the terminal revision already matches it",
        ],
      })),
    },
    oracle: {
      expectedAction: "NO_ACTION",
      requiredEvidenceIds: ["obs-amendment-42", "obs-rescission-43"],
      allowedChangedFiles: [],
      expectedRecords: [],
      requiredChallengerVerdict: "CONFIRM",
    },
  },
  {
    id: "review-unknown-coordinate-reference",
    title: "Escalate a near-boundary permit with an unknown coordinate reference",
    description: "An official permit location cannot be compared safely with an official boundary because its reference system and accuracy are absent.",
    createdFrom: "Synthetic geospatial authority and uncertainty pattern",
    allowedWritePaths: [],
    requiredCommands: [],
    files: {
      "input/canonical.json": json([{
        id: "permit-204",
        jurisdiction: "UNDETERMINED",
        feeClass: null,
        boundaryVersion: "city-boundary-2026",
      }]),
      "input/observations.json": json([
        observation({
          id: "obs-official-boundary-2026",
          sourceId: "official-city-boundary",
          observedAt: "2026-08-28T10:00:00.000Z",
          effectiveAt: "2026-08-28T00:00:00.000Z",
          authorityScope: ["jurisdiction-boundary"],
          subjectId: "permit-204",
          kind: "signed-boundary",
          status: 200,
          contentType: "application/geo+json",
          schemaFingerprint: "municipal-boundary-v4",
          facts: {
            boundaryVersion: "city-boundary-2026",
            crs: "EPSG:4326",
            geometrySha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          },
        }),
        observation({
          id: "obs-permit-location",
          sourceId: "official-permit-register",
          observedAt: "2026-08-28T11:00:00.000Z",
          effectiveAt: "2026-08-28T09:30:00.000Z",
          authorityScope: ["permit-location"],
          subjectId: "permit-204",
          kind: "permit-coordinate",
          status: 200,
          contentType: "application/json",
          schemaFingerprint: "permit-location-v2",
          facts: {
            coordinates: [-122.67648, 45.52317],
            crs: null,
            positionalAccuracyMeters: null,
            assumedWgs84DistanceInsideMeters: 1.2,
          },
        }),
      ]),
      "input/policy.json": json(policy({
        authorityByField: {
          jurisdiction: "official-city-boundary+official-permit-register",
          feeClass: "official-city-boundary+official-permit-register",
        },
        invariants: [
          "Jurisdiction changes only when location and boundary use an explicit common reference",
          "Uncertainty that crosses a boundary cannot be collapsed into a fee classification",
        ],
        rules: [
          "Numeric coordinate shape is not evidence of a coordinate reference system",
          "Request reference and accuracy evidence when the possible location overlaps the boundary",
        ],
      })),
    },
    oracle: {
      expectedAction: "HUMAN_REVIEW",
      requiredEvidenceIds: ["obs-official-boundary-2026", "obs-permit-location"],
      allowedChangedFiles: [],
      expectedRecords: [],
      requiredChallengerVerdict: "ESCALATE",
      requiredMinimumInformation: [
        "permit coordinate CRS or datum",
        "positional accuracy or signed jurisdiction determination",
      ],
    },
  },
];

export const HOLDOUT_CASE_IDS = definitions.map((definition) => definition.id) as readonly string[];

async function writeCase(root: string, definition: HoldoutDefinition): Promise<void> {
  const caseDir = resolve(root, definition.id);
  const provenance = [];
  const agentVisibleFiles = [];
  for (const [relativePath, content] of Object.entries(definition.files).sort(([a], [b]) => a.localeCompare(b))) {
    const fullPath = resolve(caseDir, "workspace", ...relativePath.split("/"));
    await mkdir(resolve(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content, "utf8");
    const path = `workspace/${relativePath}`;
    agentVisibleFiles.push(path);
    provenance.push({
      sourceId: `holdout-${relativePath.replaceAll("/", "-")}`,
      path,
      sourceClass: "SYNTHETIC",
      capturedAt,
      transformation: "Synthetic holdout fixture created before the frozen evaluation campaign",
      permissionBasis: "Created for this benchmark",
      sha256: sha256Text(content),
    });
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
  await writeFile(resolve(caseDir, "oracle.json"), json({
    schemaVersion: 1,
    caseId: definition.id,
    expectedAction: definition.oracle.expectedAction,
    requiredEvidenceIds: definition.oracle.requiredEvidenceIds,
    allowedChangedFiles: definition.oracle.allowedChangedFiles,
    expectedRecords: definition.oracle.expectedRecords,
    requiredChallengerVerdict: definition.oracle.requiredChallengerVerdict,
    requiredMinimumInformation: definition.oracle.requiredMinimumInformation ?? [],
    requiredRetryConditionIncludes: definition.oracle.requiredRetryConditionIncludes ?? [],
    expectedCommandExitCodes: definition.oracle.expectedCommandExitCodes ?? {},
  }), "utf8");
}

export async function generateHoldoutCases(root = resolve("holdout", "cases")): Promise<string[]> {
  for (const definition of definitions) await writeCase(root, definition);
  return [...HOLDOUT_CASE_IDS];
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const ids = await generateHoldoutCases();
  process.stdout.write(`Generated ${ids.length} frozen holdout cases:\n${ids.join("\n")}\n`);
}
