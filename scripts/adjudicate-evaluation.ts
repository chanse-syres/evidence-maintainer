import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256Text } from "../src/core/canonical-json.ts";
import {
  adjudicateEvaluationSummary,
  type AdjudicatedEvaluationSummary,
} from "../src/evaluation/adjudicate.ts";
import type { EvaluationSummary } from "../src/evaluation/run-evaluation.ts";

interface CliOptions {
  source: string;
  out: string;
  lock: string;
  receipt: string;
}

function parseArgs(argv: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`Unknown or incomplete argument: ${name ?? "<missing>"}`);
    }
    values.set(name.slice(2), value);
  }
  for (const required of ["source", "out", "lock", "receipt"]) {
    if (!values.has(required)) throw new Error(`Missing --${required}`);
  }
  return Object.fromEntries(values) as unknown as CliOptions;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function overlaps(left: string, right: string): boolean {
  return isWithin(left, right) || isWithin(right, left);
}

export function assertSafeAdjudicationPaths(input: {
  repositoryRoot: string;
  source: string;
  out: string;
  lockPath: string;
  receiptPath: string;
}): void {
  const repositoryRoot = resolve(input.repositoryRoot);
  for (const [label, path] of [
    ["source", input.source],
    ["output", input.out],
    ["lock", input.lockPath],
    ["receipt", input.receiptPath],
  ] as const) {
    if (!isWithin(repositoryRoot, path) || path === repositoryRoot) {
      throw new Error(`Adjudication ${label} must be contained within the repository`);
    }
  }
  if (overlaps(input.source, input.out)) {
    throw new Error("Adjudication source and output directories must not overlap");
  }
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return join(await realpath(dirname(path)), basename(path));
  }
}

export async function adjudicateEvaluationFiles(options: CliOptions): Promise<{
  out: string;
  summary: AdjudicatedEvaluationSummary;
}> {
  const source = resolve(options.source);
  const out = resolve(options.out);
  const lockPath = resolve(options.lock);
  const receiptPath = resolve(options.receipt);
  const repositoryRoot = await realpath(resolve("."));
  assertSafeAdjudicationPaths({
    repositoryRoot,
    source: await canonicalPath(source),
    out: await canonicalPath(out),
    lockPath: await canonicalPath(lockPath),
    receiptPath: await canonicalPath(receiptPath),
  });
  if (basename(out).toLowerCase().includes("raw")) {
    throw new Error("Adjudicated output must not use a raw-evidence directory name");
  }

  const rawSummaryPath = join(source, "summary.json");
  const rawRowsPath = join(source, "rows.jsonl");
  const rawInvalidationsPath = join(source, "evaluator-invalidations.json");
  const [rawSummaryText, rawRowsText, rawInvalidationsText, lockText, receiptText] = await Promise.all([
    readFile(rawSummaryPath, "utf8"),
    readFile(rawRowsPath, "utf8"),
    readFile(rawInvalidationsPath, "utf8"),
    readFile(lockPath, "utf8"),
    readFile(receiptPath, "utf8"),
  ]);
  const rawSummary = JSON.parse(rawSummaryText) as EvaluationSummary;
  const lock = JSON.parse(lockText);
  const receipt = JSON.parse(receiptText);
  const summary = adjudicateEvaluationSummary({
    rawSummary,
    lock,
    invalidations: [receipt],
  });

  await mkdir(dirname(out), { recursive: true });
  const staging = await mkdtemp(join(dirname(out), `.${basename(out)}-next-`));
  await cp(source, staging, { recursive: true });
  const rawDir = join(staging, "raw");
  await mkdir(rawDir, { recursive: true });
  await Promise.all([
    writeFile(join(rawDir, "summary.json"), rawSummaryText, "utf8"),
    writeFile(join(rawDir, "rows.jsonl"), rawRowsText, "utf8"),
    writeFile(join(rawDir, "evaluator-invalidations.json"), rawInvalidationsText, "utf8"),
  ]);

  const selectedRowsText = summary.rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  const invalidationRecord = {
    schemaVersion: 1,
    selectedCaseIds: [...lock.cases.map((entry: { caseId: string }) => entry.caseId)].sort(),
    includedCaseIds: summary.selection.includedCaseIds,
    invalidations: [{
      caseId: receipt.caseId,
      reason: receipt.reason,
      sourceReceiptSha256: sha256Text(receiptText),
      receipt,
    }],
  };
  await Promise.all([
    writeJson(join(staging, "summary.json"), summary),
    writeFile(join(staging, "rows.jsonl"), selectedRowsText, "utf8"),
    writeJson(join(staging, "evaluator-invalidations.json"), invalidationRecord),
  ]);

  const selectedSummaryText = await readFile(join(staging, "summary.json"), "utf8");
  const selectedInvalidationsText = await readFile(join(staging, "evaluator-invalidations.json"), "utf8");
  await writeJson(join(staging, "adjudication.json"), {
    schemaVersion: 1,
    campaign: receipt.campaign,
    status: "VALID_AFTER_SYMMETRIC_EVALUATOR_INVALIDATION",
    lockSha256: sha256Text(lockText),
    invalidationReceipt: options.receipt.replaceAll("\\", "/"),
    invalidationReceiptSha256: sha256Text(receiptText),
    rawEvidence: {
      summarySha256: sha256Text(rawSummaryText),
      rowsSha256: sha256Text(rawRowsText),
      evaluatorInvalidationsSha256: sha256Text(rawInvalidationsText),
      workflowRunCount: rawSummary.rows.length,
    },
    selectedEvidence: {
      summarySha256: sha256Text(selectedSummaryText),
      rowsSha256: sha256Text(selectedRowsText),
      evaluatorInvalidationsSha256: sha256Text(selectedInvalidationsText),
      workflowRunCount: summary.rows.length,
    },
  });

  const backup = join(dirname(out), `.${basename(out)}-previous-${process.pid}`);
  await rm(backup, { recursive: true, force: true });
  let movedExisting = false;
  try {
    await rename(out, backup);
    movedExisting = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }
  try {
    await rename(staging, out);
  } catch (error) {
    if (movedExisting) await rename(backup, out);
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  if (movedExisting) await rm(backup, { recursive: true, force: true });
  return { out, summary };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await adjudicateEvaluationFiles(options);
  process.stdout.write(`${JSON.stringify({
    out: result.out,
    includedCases: result.summary.selection.includedCaseCount,
    excludedCases: result.summary.selection.excludedCaseCount,
    baselineOdi: `${result.summary.arms.baseline.operationalDecisions}/${result.summary.arms.baseline.workflowRunCount}`,
    advancedOdi: `${result.summary.arms.advanced.operationalDecisions}/${result.summary.arms.advanced.workflowRunCount}`,
    absoluteOdiChange: result.summary.absoluteOdiChange,
  }, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await main();
}
