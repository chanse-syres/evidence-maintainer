import assert from "node:assert/strict";
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
