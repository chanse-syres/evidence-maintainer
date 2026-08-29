import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { renderDecisionReport } from "../src/reports/render-decision-report.ts";

const recordedRun = resolve(
  "artifacts/evaluation/recorded-all/runs/update-official-commitment/trial-1/advanced",
);

test("decision report renders every evidence and approval section", async () => {
  const html = await renderDecisionReport(recordedRun);
  for (const heading of [
    "Recorded evidence",
    "Selected action",
    "Evidence timeline",
    "Maintainer proposal",
    "Challenger verdict",
    "Deterministic checks",
    "Changed files",
    "Residual risk",
    "Approval decision",
    "Artifact hashes",
  ]) {
    assert.match(html, new RegExp(`>${heading}<`));
  }
  assert.doesNotMatch(html, /Live agent result/);
  assert.match(html, /UPDATE_DATA/);
  assert.match(html, /obs-official-commitment/);
  assert.match(html, /<style>/);
  assert.doesNotMatch(html, /<script|https?:\/\//);
});

test("decision report escapes agent-controlled text", async () => {
  const html = await renderDecisionReport(recordedRun, {
    titleOverride: '<img src=x onerror="alert(1)">',
  });
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
});
