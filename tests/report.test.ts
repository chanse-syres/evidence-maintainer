import assert from "node:assert/strict";
import test, { before } from "node:test";
import { renderDecisionReport } from "../src/reports/render-decision-report.ts";
import { writeV4EvaluationFixture } from "./helpers/v4-run-fixture.ts";

let baselineRun: string;
let advancedRun: string;

before(async () => {
  ({ baselineRun, advancedRun } = await writeV4EvaluationFixture());
});

test("decision report renders the V4 final decision and verification sections", async () => {
  const html = await renderDecisionReport(advancedRun);
  for (const heading of [
    "Recorded evidence",
    "Selected action",
    "Evidence timeline",
    "Final decision",
    "Deterministic checks",
    "Changed files",
    "Residual uncertainty",
    "Eligibility decision",
    "Artifact hashes",
  ]) {
    assert.match(html, new RegExp(`>${heading}<`));
  }
  assert.doesNotMatch(html, /Live agent result/);
  assert.match(html, /NO_ACTION/);
  assert.match(html, /obs-v4-report-case/);
  assert.match(html, /<style>/);
  assert.doesNotMatch(html, /<script|https?:\/\//);
});

test("baseline report renders without an advanced evidence ledger", async () => {
  const html = await renderDecisionReport(baselineRun);
  assert.match(html, /No recorded evidence events\./);
  assert.match(html, /Final decision/);
});

test("decision report escapes agent-controlled text", async () => {
  const html = await renderDecisionReport(advancedRun, {
    titleOverride: '<img src=x onerror="alert(1)">',
  });
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
});
