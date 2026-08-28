import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { loadPublicCase } from "../src/core/case-loader.ts";
import { buildEvidenceLedger } from "../src/core/evidence-ledger.ts";

test("evidence ledger is ordered, sequential, evidence-linked, and deterministic", async () => {
  const loaded = await loadPublicCase(resolve("cases", "noop-duplicate-news"));
  const first = buildEvidenceLedger(loaded);
  const second = buildEvidenceLedger(loaded);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((event) => event.seq), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(
    first.filter((event) => event.kind === "SOURCE_OBSERVATION").map((event) => event.payload.id),
    ["obs-1", "obs-2"],
  );
  for (const event of first) {
    assert.match(event.sha256, /^[a-f0-9]{64}$/);
    if (event.kind === "SOURCE_OBSERVATION") {
      assert.ok(event.evidenceIds.length > 0);
    }
  }
});

test("ledger output cannot mutate the loaded source values", async () => {
  const loaded = await loadPublicCase(resolve("cases", "noop-duplicate-news"));
  const ledger = buildEvidenceLedger(loaded);
  const observation = ledger.find((event) => event.kind === "SOURCE_OBSERVATION");
  assert.ok(observation);
  observation.payload.kind = "tampered";
  assert.equal(loaded.observations[0].kind, "commitment-report");
});
