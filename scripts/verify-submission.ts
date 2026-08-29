import { execFile } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { verifyPublicTree } from "../src/release/public-tree.ts";

const execFileAsync = promisify(execFile);

export interface SubmissionVerificationOptions {
  checkGit?: boolean;
}

const REQUIRED_FILES = [
  "README.md",
  "LICENSE",
  "Dockerfile",
  ".dockerignore",
  "package.json",
  "docs/architecture.md",
  "docs/evaluation.md",
  "docs/improvement-changelog.md",
  "docs/reproduction.md",
  "docs/trajectory-index.md",
  "docs/video-script.md",
  "config/public-comparison.json",
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
] as const;

const PUBLIC_MARKDOWN = [
  "README.md",
  "docs/architecture.md",
  "docs/evaluation.md",
  "docs/improvement-changelog.md",
  "docs/reproduction.md",
  "docs/trajectory-index.md",
  "docs/video-script.md",
] as const;

const REQUIRED_INVALIDATED_CAMPAIGNS = ["holdout-v1", "holdout-v2", "holdout-v3"] as const;
const IGNORED_DIRECTORY_NAMES = new Set([".git", ".next", "node_modules"]);
const FORBIDDEN_FILE_NAMES = new Set([
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "secrets.json",
]);

interface PublicComparisonConfig {
  schemaVersion: number;
  status: string;
  selectedCampaign: string | null;
  selectedSummary: string | null;
  selectionRule: string;
  excludedCampaigns: Array<{ campaign: string; invalidation: string }>;
}

interface InvalidationDisclosure {
  schemaVersion: number;
  campaign: string;
  status: string;
  publicComparisonEligible?: boolean;
}

export interface SubmissionVerificationResult {
  root: string;
  requiredFileCount: number;
  caseCount: number;
  reportCount: number;
  comparisonState: "pending" | "selected";
  selectedCampaign: string | null;
  selectedSummary: string | null;
  selectedWorkflowRunCount: number;
  invalidatedCampaigns: string[];
  caseSetHash: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedRelativePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    !/^[A-Za-z]:/.test(value) &&
    !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  );
}

async function readJson<T>(path: string): Promise<T> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON: ${path}`, { cause: error });
  }
  return value as T;
}

async function listFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) output.push(path);
    }
  }
  await visit(root);
  return output;
}

async function verifyMarkdown(root: string): Promise<void> {
  const absolutePathPattern = /(?:\b[A-Za-z]:[\\/]|\/Users\/)/;
  const markdownLinkPattern = /\[[^\]]*\]\(([^)]+)\)/g;

  for (const relativePath of PUBLIC_MARKDOWN) {
    const path = resolve(root, ...relativePath.split("/"));
    const text = await readFile(path, "utf8");
    if (absolutePathPattern.test(text)) {
      throw new Error(`Public documentation contains a local absolute path: ${relativePath}`);
    }
    for (const match of text.matchAll(markdownLinkPattern)) {
      const rawTarget = match[1]?.trim().replace(/^<|>$/g, "");
      if (!rawTarget || /^(?:https?:|mailto:|#)/i.test(rawTarget)) continue;
      const targetWithoutAnchor = rawTarget.split("#", 1)[0];
      if (!targetWithoutAnchor) continue;
      try {
        await access(resolve(dirname(path), decodeURIComponent(targetWithoutAnchor)));
      } catch {
        throw new Error(`Broken Markdown link in ${relativePath}: ${rawTarget}`);
      }
    }
  }
}

async function verifyNoCredentialFiles(root: string): Promise<void> {
  for (const path of await listFiles(root)) {
    const name = basename(path).toLowerCase();
    const forbiddenEnvironmentFile =
      (name === ".env" || name.startsWith(".env.")) && name !== ".env.example";
    if (forbiddenEnvironmentFile || FORBIDDEN_FILE_NAMES.has(name)) {
      throw new Error(`Credential-like file must not be submitted: ${path}`);
    }
  }
}

async function verifyCleanGit(root: string): Promise<void> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
    cwd: root,
    windowsHide: true,
  });
  if (stdout.trim()) throw new Error("Git worktree is not clean");
}

async function verifyInvalidations(
  root: string,
  config: PublicComparisonConfig,
): Promise<string[]> {
  if (!Array.isArray(config.excludedCampaigns)) {
    throw new Error("Public comparison config has no invalidation registry");
  }
  const disclosed: string[] = [];
  for (const campaign of REQUIRED_INVALIDATED_CAMPAIGNS) {
    const entry = config.excludedCampaigns.find((candidate) => candidate?.campaign === campaign);
    if (!entry || !normalizedRelativePath(entry.invalidation)) {
      throw new Error(`Missing invalidation disclosure for ${campaign}`);
    }
    const path = resolve(root, ...entry.invalidation.split("/"));
    try {
      await access(path);
    } catch (error) {
      throw new Error(`Missing invalidation disclosure for ${campaign}`, { cause: error });
    }
    const invalidation = await readJson<InvalidationDisclosure>(path);
    if (
      invalidation.schemaVersion !== 1 ||
      invalidation.campaign !== campaign ||
      typeof invalidation.status !== "string" ||
      !invalidation.status.includes("INVALID") ||
      invalidation.publicComparisonEligible === true
    ) {
      throw new Error(`Invalid invalidation disclosure for ${campaign}`);
    }
    disclosed.push(campaign);
  }
  return disclosed;
}

function parsePublicComparisonConfig(value: unknown): PublicComparisonConfig {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("Invalid public comparison config");
  }
  if (
    typeof value.status !== "string" || !value.status ||
    typeof value.selectionRule !== "string" || !value.selectionRule ||
    !(value.selectedCampaign === null || typeof value.selectedCampaign === "string") ||
    !(value.selectedSummary === null || typeof value.selectedSummary === "string") ||
    !Array.isArray(value.excludedCampaigns)
  ) {
    throw new Error("Invalid public comparison config");
  }
  if ((value.selectedCampaign === null) !== (value.selectedSummary === null)) {
    throw new Error("Public comparison campaign and summary must be selected together");
  }
  return value as unknown as PublicComparisonConfig;
}

function verifySelectedV4Summary(campaign: string): never {
  throw new Error(
    `Selected V4 comparison is blocked until the real V4 freeze and campaign validator is implemented: ${campaign}`,
  );
}

async function countDirectories(path: string): Promise<number> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

export async function verifySubmission(
  root: string,
  options: SubmissionVerificationOptions = {},
): Promise<SubmissionVerificationResult> {
  const absoluteRoot = resolve(root);
  for (const relativePath of REQUIRED_FILES) {
    try {
      await access(resolve(absoluteRoot, ...relativePath.split("/")));
    } catch {
      throw new Error(`Missing required file: ${relativePath}`);
    }
  }

  const config = parsePublicComparisonConfig(
    await readJson(resolve(absoluteRoot, "config", "public-comparison.json")),
  );
  const invalidatedCampaigns = await verifyInvalidations(absoluteRoot, config);
  let comparisonState: "pending" | "selected";
  const selectedWorkflowRunCount = 0;
  const caseSetHash: string | null = null;
  if (config.selectedCampaign === null || config.selectedSummary === null) {
    if (config.status !== "PENDING_VALID_V4_CAMPAIGN") {
      throw new Error("A release with no selected comparison must declare the pending V4 state");
    }
    comparisonState = "pending";
  } else {
    if (
      config.excludedCampaigns.some((entry) => entry?.campaign === config.selectedCampaign)
    ) {
      throw new Error(`Invalidated campaign cannot be selected: ${config.selectedCampaign}`);
    }
    verifySelectedV4Summary(config.selectedCampaign);
  }

  await verifyPublicTree(absoluteRoot);
  await verifyMarkdown(absoluteRoot);
  await verifyNoCredentialFiles(absoluteRoot);
  if (options.checkGit !== false) await verifyCleanGit(absoluteRoot);

  return {
    root: absoluteRoot,
    requiredFileCount: REQUIRED_FILES.length,
    caseCount: await countDirectories(resolve(absoluteRoot, "cases")),
    reportCount: await countDirectories(resolve(absoluteRoot, "artifacts", "demo", "reports")),
    comparisonState,
    selectedCampaign: config.selectedCampaign,
    selectedSummary: config.selectedSummary,
    selectedWorkflowRunCount,
    invalidatedCampaigns,
    caseSetHash,
  };
}

async function main(): Promise<void> {
  const checkGit = !process.argv.includes("--skip-git");
  const rootArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
  const result = await verifySubmission(rootArgument ?? process.cwd(), { checkGit });
  console.log("SUBMISSION_READY");
  console.log(JSON.stringify(result, null, 2));
}

const isDirectInvocation =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectInvocation) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
