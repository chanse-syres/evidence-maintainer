import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256Text } from "../src/core/canonical-json.ts";
import { combineEvaluationSources } from "../src/evaluation/combine-evaluations.ts";
import {
  estimateUsageCost,
  summarizeCompletedRowUsage,
  type UsagePricing,
} from "../src/evaluation/cost.ts";

export interface CombineCliOptions {
  initial: string;
  repeat: string;
  out: string;
  caseRoot: string;
  inputCommit: string;
  replace: boolean;
}

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile("git", args, { cwd, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Git provenance check failed: ${stderr.trim() || error.message}`));
        return;
      }
      resolvePromise(stdout.trim());
    });
  });
}

export async function verifyFrozenInputCommit(
  inputCommit: string,
  verifiedPaths = ["cases", "prompts", "schemas"],
  cwd = process.cwd(),
): Promise<{ resolvedCommit: string; verifiedPaths: string[] }> {
  const resolvedCommit = await git(["rev-parse", "--verify", `${inputCommit}^{commit}`], cwd);
  if (!/^[a-f0-9]{40}$/.test(resolvedCommit)) {
    throw new Error(`Git returned an invalid commit ID: ${resolvedCommit}`);
  }
  const changed = await git(["diff", "--name-only", resolvedCommit, "--", ...verifiedPaths], cwd);
  if (changed) {
    throw new Error(`Frozen evaluation inputs differ from ${resolvedCommit}: ${changed.replaceAll("\n", ", ")}`);
  }
  return { resolvedCommit, verifiedPaths: [...verifiedPaths] };
}

export function parseCombineArgs(argv: string[]): CombineCliOptions {
  const options: CombineCliOptions = {
    initial: "artifacts/evaluation/final-v3",
    repeat: "artifacts/evaluation/final-v3-repeat",
    out: "artifacts/evaluation/final-v4",
    caseRoot: "cases",
    inputCommit: "d2e9bd0ca64ac4d88904d4e8d19cdbd856eb828a",
    replace: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === "--initial" && value) options.initial = value;
    else if (argv[index] === "--repeat" && value) options.repeat = value;
    else if (argv[index] === "--out" && value) options.out = value;
    else if (argv[index] === "--case-root" && value) options.caseRoot = value;
    else if (argv[index] === "--input-commit" && value) options.inputCommit = value;
    else if (argv[index] === "--replace") {
      options.replace = true;
      continue;
    }
    else if (argv[index].startsWith("--")) throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
    else continue;
    index += 1;
  }
  return options;
}

export async function combineCli(argv: string[]): Promise<void> {
  const options = parseCombineArgs(argv);
  const pricingPath = resolve("config", "pricing-gpt-5.6-terra-2026-08-28.json");
  const pricingText = await readFile(pricingPath, "utf8");
  const pricingSnapshot = JSON.parse(pricingText) as UsagePricing & Record<string, unknown>;
  const inputCommitVerification = await verifyFrozenInputCommit(options.inputCommit);
  const summary = await combineEvaluationSources({
    sources: [
      { label: "initial", root: resolve(options.initial), trialOffset: 0 },
      { label: "repeat", root: resolve(options.repeat), trialOffset: 1 },
    ],
    outDir: resolve(options.out),
    caseRoot: resolve(options.caseRoot),
    expectedTrialsPerCase: 3,
    inputCommit: inputCommitVerification.resolvedCommit,
    inputCommitVerification,
    modelErrorKeys: ["repeat:1:repair-selector-drift:advanced"],
    replaceGeneratedOutput: options.replace,
  });
  const completed = (arm: "baseline" | "advanced") => {
    const armRows = summary.rows.filter((row) => row.arm === arm);
    const { workflowRunsWithUsage, ...usage } = summarizeCompletedRowUsage(armRows);
    return {
      workflowRuns: armRows.length,
      workflowRunsWithUsage,
      ...estimateUsageCost(usage, pricingSnapshot),
    };
  };
  const baseline = completed("baseline");
  const advanced = completed("advanced");
  const campaign = estimateUsageCost(summary.modelSessions.tokenUsage, pricingSnapshot);
  const costEstimate = {
    schemaVersion: 1,
    pricingSnapshot: {
      ...pricingSnapshot,
      sha256: sha256Text(pricingText),
    },
    completedWorkflowRuns: { baseline, advanced },
    campaignActual: {
      modelSessions: summary.modelSessions.total,
      sessionsWithUsage: summary.modelSessions.sessionsWithUsage,
      includesPartialFailedSession: true,
      ...campaign,
    },
    comparisons: {
      meanCompletedRunTokenOverhead: advanced.tokenUsage.total / advanced.workflowRunsWithUsage /
        (baseline.tokenUsage.total / baseline.workflowRunsWithUsage) - 1,
      meanCompletedRunLatencyOverhead: summary.arms.advanced.durationMs.mean /
        summary.arms.baseline.durationMs.mean - 1,
    },
    caveat: "Cost is an API list-price estimate. The incomplete advanced workflow is included in campaignActual but omitted from completed-run resource averages.",
  };
  await writeFile(
    join(resolve(options.out), "cost-estimate.json"),
    `${JSON.stringify(costEstimate, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify({
    out: resolve(options.out),
    baseline: `${summary.arms.baseline.safeDecisions}/${summary.arms.baseline.workflowRunCount}`,
    advanced: `${summary.arms.advanced.safeDecisions}/${summary.arms.advanced.workflowRunCount}`,
    absoluteSdrChange: summary.absoluteSdrChange,
    modelSessions: summary.modelSessions,
    modelExecutionErrors: summary.failureTaxonomy.modelExecutionErrors,
  }, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await combineCli(process.argv.slice(2));
}
