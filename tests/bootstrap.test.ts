import assert from "node:assert/strict";
import test from "node:test";
import { PROJECT_ID, PROJECT_TITLE } from "../src/core/project.ts";

test("project identity is stable for artifact manifests", () => {
  assert.equal(PROJECT_ID, "evidence-maintainer");
  assert.equal(PROJECT_TITLE, "Evidence Maintainer");
});
