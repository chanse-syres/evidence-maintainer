import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { verifySubmission } from "../scripts/verify-submission.ts";

test("submission verification rejects an incomplete package", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-submission-missing-"));
  await assert.rejects(
    () => verifySubmission(root, { checkGit: false }),
    /Missing required file: README\.md/,
  );
});

test("submission verification proves the complete offline and live evidence package", async () => {
  const result = await verifySubmission(resolve("."), { checkGit: false });
  assert.equal(result.caseCount, 15);
  assert.equal(result.reportCount, 15);
  assert.deepEqual(result.roles, ["baseline", "challenger", "maintainer"]);
  assert.equal(result.liveTrajectoryCount, 45);
  assert.ok(result.recordedTrajectoryCount >= 45);
});
