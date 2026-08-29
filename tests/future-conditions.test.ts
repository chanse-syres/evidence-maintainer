import assert from "node:assert/strict";
import test from "node:test";
import { conditionMatches, evaluateFutureConditions } from "../src/core/future-conditions.ts";
import {
  FutureConditionSchema,
  SourceObservationSchema,
  type SourceObservation,
} from "../src/core/schemas.ts";

function observation(overrides: Partial<SourceObservation> = {}): SourceObservation {
  return SourceObservationSchema.parse({
    id: "future-1",
    sourceId: "official-roster",
    observedAt: "2026-08-30T18:00:00.000Z",
    effectiveAt: "2026-08-30T17:30:00.000Z",
    authorityScope: ["status"],
    subjectId: "athlete-7",
    kind: "roster-entry",
    status: 200,
    contentType: "application/json",
    schemaFingerprint: "roster-v2",
    facts: { status: "active", generation: 12, note: null },
    ...overrides,
  });
}

const condition = FutureConditionSchema.parse({
  selector: {
    sourceId: "official-roster",
    subjectId: "athlete-7",
    kind: "roster-entry",
    factPath: "facts.generation",
  },
  operator: "GREATER_THAN_OR_EQUAL",
  expectedValue: 12,
});
test("future condition accepts a satisfying observation and rejects selector/value near misses", () => {
  assert.equal(conditionMatches(condition, [observation()]), true);
  assert.equal(conditionMatches(condition, [observation({ sourceId: "news-feed" })]), false);
  assert.equal(conditionMatches(condition, [observation({ subjectId: "athlete-8" })]), false);
  assert.equal(conditionMatches(condition, [observation({ facts: { generation: 11 } })]), false);
});

test("future condition EXISTS distinguishes present null from a missing fact", () => {
  const exists = FutureConditionSchema.parse({
    selector: {
      sourceId: "official-roster",
      subjectId: "athlete-7",
      kind: null,
      factPath: "facts.note",
    },
    operator: "EXISTS",
    expectedValue: null,
  });
  assert.equal(conditionMatches(exists, [observation()]), true);
  assert.equal(conditionMatches(exists, [observation({ facts: {} })]), false);
});

test("future condition numeric operators reject nonnumeric operands", () => {
  assert.equal(conditionMatches(condition, [observation({ facts: { generation: "12" } })]), false);
});

test("future condition evaluation reports every satisfied condition index in declaration order", () => {
  const equals = FutureConditionSchema.parse({
    selector: {
      sourceId: "official-roster",
      subjectId: "athlete-7",
      kind: null,
      factPath: "facts.status",
    },
    operator: "EQUALS",
    expectedValue: "active",
  });
  const result = evaluateFutureConditions([condition, equals], [observation()]);
  assert.deepEqual(result, { passed: true, matchedConditionIndexes: [0, 1] });
  assert.deepEqual(
    evaluateFutureConditions([condition, equals], [observation({ facts: { generation: 12, status: "inactive" } })]),
    { passed: false, matchedConditionIndexes: [0] },
  );
});
