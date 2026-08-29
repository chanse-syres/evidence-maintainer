import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAuthorityValidity } from "../src/core/authority-validity.ts";
import { readFactPath } from "../src/core/fact-path.ts";
import {
  PolicyV4Schema,
  SourceObservationSchema,
  type AuthorityValidity,
  type SourceObservation,
} from "../src/core/schemas.ts";

const cutoff = "2026-08-29T20:00:00.000Z";

function observation(input: Partial<SourceObservation> & Pick<SourceObservation, "id" | "sourceId" | "observedAt">): SourceObservation {
  return SourceObservationSchema.parse({
    effectiveAt: null,
    authorityScope: ["status"],
    subjectId: "subject-1",
    kind: "status-event",
    status: 200,
    contentType: "application/json",
    schemaFingerprint: "fixture-v1",
    facts: {},
    ...input,
  });
}

function policy(authorityValidity: AuthorityValidity[]) {
  return PolicyV4Schema.parse({
    schemaVersion: 2,
    cutoff,
    authorityByField: { status: authorityValidity[0]?.sourceId ?? "official" },
    authorityValidity,
    retryLimit: 2,
    invariants: ["Identity is stable"],
    rules: ["Use the declared validity mode"],
  });
}

test("fact path distinguishes a missing value from present null", () => {
  assert.deepEqual(readFactPath({ facts: { status: null } }, "facts.status"), { found: true, value: null });
  assert.deepEqual(readFactPath({ facts: {} }, "facts.status"), { found: false });
  assert.deepEqual(readFactPath({ facts: Object.create({ status: "inherited" }) }, "facts.status"), { found: false });
});

test("authority validity SNAPSHOT_MAX_AGE compares observedAt with the policy cutoff", () => {
  const result = evaluateAuthorityValidity(policy([{
    mode: "SNAPSHOT_MAX_AGE",
    sourceId: "official-snapshot",
    authorityScope: "status",
    maxAgeMinutes: 60,
  }]), [
    observation({ id: "fresh", sourceId: "official-snapshot", observedAt: "2026-08-29T19:30:00.000Z" }),
    observation({ id: "stale", sourceId: "official-snapshot", observedAt: "2026-08-29T18:59:59.000Z" }),
    observation({ id: "future", sourceId: "official-snapshot", observedAt: "2026-08-29T20:00:01.000Z" }),
  ]);
  assert.deepEqual(result.validObservationIds, ["fresh"]);
  assert.deepEqual(result.violations, [
    "SNAPSHOT_MAX_AGE:official-snapshot:status:future is after the cutoff",
    "SNAPSHOT_MAX_AGE:official-snapshot:status:stale exceeds max age",
  ]);
});

test("authority validity EFFECTIVE_UNTIL_SUPERSEDED selects the latest applicable entry per subject", () => {
  const result = evaluateAuthorityValidity(policy([{
    mode: "EFFECTIVE_UNTIL_SUPERSEDED",
    sourceId: "signed-register",
    authorityScope: "status",
    applicabilityFactPath: "facts.applies",
  }]), [
    observation({
      id: "older",
      sourceId: "signed-register",
      observedAt: "2026-08-29T18:00:00.000Z",
      effectiveAt: "2026-08-29T17:00:00.000Z",
      facts: { applies: true, status: "pending" },
    }),
    observation({
      id: "current",
      sourceId: "signed-register",
      observedAt: "2026-08-29T19:00:00.000Z",
      effectiveAt: "2026-08-29T18:00:00.000Z",
      facts: { applies: "subject-1", status: "active" },
    }),
    observation({
      id: "different-subject-unbound",
      sourceId: "signed-register",
      observedAt: "2026-08-29T19:30:00.000Z",
      effectiveAt: "2026-08-29T19:00:00.000Z",
      subjectId: "subject-2",
      facts: { status: "active" },
    }),
  ]);
  assert.deepEqual(result.validObservationIds, ["current"]);
  assert.deepEqual(result.violations, [
    "EFFECTIVE_UNTIL_SUPERSEDED:signed-register:status:different-subject-unbound lacks an applicability binding",
  ]);
});

test("authority validity EVENT_AT_CUTOFF chooses the latest event state at or before cutoff", () => {
  const result = evaluateAuthorityValidity(policy([{
    mode: "EVENT_AT_CUTOFF",
    sourceId: "event-log",
    authorityScope: "status",
    eventFactPath: "facts.eventType",
  }]), [
    observation({
      id: "earlier-event",
      sourceId: "event-log",
      observedAt: "2026-08-29T17:00:00.000Z",
      effectiveAt: "2026-08-29T17:00:00.000Z",
      facts: { eventType: "OPENED" },
    }),
    observation({
      id: "cutoff-state",
      sourceId: "event-log",
      observedAt: "2026-08-29T19:00:00.000Z",
      effectiveAt: "2026-08-29T19:00:00.000Z",
      facts: { eventType: "APPROVED" },
    }),
    observation({
      id: "after-cutoff",
      sourceId: "event-log",
      observedAt: "2026-08-29T20:30:00.000Z",
      effectiveAt: "2026-08-29T20:30:00.000Z",
      facts: { eventType: "REVOKED" },
    }),
  ]);
  assert.deepEqual(result.validObservationIds, ["cutoff-state"]);
  assert.deepEqual(result.violations, [
    "EVENT_AT_CUTOFF:event-log:status:after-cutoff occurs after the cutoff",
  ]);
});
