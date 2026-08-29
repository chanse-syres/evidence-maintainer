import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { loadOracle } from "../core/case-loader.ts";
import { sha256Text } from "../core/canonical-json.ts";
import { RunManifestSchema } from "../core/schemas.ts";
import { aggregateRows, type AggregateSummary } from "./aggregate.ts";
import { createExecutionErrorRow } from "./run-evaluation.ts";
import { scoreRun, type EvaluationRow } from "./score-run.ts";

export interface EvaluationSource {
  label: string;
  root: string;
  trialOffset: number;
}

export interface CombinedEvaluationRow extends EvaluationRow {
  trial: number;
  sourceLabel: string;
  executionErrorType: "MODEL_EXECUTION" | null;
  executionErrorMessage: string | null;
  modelSessions: number;
}

export interface CombinedEvaluationSummary extends AggregateSummary {
  schemaVersion: 2;
  generatedAt: string;
  caseSetHash: string;
  model: string;
  mode: "live" | "recorded";
  timeoutMs: number;
  trialsPerCase: number;
  inputCommit: string | null;
  inputCommitVerification: {
    resolvedCommit: string;
    verifiedPaths: string[];
  } | null;
  failureTaxonomy: {
    modelExecutionErrors: number;
    infrastructureErrors: number;
  };
  modelSessions: {
    total: number;
    baseline: number;
    maintainer: number;
    challenger: number;
    sessionsWithUsage: number;
    tokenUsage: Usage & { total: number };
  };
  sources: Array<{
    label: string;
    summarySha256: string;
    trialOffset: number;
    sourceTrialsPerCase: number;
  }>;
  rows: CombinedEvaluationRow[];
}

export interface CombineEvaluationConfig {
  sources: EvaluationSource[];
  outDir: string;
  caseRoot: string;
  expectedTrialsPerCase: number;
  inputCommit?: string;
  inputCommitVerification?: {
    resolvedCommit: string;
    verifiedPaths: string[];
  };
  modelErrorKeys?: string[];
  replaceGeneratedOutput?: boolean;
}

interface SourceSummary {
  caseSetHash: string;
  model: string;
  mode: "live" | "recorded";
  trialsPerCase: number;
  rows: Array<EvaluationRow & { runPath: string }>;
}

interface Usage {
  input: number;
  cachedInput: number;
  output: number;
}

function parseRunPath(runPath: string): {
  caseId: string;
  trial: number;
  arm: "baseline" | "advanced";
} {
  const normalized = runPath.replaceAll("\\", "/");
  const match = /^runs\/([^/]+)\/trial-(\d+)\/(baseline|advanced)$/.exec(normalized);
  if (!match) throw new Error(`Unsupported evaluation run path: ${runPath}`);
  return {
    caseId: match[1],
    trial: Number.parseInt(match[2], 10),
    arm: match[3] as "baseline" | "advanced",
  };
}

function usageFromEvent(value: unknown): Usage | null {
  if (!value || typeof value !== "object") return null;
  const usage = (value as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return null;
  const raw = usage as Record<string, unknown>;
  const input = raw.input_tokens;
  const cachedInput = raw.cached_input_tokens;
  const output = raw.output_tokens;
  if (
    typeof input !== "number" || !Number.isInteger(input) || input < 0 ||
    typeof cachedInput !== "number" || !Number.isInteger(cachedInput) || cachedInput < 0 ||
    typeof output !== "number" || !Number.isInteger(output) || output < 0 ||
    cachedInput > input
  ) return null;
  return { input, cachedInput, output };
}

async function readTrajectoryUsage(path: string): Promise<Usage | null> {
  const lines = (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean);
  let latest: Usage | null = null;
  for (const line of lines) {
    try {
      latest = usageFromEvent(JSON.parse(line)) ?? latest;
    } catch {
      // Non-JSON diagnostic lines cannot contribute trusted usage.
    }
  }
  return latest;
}

async function reconstructUsage(runPath: string, trajectoryPaths: readonly string[]): Promise<Usage | null> {
  const usages = [];
  for (const trajectoryPath of trajectoryPaths) {
    const usage = await readTrajectoryUsage(join(runPath, ...trajectoryPath.split("/")));
    if (usage) usages.push(usage);
  }
  if (usages.length === 0) return null;
  return {
    input: usages.reduce((sum, usage) => sum + usage.input, 0),
    cachedInput: usages.reduce((sum, usage) => sum + usage.cachedInput, 0),
    output: usages.reduce((sum, usage) => sum + usage.output, 0),
  };
}

async function verifyManifestArtifacts(runPath: string, artifactSha256: Record<string, string>): Promise<void> {
  for (const [artifactPath, expectedHash] of Object.entries(artifactSha256)) {
    const actualHash = sha256Text(await readFile(join(runPath, ...artifactPath.split("/"))));
    if (actualHash !== expectedHash) {
      throw new Error(`Artifact hash mismatch for ${artifactPath} in ${runPath}`);
    }
  }
}

async function countAndCleanTrajectoryLogs(runPath: string): Promise<{
  total: number;
  baseline: number;
  maintainer: number;
  challenger: number;
  sessionsWithUsage: number;
  usage: Usage;
}> {
  const trajectoryDir = join(runPath, "trajectories");
  let entries;
  try {
    entries = await readdir(trajectoryDir, { withFileTypes: true });
  } catch {
    return {
      total: 0,
      baseline: 0,
      maintainer: 0,
      challenger: 0,
      sessionsWithUsage: 0,
      usage: { input: 0, cachedInput: 0, output: 0 },
    };
  }
  const counts = {
    total: 0,
    baseline: 0,
    maintainer: 0,
    challenger: 0,
    sessionsWithUsage: 0,
    usage: { input: 0, cachedInput: 0, output: 0 },
  };
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".stderr.log")) {
      await rm(join(trajectoryDir, entry.name));
      continue;
    }
    if (!entry.name.endsWith(".jsonl")) continue;
    const role = entry.name.slice(0, -".jsonl".length);
    if (role === "baseline" || role === "maintainer" || role === "challenger") {
      counts[role] += 1;
      counts.total += 1;
      const usage = await readTrajectoryUsage(join(trajectoryDir, entry.name));
      if (usage) {
        counts.sessionsWithUsage += 1;
        counts.usage.input += usage.input;
        counts.usage.cachedInput += usage.cachedInput;
        counts.usage.output += usage.output;
      }
    }
  }
  return counts;
}

function addUsage(row: EvaluationRow, usage: Usage | null): EvaluationRow {
  if (!usage) return row;
  return {
    ...row,
    inputTokens: usage.input,
    cachedInputTokens: usage.cachedInput,
    outputTokens: usage.output,
    totalTokens: usage.input + usage.output,
  };
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
}

export async function combineEvaluationSources(
  config: CombineEvaluationConfig,
): Promise<CombinedEvaluationSummary> {
  if (config.sources.length === 0) throw new Error("At least one evaluation source is required");
  assertPositiveInteger(config.expectedTrialsPerCase, "expectedTrialsPerCase");
  if (config.inputCommit) {
    if (!config.inputCommitVerification) {
      throw new Error("inputCommit requires verified Git provenance");
    }
    if (config.inputCommitVerification.resolvedCommit !== config.inputCommit) {
      throw new Error("inputCommit does not match the resolved verified commit");
    }
  }
  const outDir = resolve(config.outDir);
  const existing: string[] = await readdir(outDir).catch(() => [] as string[]);
  if (existing.length > 0) {
    if (!config.replaceGeneratedOutput) {
      throw new Error(`Combined output directory must be empty: ${outDir}`);
    }
    const expectedMarkers = ["summary.json", "source-bundles.json"];
    if (!expectedMarkers.every((marker) => existing.includes(marker))) {
      throw new Error(`Refusing to replace a directory not recognized as combined output: ${outDir}`);
    }
    await rm(outDir, { recursive: true, force: true });
  }
  await mkdir(outDir, { recursive: true });

  const allowedModelErrors = new Set(config.modelErrorKeys ?? []);
  const consumedModelErrors = new Set<string>();
  const rows: CombinedEvaluationRow[] = [];
  const seenTuples = new Set<string>();
  const seenRunIds = new Set<string>();
  const caseSignatures = new Map<string, string>();
  const armSignatures = new Map<string, string>();
  const sourceMetadata: CombinedEvaluationSummary["sources"] = [];
  const sessionCounts = {
    total: 0,
    baseline: 0,
    maintainer: 0,
    challenger: 0,
    sessionsWithUsage: 0,
    tokenUsage: { input: 0, cachedInput: 0, output: 0, total: 0 },
  };
  let caseSetHash: string | null = null;
  let model: string | null = null;
  let mode: "live" | "recorded" | null = null;
  let timeoutMs: number | null = null;

  for (const source of config.sources) {
    if (!source.label.trim()) throw new Error("Source labels must be non-empty");
    if (!Number.isInteger(source.trialOffset) || source.trialOffset < 0) {
      throw new Error(`Invalid trial offset for ${source.label}`);
    }
    const sourceRoot = resolve(source.root);
    const summaryText = await readFile(join(sourceRoot, "summary.json"), "utf8");
    const sourceSummary = JSON.parse(summaryText) as SourceSummary;
    if (!Array.isArray(sourceSummary.rows) || sourceSummary.rows.length === 0) {
      throw new Error(`Source ${source.label} has no evaluation rows`);
    }
    if (!sourceSummary.caseSetHash || !sourceSummary.model || !sourceSummary.mode) {
      throw new Error(`Source ${source.label} is missing frozen evaluation metadata`);
    }
    caseSetHash ??= sourceSummary.caseSetHash;
    model ??= sourceSummary.model;
    mode ??= sourceSummary.mode;
    if (sourceSummary.caseSetHash !== caseSetHash) throw new Error("Source case-set hashes differ");
    if (sourceSummary.model !== model) throw new Error("Source models differ");
    if (sourceSummary.mode !== mode) throw new Error("Source execution modes differ");
    sourceMetadata.push({
      label: source.label,
      summarySha256: sha256Text(summaryText),
      trialOffset: source.trialOffset,
      sourceTrialsPerCase: sourceSummary.trialsPerCase,
    });

    for (const sourceRow of sourceSummary.rows) {
      const parsed = parseRunPath(sourceRow.runPath);
      if (parsed.caseId !== sourceRow.caseId || parsed.arm !== sourceRow.arm) {
        throw new Error(`Row identity disagrees with run path: ${sourceRow.runPath}`);
      }
      const canonicalTrial = parsed.trial + source.trialOffset;
      const tuple = `${parsed.caseId}\u0000${canonicalTrial}\u0000${parsed.arm}`;
      if (seenTuples.has(tuple)) throw new Error(`Duplicate canonical evaluation tuple: ${tuple}`);
      seenTuples.add(tuple);
      const sourceRunPath = join(sourceRoot, ...sourceRow.runPath.split("/"));
      const destinationRunPath = join(outDir, "runs", parsed.caseId, `trial-${canonicalTrial}`, parsed.arm);
      await mkdir(join(outDir, "runs", parsed.caseId, `trial-${canonicalTrial}`), { recursive: true });
      await cp(sourceRunPath, destinationRunPath, { recursive: true, force: false, errorOnExist: true });
      const sessions = await countAndCleanTrajectoryLogs(destinationRunPath);
      sessionCounts.total += sessions.total;
      sessionCounts.baseline += sessions.baseline;
      sessionCounts.maintainer += sessions.maintainer;
      sessionCounts.challenger += sessions.challenger;
      sessionCounts.sessionsWithUsage += sessions.sessionsWithUsage;
      sessionCounts.tokenUsage.input += sessions.usage.input;
      sessionCounts.tokenUsage.cachedInput += sessions.usage.cachedInput;
      sessionCounts.tokenUsage.output += sessions.usage.output;
      const expectedAction = (await loadOracle(join(config.caseRoot, parsed.caseId))).expectedAction;
      const destinationRelative = relative(outDir, destinationRunPath).replaceAll("\\", "/");

      let combinedRow: CombinedEvaluationRow;
      let manifestText: string | null = null;
      try {
        manifestText = await readFile(join(sourceRunPath, "manifest.json"), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (manifestText !== null) {
        const manifest = RunManifestSchema.parse(JSON.parse(manifestText));
        if (manifest.caseId !== parsed.caseId || manifest.arm !== parsed.arm) {
          throw new Error(`Manifest identity mismatch in ${sourceRunPath}`);
        }
        if (manifest.model !== model || manifest.mode !== mode) {
          throw new Error(`Manifest execution metadata mismatch in ${sourceRunPath}`);
        }
        timeoutMs ??= manifest.timeoutMs;
        if (manifest.timeoutMs !== timeoutMs) throw new Error("Source timeouts differ");
        await verifyManifestArtifacts(sourceRunPath, manifest.artifactSha256);
        const priorCaseSignature = caseSignatures.get(parsed.caseId);
        if (priorCaseSignature && priorCaseSignature !== manifest.caseSetSha256) {
          throw new Error(`Case workspace signature drifted for ${parsed.caseId}`);
        }
        caseSignatures.set(parsed.caseId, manifest.caseSetSha256);
        const armKey = `${parsed.caseId}\u0000${parsed.arm}`;
        const fixedArmSignature = `${manifest.caseSetSha256}:${manifest.outputSchemaSha256}`;
        const priorArmSignature = armSignatures.get(armKey);
        if (priorArmSignature && priorArmSignature !== fixedArmSignature) {
          throw new Error(`Output contract drifted for ${parsed.caseId}/${parsed.arm}`);
        }
        armSignatures.set(armKey, fixedArmSignature);
        if (seenRunIds.has(manifest.runId)) throw new Error(`Duplicate run ID: ${manifest.runId}`);
        seenRunIds.add(manifest.runId);
        const rescored = await scoreRun(sourceRunPath, { expectedAction });
        const usage = await reconstructUsage(sourceRunPath, manifest.trajectoryPaths);
        const rowWithUsage = addUsage(rescored, usage ?? manifest.tokenUsage);
        combinedRow = {
          ...rowWithUsage,
          runPath: destinationRelative,
          trial: canonicalTrial,
          sourceLabel: source.label,
          executionErrorType: null,
          executionErrorMessage: null,
          modelSessions: sessions.total,
        };
      } else {
        const errorArtifactText = await readFile(join(sourceRunPath, "error.json"), "utf8");
        const errorArtifact = JSON.parse(errorArtifactText) as { message?: unknown };
        const errorMessage = typeof errorArtifact.message === "string"
          ? errorArtifact.message
          : "Model execution did not produce a complete workflow artifact.";
        const errorKey = `${source.label}:${parsed.trial}:${parsed.caseId}:${parsed.arm}`;
        if (!allowedModelErrors.has(errorKey)) {
          throw new Error(`Unclassified execution error: ${errorKey}`);
        }
        consumedModelErrors.add(errorKey);
        await writeFile(join(destinationRunPath, "error.json"), `${JSON.stringify({
          caseId: parsed.caseId,
          arm: parsed.arm,
          classification: "MODEL_EXECUTION",
          message: errorMessage,
          sourceArtifactSha256: sha256Text(errorArtifactText),
        }, null, 2)}\n`, "utf8");
        const errorRow = createExecutionErrorRow({
          caseId: parsed.caseId,
          arm: parsed.arm,
          mode,
          model,
          runPath: destinationRelative,
          expectedAction,
          trial: canonicalTrial,
        });
        combinedRow = {
          ...errorRow,
          trial: canonicalTrial,
          sourceLabel: source.label,
          executionErrorType: "MODEL_EXECUTION",
          executionErrorMessage: errorMessage,
          modelSessions: sessions.total,
        };
      }
      rows.push(combinedRow);
    }
  }

  for (const key of allowedModelErrors) {
    if (!consumedModelErrors.has(key)) throw new Error(`Declared model error was not observed: ${key}`);
  }
  if (timeoutMs === null || model === null || mode === null || caseSetHash === null) {
    throw new Error("No complete run was available to establish frozen metadata");
  }
  rows.sort((left, right) =>
    left.caseId.localeCompare(right.caseId) ||
    left.trial - right.trial ||
    (left.arm === right.arm ? 0 : left.arm === "baseline" ? -1 : 1)
  );
  const cases = [...new Set(rows.map((row) => row.caseId))];
  const expectedRowCount = cases.length * config.expectedTrialsPerCase * 2;
  if (rows.length !== expectedRowCount) {
    throw new Error(`Expected ${expectedRowCount} canonical rows, found ${rows.length}`);
  }
  for (const caseId of cases) {
    for (let trial = 1; trial <= config.expectedTrialsPerCase; trial += 1) {
      for (const arm of ["baseline", "advanced"] as const) {
        if (!seenTuples.has(`${caseId}\u0000${trial}\u0000${arm}`)) {
          throw new Error(`Missing canonical evaluation tuple: ${caseId}/trial-${trial}/${arm}`);
        }
      }
    }
  }
  const aggregate = aggregateRows(rows);
  sessionCounts.tokenUsage.total = sessionCounts.tokenUsage.input + sessionCounts.tokenUsage.output;
  const summary: CombinedEvaluationSummary = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    caseSetHash,
    model,
    mode,
    timeoutMs,
    trialsPerCase: config.expectedTrialsPerCase,
    inputCommit: config.inputCommit ?? null,
    inputCommitVerification: config.inputCommitVerification ?? null,
    failureTaxonomy: {
      modelExecutionErrors: consumedModelErrors.size,
      infrastructureErrors: 0,
    },
    modelSessions: sessionCounts,
    sources: sourceMetadata,
    ...aggregate,
    rows,
  };
  await writeFile(join(outDir, "rows.jsonl"), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  await writeFile(join(outDir, "source-bundles.json"), `${JSON.stringify(sourceMetadata, null, 2)}\n`, "utf8");
  await writeFile(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return summary;
}
