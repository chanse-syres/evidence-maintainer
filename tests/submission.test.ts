import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { verifySubmission } from "../scripts/verify-submission.ts";

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
  "src/reports/load-artifacts.ts",
  "src/reports/render-decision-report.ts",
  "src/ui/public-comparison.ts",
  "src/ui/overview-model.ts",
  "src/ui/case-model.ts",
  "src/release/public-tree.ts",
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

test("selected V4 comparison remains blocked until the real validator exists", async () => {
  const root = await makePendingFixture();
  const selection = pendingSelection();
  selection.status = "SELECTED_VALID_V4_CAMPAIGN";
  selection.selectedCampaign = "holdout-v4-public";
  selection.selectedSummary = "artifacts/evaluation/holdout-v4-public/summary.json";
  await writeJson(root, "config/public-comparison.json", selection);

  await assert.rejects(
    () => verifySubmission(root, { checkGit: false }),
    /Selected V4 comparison is blocked until the real V4 freeze and campaign validator is implemented/,
  );
});

test("current repository has an explicit public comparison state", async () => {
  const result = await verifySubmission(resolve("."), { checkGit: false });
  assert.equal(result.comparisonState, "pending");
  assert.equal(result.selectedCampaign, null);
});
