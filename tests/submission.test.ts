import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  verifyPublicReports,
  verifySelectedV4Campaign,
  verifySubmission,
} from "../scripts/verify-submission.ts";

const publicMarkdown = [
  "README.md",
  "docs/architecture.md",
  "docs/evaluation.md",
  "docs/improvement-changelog.md",
  "docs/reproduction.md",
  "docs/trajectory-index.md",
  "docs/video-script.md",
];

const packageFiles = [
  "LICENSE",
  "Dockerfile",
  ".dockerignore",
  "package.json",
  "schemas/decision-package.schema.json",
  "schemas/challenger-critique.schema.json",
  "src/core/schemas.ts",
  "src/core/case-loader.ts",
  "src/workflows/finalize-decision.ts",
  "src/workflows/baseline.ts",
  "src/workflows/advanced.ts",
  "src/core/semantic-evaluator.ts",
  "src/evaluation/score-run.ts",
  "src/evaluation/aggregate.ts",
  "src/evaluation/run-evaluation.ts",
  "src/evaluation/adjudicate.ts",
  "src/reports/load-artifacts.ts",
  "src/reports/render-decision-report.ts",
  "src/ui/public-comparison.ts",
  "src/ui/overview-model.ts",
  "src/ui/case-model.ts",
  "src/release/public-tree.ts",
  "src/release/selected-v4.ts",
  "scripts/adjudicate-evaluation.ts",
  "scripts/generate-selected-reports.ts",
  "app/page.tsx",
  "app/cases/[caseId]/page.tsx",
];

const invalidatedCampaigns = ["holdout-v1", "holdout-v2", "holdout-v3"];

async function write(root: string, relativePath: string, value = "fixture\n"): Promise<void> {
  const path = join(root, ...relativePath.split("/"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}

async function writeJson(root: string, relativePath: string, value: unknown): Promise<void> {
  await write(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function pendingSelection() {
  return {
    schemaVersion: 1,
    status: "PENDING_VALID_V4_CAMPAIGN",
    selectedCampaign: null as string | null,
    selectedSummary: null as string | null,
    selectionRule: "Select only a completed, non-invalidated V4 campaign.",
    excludedCampaigns: invalidatedCampaigns.map((campaign) => ({
      campaign,
      invalidation: `holdout/INVALIDATION-v${campaign.at(-1)}.json`,
    })),
  };
}

async function makePendingFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "evidence-submission-v4-"));
  for (const relativePath of [...publicMarkdown, ...packageFiles]) {
    await write(root, relativePath, relativePath === "package.json" ? "{}\n" : "fixture\n");
  }
  for (const campaign of invalidatedCampaigns) {
    await writeJson(root, `holdout/INVALIDATION-v${campaign.at(-1)}.json`, {
      schemaVersion: 1,
      campaign,
      status: "INVALID_FOR_SYSTEM_COMPARISON",
      publicComparisonEligible: false,
      reason: "Preserved as invalid historical evidence.",
    });
  }
  await writeJson(root, "config/public-comparison.json", pendingSelection());
  return root;
}

test("submission verification rejects an incomplete package", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-submission-missing-"));
  await assert.rejects(
    () => verifySubmission(root, { checkGit: false }),
    /Missing required file: README\.md/,
  );
});

test("pending V4 comparison is a valid explicit release state", async () => {
  const root = await makePendingFixture();
  await write(root, "artifacts/evaluation/final-v3/summary.json", "not-json\n");

  const result = await verifySubmission(root, { checkGit: false });

  assert.equal(result.comparisonState, "pending");
  assert.equal(result.selectedCampaign, null);
  assert.equal(result.selectedSummary, null);
  assert.deepEqual(result.invalidatedCampaigns, invalidatedCampaigns);
});

test("pending release rejects a missing historical invalidation disclosure", async () => {
  const root = await makePendingFixture();
  await rm(join(root, "holdout", "INVALIDATION-v2.json"), { force: true });

  await assert.rejects(
    () => verifySubmission(root, { checkGit: false }),
    /Missing invalidation disclosure for holdout-v2/,
  );
});

test("release rejects selecting an invalidated campaign", async () => {
  const root = await makePendingFixture();
  const selection = pendingSelection();
  selection.status = "SELECTED";
  selection.selectedCampaign = "holdout-v3";
  selection.selectedSummary = "artifacts/evaluation/holdout-v3/summary.json";
  await writeJson(root, "config/public-comparison.json", selection);

  await assert.rejects(
    () => verifySubmission(root, { checkGit: false }),
    /Invalidated campaign cannot be selected: holdout-v3/,
  );
});

test("release rejects any campaign declared invalidated, including a V4 campaign", async () => {
  const root = await makePendingFixture();
  const selection = pendingSelection();
  selection.status = "SELECTED";
  selection.selectedCampaign = "holdout-v4-retired";
  selection.selectedSummary = "artifacts/evaluation/holdout-v4-retired/summary.json";
  selection.excludedCampaigns.push({
    campaign: "holdout-v4-retired",
    invalidation: "holdout/INVALIDATION-v4-retired.json",
  });
  await writeJson(root, "holdout/INVALIDATION-v4-retired.json", {
    schemaVersion: 1,
    campaign: "holdout-v4-retired",
    status: "INVALID_FOR_SYSTEM_COMPARISON",
    publicComparisonEligible: false,
  });
  await writeJson(root, "config/public-comparison.json", selection);

  await assert.rejects(
    () => verifySubmission(root, { checkGit: false }),
    /Invalidated campaign cannot be selected: holdout-v4-retired/,
  );
});

test("release rejects an incomplete V4 source, schema, report, or UI package", async () => {
  const root = await makePendingFixture();
  await rm(join(root, "src", "core", "semantic-evaluator.ts"), { force: true });

  await assert.rejects(
    () => verifySubmission(root, { checkGit: false }),
    /Missing required file: src\/core\/semantic-evaluator\.ts/,
  );
});

test("release rejects internal planning files from the public tree", async () => {
  const root = await makePendingFixture();
  await write(root, "docs/superpowers/plans/internal-release.md", "Use C:\\Work\\private before push.\n");

  await assert.rejects(
    () => verifySubmission(root, { checkGit: false }),
    /Forbidden internal release file/,
  );
});

test("selected V4 validator accepts the exact frozen attempt-2 campaign", async () => {
  const result = await verifySelectedV4Campaign(
    resolve("."),
    "holdout-v4-attempt-2",
    "artifacts/evaluation/holdout-v4-attempt-2/summary.json",
  );

  assert.equal(result.workflowRunCount, 24);
  assert.equal(result.modelSessionCount, 48);
  assert.equal(result.selectedCaseCount, 5);
  assert.equal(result.includedCaseCount, 4);
  assert.equal(result.invalidatedCaseCount, 1);
  assert.equal(result.caseSetHash, "110fa96bdc104cf612c18d904d11dbb27537d3c8b7d587f181a05f58eaad24d1");
});

test("selected V4 validator rejects aggregate tampering", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-selected-v4-tamper-"));
  await cp(
    resolve("artifacts", "evaluation", "holdout-v4-attempt-2"),
    join(root, "artifacts", "evaluation", "holdout-v4-attempt-2"),
    { recursive: true },
  );
  await cp(resolve("holdout", "v4"), join(root, "holdout", "v4"), { recursive: true });
  for (const relativePath of [
    "prompts/baseline.md",
    "prompts/maintainer.md",
    "prompts/challenger.md",
    "prompts/revision.md",
    "schemas/decision-package.schema.json",
    "schemas/challenger-critique.schema.json",
  ]) {
    await write(root, relativePath, await readFile(resolve(...relativePath.split("/")), "utf8"));
  }
  const summaryPath = join(root, "artifacts", "evaluation", "holdout-v4-attempt-2", "summary.json");
  const summary = JSON.parse(await readFile(summaryPath, "utf8")) as { absoluteOdiChange: number };
  summary.absoluteOdiChange = 1;
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  await assert.rejects(
    () => verifySelectedV4Campaign(
      root,
      "holdout-v4-attempt-2",
      "artifacts/evaluation/holdout-v4-attempt-2/summary.json",
      { verifyGit: false },
    ),
    /aggregate metrics do not match re-derived row evidence|deterministic adjudication/,
  );
});

test("public report verification binds every included case and rejects tampering", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-public-reports-"));
  const campaign = "holdout-v4-attempt-2";
  const selectedSummary = `artifacts/evaluation/${campaign}/summary.json`;
  const caseSetHash = "110fa96bdc104cf612c18d904d11dbb27537d3c8b7d587f181a05f58eaad24d1";
  await mkdir(join(root, "artifacts", "evaluation"), { recursive: true });
  await mkdir(join(root, "public"), { recursive: true });
  await mkdir(join(root, "holdout", "v4"), { recursive: true });
  await cp(resolve("artifacts", "evaluation", campaign), join(root, "artifacts", "evaluation", campaign), {
    recursive: true,
  });
  await cp(resolve("public", "reports"), join(root, "public", "reports"), { recursive: true });
  await cp(
    resolve("holdout", "v4", "EVALUATOR-INVALIDATION-retry-signed-release-quorum.json"),
    join(root, "holdout", "v4", "EVALUATOR-INVALIDATION-retry-signed-release-quorum.json"),
  );

  await verifyPublicReports(root, campaign, selectedSummary, caseSetHash);
  await write(root, "public/reports/stale.html", "stale");
  await assert.rejects(
    verifyPublicReports(root, campaign, selectedSummary, caseSetHash),
    /Unexpected public report file: stale\.html/,
  );
  await rm(join(root, "public", "reports", "stale.html"));
  const reportPath = join(root, "public", "reports", "noop-post-cutoff-reclassification.html");
  await writeFile(reportPath, `${await readFile(reportPath, "utf8")}\ntampered`, "utf8");
  await assert.rejects(
    verifyPublicReports(root, campaign, selectedSummary, caseSetHash),
    /Public report hash mismatch: noop-post-cutoff-reclassification/,
  );
});

test("current repository has an explicit public comparison state", async () => {
  const result = await verifySubmission(resolve("."), { checkGit: false });
  assert.equal(result.comparisonState, "selected");
  assert.equal(result.selectedCampaign, "holdout-v4-attempt-2");
  assert.equal(result.selectedWorkflowRunCount, 24);
  assert.equal(result.caseSetHash, "110fa96bdc104cf612c18d904d11dbb27537d3c8b7d587f181a05f58eaad24d1");
});
