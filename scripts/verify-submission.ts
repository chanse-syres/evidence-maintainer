import { execFile } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { sha256Json, sha256Text } from "../src/core/canonical-json.ts";
import { loadPublicCase } from "../src/core/case-loader.ts";

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
  "artifacts/evaluation/final-v3/summary.json",
  "artifacts/evaluation/final-v3/rows.jsonl",
  "artifacts/evaluation/recorded-all/summary.json",
  "artifacts/demo/manifest.json",
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

const IGNORED_DIRECTORY_NAMES = new Set([".git", ".next", "node_modules"]);
const FORBIDDEN_FILE_NAMES = new Set([
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "secrets.json",
]);

interface EvaluationSummary {
  caseSetHash: string;
  mode: string;
  model: string;
  trialsPerCase: number;
  arms: {
    baseline: { caseCount: number; sdr: number; unsafeMutationRate: number };
    advanced: { caseCount: number; sdr: number; unsafeMutationRate: number };
  };
}

interface EvaluationRow {
  caseId: string;
  arm: string;
  mode: string;
  model: string;
  action: string;
}

interface RunManifest {
  caseId: string;
  arm: string;
  mode: string;
  model: string;
  trajectoryPaths: string[];
  artifactSha256: Record<string, string>;
}

interface DemoManifest {
  caseSetHash: string;
  sourceMode: string;
  reports: Array<{ caseId: string; path: string; sha256: string }>;
}

export interface SubmissionVerificationResult {
  root: string;
  requiredFileCount: number;
  caseCount: number;
  reportCount: number;
  roles: string[];
  liveTrajectoryCount: number;
  recordedTrajectoryCount: number;
  caseSetHash: string;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function listFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        output.push(path);
      }
    }
  }
  await visit(root);
  return output;
}

async function verifyRunBundle(
  root: string,
  expectedMode: "live" | "recorded",
): Promise<{ manifests: RunManifest[]; trajectories: string[] }> {
  const files = await listFiles(root);
  const manifestPaths = files.filter((path) => basename(path) === "manifest.json");
  const trajectories = files.filter(
    (path) => extname(path) === ".jsonl" && basename(dirname(path)) === "trajectories",
  );
  const manifests: RunManifest[] = [];

  for (const manifestPath of manifestPaths) {
    const manifest = await readJson<RunManifest>(manifestPath);
    if (manifest.mode !== expectedMode) {
      throw new Error(`Unexpected mode in ${manifestPath}: ${manifest.mode}`);
    }
    const runDir = dirname(manifestPath);
    for (const [relativePath, expectedHash] of Object.entries(manifest.artifactSha256)) {
      const artifactPath = resolve(runDir, relativePath);
      const bytes = await readFile(artifactPath);
      const actualHash = sha256Text(bytes);
      if (actualHash !== expectedHash) {
        throw new Error(`Artifact hash mismatch: ${artifactPath}`);
      }
    }
    for (const trajectoryPath of manifest.trajectoryPaths) {
      await access(resolve(runDir, trajectoryPath));
    }
    manifests.push(manifest);
  }

  return { manifests, trajectories };
}

async function verifyMarkdown(root: string): Promise<void> {
  const absolutePathPattern = /(?:\b[A-Za-z]:[\\/]|\/Users\/)/;
  const markdownLinkPattern = /\[[^\]]*\]\(([^)]+)\)/g;

  for (const relativePath of PUBLIC_MARKDOWN) {
    const path = resolve(root, relativePath);
    const text = await readFile(path, "utf8");
    if (absolutePathPattern.test(text)) {
      throw new Error(`Public documentation contains a local absolute path: ${relativePath}`);
    }
    for (const match of text.matchAll(markdownLinkPattern)) {
      const rawTarget = match[1]?.trim().replace(/^<|>$/g, "");
      if (!rawTarget || /^(?:https?:|mailto:|#)/i.test(rawTarget)) {
        continue;
      }
      const targetWithoutAnchor = rawTarget.split("#", 1)[0];
      if (!targetWithoutAnchor) {
        continue;
      }
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
  if (stdout.trim()) {
    throw new Error("Git worktree is not clean");
  }
}

export async function verifySubmission(
  root: string,
  options: SubmissionVerificationOptions = {},
): Promise<SubmissionVerificationResult> {
  const absoluteRoot = resolve(root);
  for (const relativePath of REQUIRED_FILES) {
    try {
      await access(resolve(absoluteRoot, relativePath));
    } catch {
      throw new Error(`Missing required file: ${relativePath}`);
    }
  }

  const caseEntries = (await readdir(resolve(absoluteRoot, "cases"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (caseEntries.length !== 15) {
    throw new Error(`Expected 15 cases, found ${caseEntries.length}`);
  }

  const caseIndex: Array<{ caseId: string; workspaceHash: string }> = [];
  for (const caseId of caseEntries) {
    const loaded = await loadPublicCase(resolve(absoluteRoot, "cases", caseId));
    if (loaded.manifest.id !== caseId) {
      throw new Error(`Case directory and manifest disagree: ${caseId}`);
    }
    caseIndex.push({ caseId, workspaceHash: loaded.workspaceHash });
  }
  const caseSetHash = sha256Json(caseIndex);

  const liveSummary = await readJson<EvaluationSummary>(
    resolve(absoluteRoot, "artifacts/evaluation/final-v3/summary.json"),
  );
  if (
    liveSummary.mode !== "live" ||
    liveSummary.model !== "gpt-5.6-terra" ||
    liveSummary.trialsPerCase !== 1 ||
    liveSummary.caseSetHash !== caseSetHash ||
    liveSummary.arms.baseline.caseCount !== 15 ||
    liveSummary.arms.advanced.caseCount !== 15
  ) {
    throw new Error("Frozen live summary does not match the declared evaluation contract");
  }

  const liveRows = (await readFile(
    resolve(absoluteRoot, "artifacts/evaluation/final-v3/rows.jsonl"),
    "utf8",
  ))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EvaluationRow);
  if (
    liveRows.length !== 30 ||
    liveRows.some(
      (row) =>
        row.mode !== "live" ||
        row.model !== "gpt-5.6-terra" ||
        row.action === "ERROR" ||
        !caseEntries.includes(row.caseId) ||
        !["baseline", "advanced"].includes(row.arm),
    )
  ) {
    throw new Error("Frozen live rows are incomplete or contain execution errors");
  }

  const demoManifest = await readJson<DemoManifest>(
    resolve(absoluteRoot, "artifacts/demo/manifest.json"),
  );
  if (
    demoManifest.sourceMode !== "recorded" ||
    demoManifest.caseSetHash !== caseSetHash ||
    demoManifest.reports.length !== 15
  ) {
    throw new Error("Recorded demo manifest does not match the frozen case set");
  }
  for (const report of demoManifest.reports) {
    const reportPath = resolve(absoluteRoot, "artifacts/demo", report.path);
    const actualHash = sha256Json({ html: await readFile(reportPath, "utf8") });
    if (actualHash !== report.sha256) {
      throw new Error(`Demo report hash mismatch: ${report.path}`);
    }
  }

  const live = await verifyRunBundle(
    resolve(absoluteRoot, "artifacts/evaluation/final-v3"),
    "live",
  );
  const recorded = await verifyRunBundle(
    resolve(absoluteRoot, "artifacts/evaluation/recorded-all"),
    "recorded",
  );
  if (live.manifests.length !== 30 || recorded.manifests.length !== 30) {
    throw new Error("Expected 30 run manifests in both live and recorded evaluations");
  }
  if (live.trajectories.length !== 45 || recorded.trajectories.length < 45) {
    throw new Error("Agent trajectory bundles are incomplete");
  }
  const roles = [...new Set(live.trajectories.map((path) => basename(path, ".jsonl")))].sort();
  if (roles.join(",") !== "baseline,challenger,maintainer") {
    throw new Error(`Unexpected trajectory roles: ${roles.join(", ")}`);
  }

  await verifyMarkdown(absoluteRoot);
  await verifyNoCredentialFiles(absoluteRoot);
  if (options.checkGit !== false) {
    await verifyCleanGit(absoluteRoot);
  }

  return {
    root: absoluteRoot,
    requiredFileCount: REQUIRED_FILES.length,
    caseCount: caseEntries.length,
    reportCount: demoManifest.reports.length,
    roles,
    liveTrajectoryCount: live.trajectories.length,
    recordedTrajectoryCount: recorded.trajectories.length,
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
