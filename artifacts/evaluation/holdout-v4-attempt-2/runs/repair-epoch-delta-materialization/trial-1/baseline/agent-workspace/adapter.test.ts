import assert from "node:assert/strict";
import test from "node:test";
import { materializeEpoch } from "./adapter.ts";

test("materializes one complete epoch", () => {
  assert.deepEqual(materializeEpoch([
    { epoch: 1, sequence: 0, kind: "BEGIN" },
    { epoch: 1, sequence: 1, kind: "UPSERT", key: "a", value: 1 },
    { epoch: 1, sequence: 2, kind: "COMMIT" },
  ]), [{ key: "a", value: 1 }]);
});

test("isolates and orders the greatest complete epoch", () => {
  assert.deepEqual(materializeEpoch([
    { epoch: 4, sequence: 0, kind: "BEGIN" },
    { epoch: 4, sequence: 1, kind: "UPSERT", key: "shared", value: 4 },
    { epoch: 4, sequence: 2, kind: "UPSERT", key: "old", value: 8 },
    { epoch: 4, sequence: 3, kind: "COMMIT" },
    { epoch: 5, sequence: 0, kind: "BEGIN" },
    { epoch: 5, sequence: 2, kind: "DELETE", key: "shared" },
    { epoch: 5, sequence: 1, kind: "UPSERT", key: "shared", value: 9 },
    { epoch: 5, sequence: 3, kind: "UPSERT", key: "current", value: 10 },
    { epoch: 5, sequence: 4, kind: "COMMIT" },
  ]), [{ key: "current", value: 10 }]);
});

test("throws when no complete valid epoch exists", () => {
  assert.throws(() => materializeEpoch([
    { epoch: 6, sequence: 0, kind: "BEGIN" },
    { epoch: 6, sequence: 1, kind: "UPSERT", key: "partial", value: 6 },
  ]), /No complete valid epoch/);
});
