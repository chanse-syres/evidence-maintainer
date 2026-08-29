import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256Text } from "../src/core/canonical-json.ts";
import type {
  ActionClass,
  EvidenceAssessment,
  RetryPlan,
  ReviewRequest,
} from "../src/core/schemas.ts";

export interface HoldoutDefinition {
  id: string;
  title: string;
  description: string;
  createdFrom: string;
  allowedWritePaths: string[];
  requiredCommands: string[];
  files: Record<string, string>;
  verifierFiles?: Record<string, string>;
  oracle: {
    expectedAction: ActionClass;
    requiredEvidenceIds: string[];
    allowedChangedFiles: string[];
    expectedRecords: Array<{ file: string; recordId: string; fields: Record<string, unknown> }>;
    requiredChallengerVerdict: "CONFIRM" | "REJECT" | "ESCALATE";
    requiredEvidenceAssessments?: EvidenceAssessment[];
    evidenceAssessmentBundles?: EvidenceAssessment[][];
    allowedEvidenceAssessments?: EvidenceAssessment[];
    requiredChallengerEvidenceIds?: string[];
    acceptableReviewRequests?: ReviewRequest[];
    expectedRetryPlan?: RetryPlan | null;
    expectedCommandExitCodes?: Record<string, number>;
    hiddenProbePath?: string | null;
  };
}

export const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const capturedAt = "2026-08-28T23:30:00.000Z";
const adapterCommand = "node --experimental-strip-types --test adapter.test.ts";

export function policy(input: {
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

export function observation(input: {
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
    title: "River-gauge publication reconciliation",
    description: "A canonical river-gauge record and a newly published official reading require a maintenance decision.",
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
      requiredEvidenceAssessments: [
        { evidenceId: "obs-approved-stage-feet", factPath: "sourceId", disposition: "SUPPORT", reason: "The official gauge is the scoped authority." },
        { evidenceId: "obs-approved-stage-feet", factPath: "subjectId", disposition: "SUPPORT", reason: "The observation is bound to the canonical gauge identity." },
        { evidenceId: "obs-approved-stage-feet", factPath: "effectiveAt", disposition: "SUPPORT", reason: "The effective time controls the canonical measurement timestamp." },
        { evidenceId: "obs-approved-stage-feet", factPath: "authorityScope", disposition: "SUPPORT", reason: "The scope limits the update to stage height and measurement time." },
        { evidenceId: "obs-approved-stage-feet", factPath: "facts.stageValue", disposition: "SUPPORT", reason: "The approved numeric reading supplies the new stage." },
        { evidenceId: "obs-approved-stage-feet", factPath: "facts.stageUnit", disposition: "SUPPORT", reason: "The source unit determines the required normalization." },
        { evidenceId: "obs-approved-stage-feet", factPath: "facts.qualityCode", disposition: "SUPPORT", reason: "Only an approved reading may control canonical state." },
      ],
      allowedEvidenceAssessments: [
        { evidenceId: "obs-approved-stage-feet", factPath: "sourceId", disposition: "SUPPORT", reason: "The official gauge is the scoped authority." },
        { evidenceId: "obs-approved-stage-feet", factPath: "subjectId", disposition: "SUPPORT", reason: "The observation is bound to the canonical gauge identity." },
        { evidenceId: "obs-approved-stage-feet", factPath: "effectiveAt", disposition: "SUPPORT", reason: "The effective time controls the canonical measurement timestamp." },
        { evidenceId: "obs-approved-stage-feet", factPath: "authorityScope", disposition: "SUPPORT", reason: "The scope limits the update to stage height and measurement time." },
        { evidenceId: "obs-approved-stage-feet", factPath: "facts.stageValue", disposition: "SUPPORT", reason: "The approved numeric reading supplies the new stage." },
        { evidenceId: "obs-approved-stage-feet", factPath: "facts.stageUnit", disposition: "SUPPORT", reason: "The source unit determines the required normalization." },
        { evidenceId: "obs-approved-stage-feet", factPath: "facts.qualityCode", disposition: "SUPPORT", reason: "Only an approved reading may control canonical state." },
        { evidenceId: "obs-approved-stage-feet", factPath: "observedAt", disposition: "CONTEXT", reason: "The capture time is relevant publication context." },
        { evidenceId: "obs-approved-stage-feet", factPath: "kind", disposition: "SUPPORT", reason: "The observation kind identifies an approved reading." },
      ],
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
    title: "Transit closure timestamp transition",
    description: "A transit feed changes its timestamp contract while historical and current closure records remain in scope.",
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
    verifierFiles: {
      "hidden-probes.json": json({
        schemaVersion: 1,
        exportName: "normalizeClosures",
        cases: [{
          id: "unseen-offsets",
          args: [[
            { id: "unseen-east", start: "2027-03-14T03:05:00", startOffsetMinutes: -240, end: "2027-03-14T04:20:00", endOffsetMinutes: -240 },
            { id: "unseen-legacy", start: "2027-01-02T00:00:00.000Z", end: "2027-01-02T00:30:00.000Z" },
            { id: "unseen-fallback", start: "2027-10-31T12:00:00", startOffsetMinutes: 330, end: "2027-10-31T11:45:00", endOffsetMinutes: 270 },
          ]],
          expected: [
            { id: "unseen-east", startUtc: "2027-03-14T07:05:00.000Z", endUtc: "2027-03-14T08:20:00.000Z" },
            { id: "unseen-legacy", startUtc: "2027-01-02T00:00:00.000Z", endUtc: "2027-01-02T00:30:00.000Z" },
            { id: "unseen-fallback", startUtc: "2027-10-31T06:30:00.000Z", endUtc: "2027-10-31T07:15:00.000Z" },
          ],
        }],
      }),
    },
    oracle: {
      expectedAction: "REPAIR_ADAPTER",
      requiredEvidenceIds: ["obs-local-offset-contract"],
      requiredEvidenceAssessments: [
        { evidenceId: "obs-local-offset-contract", factPath: "sourceId", disposition: "SUPPORT", reason: "The official transit API owns the timestamp contract." },
        { evidenceId: "obs-local-offset-contract", factPath: "facts.legacyEncoding", disposition: "SUPPORT", reason: "Legacy UTC compatibility must be preserved." },
        { evidenceId: "obs-local-offset-contract", factPath: "facts.currentEncoding", disposition: "SUPPORT", reason: "The current contract requires independent endpoint offsets." },
      ],
      allowedEvidenceAssessments: [
        { evidenceId: "obs-local-offset-contract", factPath: "sourceId", disposition: "SUPPORT", reason: "The official transit API owns the timestamp contract." },
        { evidenceId: "obs-local-offset-contract", factPath: "facts.legacyEncoding", disposition: "SUPPORT", reason: "Legacy UTC compatibility must be preserved." },
        { evidenceId: "obs-local-offset-contract", factPath: "facts.currentEncoding", disposition: "SUPPORT", reason: "The current contract requires independent endpoint offsets." },
        { evidenceId: "obs-local-offset-contract", factPath: "authorityScope", disposition: "SUPPORT", reason: "The authority scope covers timestamp encoding." },
        { evidenceId: "obs-local-offset-contract", factPath: "observedAt", disposition: "CONTEXT", reason: "The observation time supplies contract-version context." },
        { evidenceId: "obs-local-offset-contract", factPath: "kind", disposition: "SUPPORT", reason: "The source identifies the record as a schema change." },
        { evidenceId: "obs-local-offset-contract", factPath: "schemaFingerprint", disposition: "SUPPORT", reason: "The fingerprint identifies the current timestamp contract." },
      ],
      allowedChangedFiles: ["adapter.ts"],
      expectedRecords: [],
      requiredChallengerVerdict: "CONFIRM",
      expectedCommandExitCodes: { [adapterCommand]: 0 },
      hiddenProbePath: "verifier/hidden-probes.json",
    },
  },
  {
    id: "retry-release-generation-skew",
    title: "Release publication reconciliation",
    description: "A signed manifest, a schema-valid payload, and the current cache require one bounded maintenance decision.",
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
          observedAt: "2026-08-28T22:54:00.000Z",
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
          observedAt: "2026-08-28T22:55:00.000Z",
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
          "Publication skew inside the window is transient: measure the retry delay from the most recent relevant artifact observation, retry 10 minutes after that timestamp, and escalate after three unsuccessful attempts",
        ],
      })),
    },
    oracle: {
      expectedAction: "RETRY_LATER",
      requiredEvidenceIds: ["obs-manifest-generation-88", "obs-payload-generation-87"],
      requiredEvidenceAssessments: [
        { evidenceId: "obs-manifest-generation-88", factPath: "observedAt", disposition: "CONTEXT", reason: "The manifest observation remains inside the transient publication window." },
        { evidenceId: "obs-manifest-generation-88", factPath: "facts.generation", disposition: "SUPPORT", reason: "The manifest generation must agree with the payload." },
        { evidenceId: "obs-manifest-generation-88", factPath: "facts.payloadSha256", disposition: "SUPPORT", reason: "The signed manifest binds the expected payload hash." },
        { evidenceId: "obs-manifest-generation-88", factPath: "facts.signatureValid", disposition: "SUPPORT", reason: "The manifest must retain a valid signature before atomic publication can proceed." },
        { evidenceId: "obs-payload-generation-87", factPath: "observedAt", disposition: "CONTEXT", reason: "The payload observation remains inside the transient publication window." },
        { evidenceId: "obs-payload-generation-87", factPath: "facts.generation", disposition: "SUPPORT", reason: "The payload generation disagrees with the signed manifest." },
        { evidenceId: "obs-payload-generation-87", factPath: "facts.payloadSha256", disposition: "SUPPORT", reason: "The payload hash disagrees with the signed manifest." },
        { evidenceId: "obs-payload-generation-87", factPath: "facts.schemaValid", disposition: "SUPPORT", reason: "A retry may publish only a schema-valid payload." },
        { evidenceId: "obs-payload-generation-87", factPath: "facts.complete", disposition: "SUPPORT", reason: "A retry may publish only a complete payload." },
      ],
      allowedEvidenceAssessments: [
        { evidenceId: "obs-manifest-generation-88", factPath: "observedAt", disposition: "CONTEXT", reason: "The manifest observation remains inside the transient publication window." },
        { evidenceId: "obs-manifest-generation-88", factPath: "facts.generation", disposition: "SUPPORT", reason: "The manifest generation must agree with the payload." },
        { evidenceId: "obs-manifest-generation-88", factPath: "facts.payloadSha256", disposition: "SUPPORT", reason: "The signed manifest binds the expected payload hash." },
        { evidenceId: "obs-manifest-generation-88", factPath: "facts.signatureValid", disposition: "SUPPORT", reason: "The manifest must retain a valid signature before atomic publication can proceed." },
        { evidenceId: "obs-payload-generation-87", factPath: "observedAt", disposition: "CONTEXT", reason: "The payload observation remains inside the transient publication window." },
        { evidenceId: "obs-payload-generation-87", factPath: "facts.generation", disposition: "SUPPORT", reason: "The payload generation disagrees with the signed manifest." },
        { evidenceId: "obs-payload-generation-87", factPath: "facts.payloadSha256", disposition: "SUPPORT", reason: "The payload hash disagrees with the signed manifest." },
        { evidenceId: "obs-payload-generation-87", factPath: "facts.schemaValid", disposition: "SUPPORT", reason: "A retry may publish only a schema-valid payload." },
        { evidenceId: "obs-payload-generation-87", factPath: "facts.complete", disposition: "SUPPORT", reason: "A retry may publish only a complete payload." },
        ...["obs-manifest-generation-88", "obs-payload-generation-87"].flatMap((evidenceId) => ([
          { evidenceId, factPath: "sourceId", disposition: "SUPPORT" as const, reason: "The official release source owns its artifact." },
          { evidenceId, factPath: "subjectId", disposition: "SUPPORT" as const, reason: "Both artifacts are bound to the same release identity." },
          { evidenceId, factPath: "authorityScope", disposition: "SUPPORT" as const, reason: "The declared scope identifies the controlled artifact fields." },
          { evidenceId, factPath: "kind", disposition: "SUPPORT" as const, reason: "The artifact kind distinguishes manifest from payload." },
        ])),
      ],
      allowedChangedFiles: [],
      expectedRecords: [],
      requiredChallengerVerdict: "CONFIRM",
      expectedRetryPlan: {
        notBefore: "2026-08-28T23:05:00.000Z",
        maxAttempts: 3,
        escalateAfterAttempt: 3,
        preserveRecordIds: ["catalog-cache"],
        agreementChecks: [
          {
            leftEvidenceId: "obs-manifest-generation-88",
            leftFactPath: "facts.generation",
            rightEvidenceId: "obs-payload-generation-87",
            rightFactPath: "facts.generation",
          },
          {
            leftEvidenceId: "obs-manifest-generation-88",
            leftFactPath: "facts.payloadSha256",
            rightEvidenceId: "obs-payload-generation-87",
            rightFactPath: "facts.payloadSha256",
          },
        ],
        valueChecks: [
          {
            evidenceId: "obs-manifest-generation-88",
            factPath: "facts.signatureValid",
            expectedValue: true,
          },
          {
            evidenceId: "obs-payload-generation-87",
            factPath: "facts.schemaValid",
            expectedValue: true,
          },
          {
            evidenceId: "obs-payload-generation-87",
            factPath: "facts.complete",
            expectedValue: true,
          },
        ],
      },
    },
  },
  {
    id: "noop-superseded-amendment",
    title: "Procurement amendment reconciliation",
    description: "Two ordered official revisions and the current canonical solicitation require a maintenance decision.",
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
          "Follow the explicit supersession chain whose effectiveAt is at or before the cutoff",
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
      requiredEvidenceAssessments: [
        { evidenceId: "obs-amendment-42", factPath: "facts.revision", disposition: "CONTEXT", reason: "Revision 42 is a traversed but nonterminal authority occurrence." },
        { evidenceId: "obs-amendment-42", factPath: "facts.supersedes", disposition: "CONTEXT", reason: "Revision 42 links the prior state into the explicit chain." },
        { evidenceId: "obs-rescission-43", factPath: "effectiveAt", disposition: "SUPPORT", reason: "The terminal rescission is effective before the policy cutoff." },
        { evidenceId: "obs-rescission-43", factPath: "facts.revision", disposition: "SUPPORT", reason: "Revision 43 is the terminal authority occurrence materialized in canonical state." },
        { evidenceId: "obs-rescission-43", factPath: "facts.supersedes", disposition: "SUPPORT", reason: "The rescission explicitly supersedes revision 42." },
        { evidenceId: "obs-rescission-43", factPath: "facts.restoresRevision", disposition: "SUPPORT", reason: "The terminal revision restores the state already materialized in canonical data." },
        { evidenceId: "obs-rescission-43", factPath: "facts.deadline", disposition: "SUPPORT", reason: "The terminal deadline matches canonical state." },
      ],
      allowedEvidenceAssessments: [
        { evidenceId: "obs-amendment-42", factPath: "facts.revision", disposition: "CONTEXT", reason: "Revision 42 is a traversed but nonterminal authority occurrence." },
        { evidenceId: "obs-amendment-42", factPath: "facts.supersedes", disposition: "CONTEXT", reason: "Revision 42 links the prior state into the explicit chain." },
        { evidenceId: "obs-rescission-43", factPath: "effectiveAt", disposition: "SUPPORT", reason: "The terminal rescission is effective before the policy cutoff." },
        { evidenceId: "obs-rescission-43", factPath: "facts.revision", disposition: "SUPPORT", reason: "Revision 43 is the terminal authority occurrence materialized in canonical state." },
        { evidenceId: "obs-rescission-43", factPath: "facts.supersedes", disposition: "SUPPORT", reason: "The rescission explicitly supersedes revision 42." },
        { evidenceId: "obs-rescission-43", factPath: "facts.restoresRevision", disposition: "SUPPORT", reason: "The terminal revision restores the state already materialized in canonical data." },
        { evidenceId: "obs-rescission-43", factPath: "facts.deadline", disposition: "SUPPORT", reason: "The terminal deadline matches canonical state." },
        { evidenceId: "obs-amendment-42", factPath: "observedAt", disposition: "CONTEXT", reason: "The publication time is relevant chain context." },
        { evidenceId: "obs-amendment-42", factPath: "effectiveAt", disposition: "CONTEXT", reason: "The intermediate revision is effective before the terminal rescission." },
        { evidenceId: "obs-amendment-42", factPath: "facts.deadline", disposition: "CONTEXT", reason: "The intermediate deadline matters only as superseded context." },
        { evidenceId: "obs-amendment-42", factPath: "facts.deadline", disposition: "REJECT", reason: "The intermediate deadline is unsafe as current authority." },
        { evidenceId: "obs-rescission-43", factPath: "observedAt", disposition: "CONTEXT", reason: "The publication time is relevant terminal-revision context." },
        ...["obs-amendment-42", "obs-rescission-43"].flatMap((evidenceId) => ([
          { evidenceId, factPath: "sourceId", disposition: "SUPPORT" as const, reason: "The procurement register owns the revision chain." },
          { evidenceId, factPath: "subjectId", disposition: "SUPPORT" as const, reason: "The occurrence is bound to the solicitation identity." },
          { evidenceId, factPath: "authorityScope", disposition: "SUPPORT" as const, reason: "The scope covers deadline and revision-chain facts." },
          { evidenceId, factPath: "kind", disposition: "SUPPORT" as const, reason: "The record kind identifies its role in the chain." },
        ])),
      ],
    },
  },
  {
    id: "review-unknown-coordinate-reference",
    title: "Permit jurisdiction reconciliation",
    description: "Official boundary and permit-location records require a jurisdiction maintenance decision under explicit uncertainty rules.",
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
            distanceComputationCrsAssumption: "EPSG:4326",
            distanceInsideUnderAssumptionMeters: 1.2,
            signedJurisdictionDetermination: null,
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
          "An assumed-CRS distance may establish possible boundary overlap but cannot establish jurisdiction",
          "Request reference and accuracy evidence when the possible location overlaps the boundary",
        ],
      })),
    },
    oracle: {
      expectedAction: "HUMAN_REVIEW",
      requiredEvidenceIds: ["obs-official-boundary-2026", "obs-permit-location"],
      allowedChangedFiles: [],
      expectedRecords: [],
      requiredChallengerVerdict: "CONFIRM",
      evidenceAssessmentBundles: [[
        { evidenceId: "obs-official-boundary-2026", factPath: "facts.boundaryVersion", disposition: "SUPPORT", reason: "The signed boundary version controls the comparison geometry." },
        { evidenceId: "obs-official-boundary-2026", factPath: "facts.crs", disposition: "SUPPORT", reason: "The official boundary explicitly declares its coordinate reference system." },
        {
          evidenceId: "obs-permit-location",
          factPath: "facts.crs",
          disposition: "CONTEXT",
          reason: "The null CRS is decisive unresolved context.",
        },
        {
          evidenceId: "obs-permit-location",
          factPath: "facts.positionalAccuracyMeters",
          disposition: "CONTEXT",
          reason: "The missing positional accuracy is decisive unresolved context.",
        },
        {
          evidenceId: "obs-permit-location",
          factPath: "facts.distanceComputationCrsAssumption",
          disposition: "REJECT",
          reason: "The undeclared CRS assumption is not authoritative evidence.",
        },
        { evidenceId: "obs-permit-location", factPath: "facts.distanceInsideUnderAssumptionMeters", disposition: "CONTEXT", reason: "The assumed distance establishes possible boundary overlap without resolving jurisdiction." },
      ]],
      allowedEvidenceAssessments: [
        { evidenceId: "obs-official-boundary-2026", factPath: "facts.boundaryVersion", disposition: "SUPPORT", reason: "The signed boundary version controls the comparison geometry." },
        { evidenceId: "obs-official-boundary-2026", factPath: "facts.crs", disposition: "SUPPORT", reason: "The official boundary explicitly declares its coordinate reference system." },
        { evidenceId: "obs-permit-location", factPath: "facts.crs", disposition: "CONTEXT", reason: "The null CRS is decisive unresolved context." },
        { evidenceId: "obs-permit-location", factPath: "facts.positionalAccuracyMeters", disposition: "CONTEXT", reason: "The missing positional accuracy is decisive unresolved context." },
        { evidenceId: "obs-permit-location", factPath: "facts.distanceComputationCrsAssumption", disposition: "REJECT", reason: "The undeclared CRS assumption is not authoritative evidence." },
        { evidenceId: "obs-permit-location", factPath: "facts.distanceInsideUnderAssumptionMeters", disposition: "CONTEXT", reason: "The assumed distance establishes possible boundary overlap without resolving jurisdiction." },
        { evidenceId: "obs-permit-location", factPath: "facts.coordinates", disposition: "CONTEXT", reason: "Coordinate values are relevant but uninterpretable without a declared CRS." },
        { evidenceId: "obs-official-boundary-2026", factPath: "facts.geometrySha256", disposition: "SUPPORT", reason: "The geometry hash identifies the controlled boundary artifact." },
        ...["obs-official-boundary-2026", "obs-permit-location"].flatMap((evidenceId) => ([
          { evidenceId, factPath: "sourceId", disposition: "SUPPORT" as const, reason: "The official source owns its scoped record." },
          { evidenceId, factPath: "subjectId", disposition: "SUPPORT" as const, reason: "The record is bound to the permit identity." },
          { evidenceId, factPath: "authorityScope", disposition: "SUPPORT" as const, reason: "The scope identifies the authoritative fields." },
          { evidenceId, factPath: "kind", disposition: "SUPPORT" as const, reason: "The record kind identifies its decision role." },
          { evidenceId, factPath: "observedAt", disposition: "CONTEXT" as const, reason: "The capture time is relevant case context." },
          { evidenceId, factPath: "effectiveAt", disposition: "CONTEXT" as const, reason: "The effective time is relevant case context." },
        ])),
      ],
      acceptableReviewRequests: [
        {
          subjectId: "permit-204",
          targetEvidenceId: "obs-permit-location",
          requestedFactPaths: ["facts.crs", "facts.positionalAccuracyMeters"],
        },
      ],
    },
  },
];

export const HOLDOUT_CASE_IDS = definitions.map((definition) => definition.id) as readonly string[];

export async function writeCase(root: string, definition: HoldoutDefinition): Promise<void> {
  const caseDir = resolve(root, definition.id);
  await rm(caseDir, { recursive: true, force: true });
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
  for (const [relativePath, content] of Object.entries(definition.verifierFiles ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
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
  const defaultEvidenceAssessments = definition.oracle.requiredEvidenceAssessments ??
    definition.oracle.requiredEvidenceIds.map((evidenceId) => ({
      evidenceId,
      factPath: "$",
      disposition: "SUPPORT" as const,
      reason: "This observation is required by the adjudicated causal route.",
    }));
  const evidenceAssessmentBundles = definition.oracle.evidenceAssessmentBundles ?? [defaultEvidenceAssessments];
  const allowedEvidenceAssessments = definition.oracle.allowedEvidenceAssessments ??
    evidenceAssessmentBundles.flat();
  await writeFile(resolve(caseDir, "oracle.json"), json({
    schemaVersion: 2,
    caseId: definition.id,
    expectedAction: definition.oracle.expectedAction,
    evidenceAssessmentBundles,
    allowedEvidenceAssessments,
    requiredChallengerEvidenceIds: definition.oracle.requiredChallengerEvidenceIds ??
      definition.oracle.requiredEvidenceIds,
    allowedChangedFiles: definition.oracle.allowedChangedFiles,
    expectedRecords: definition.oracle.expectedRecords,
    requiredChallengerVerdict: definition.oracle.requiredChallengerVerdict,
    acceptableReviewRequests: definition.oracle.acceptableReviewRequests ?? [],
    expectedRetryPlan: definition.oracle.expectedRetryPlan ?? null,
    expectedCommandExitCodes: definition.oracle.expectedCommandExitCodes ?? {},
    hiddenProbePath: definition.oracle.hiddenProbePath ?? null,
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
