import assert from "node:assert/strict";
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
