import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { loadOracleV4 } from "../core/case-loader.ts";
import { sha256Json, sha256Text } from "../core/canonical-json.ts";
import { RunManifestSchema, type RunManifest } from "../core/schemas.ts";
import { snapshotTree } from "../core/tree-snapshot.ts";
import { adjudicateEvaluationSummary } from "../evaluation/adjudicate.ts";
import { aggregateRows } from "../evaluation/aggregate.ts";
import type { EvaluationSummary } from "../evaluation/run-evaluation.ts";
import { failureClasses, scoreRun, type EvaluationRow } from "../evaluation/score-run.ts";

interface FrozenCase {
  caseId: string;
  workspaceHash: string;
}

interface FrozenDefinition {
  caseId: string;
  sha256: string;
}

interface V4Lock {
  schemaVersion: number;
  status: string;
  freezeTag: string;
  evaluationHarnessCommit: string;
  holdoutTreeHash: string;
  model: string;
  mode: string;
  trialsPerCase: number;
  timeoutMs: number;
  caseRoot: string;
  caseSetHash: string;
  caseDefinitionSetHash: string;
  cases: FrozenCase[];
  caseDefinitions: FrozenDefinition[];
  contracts: Record<string, string>;
  systemFreezeCommit: string;
  holdoutDefinitionCommit: string;
}

interface InvalidationReceipt {
  schemaVersion: number;
  campaign: string;
  caseId: string;
  status: string;
  recordedAt: string;
  publicComparisonEligible: boolean;
  reason: string;
  disposition: {
    excludedSymmetrically: boolean;
    excludedWorkflowRows: number;
  };
}

export interface SelectedV4ValidationResult {
  workflowRunCount: number;
  modelSessionCount: number;
  caseSetHash: string;
  selectedCaseCount: number;
  includedCaseCount: number;
  invalidatedCaseCount: number;
}

const execFileAsync = promisify(execFile);

const BASELINE_ARTIFACTS = [
  "final-decision.json",
  "before-tree.json",
  "after-tree.json",
  "command-results.json",
  "gate.json",
  "approval.json",
  "trajectories/baseline.jsonl",
] as const;

const ADVANCED_ARTIFACTS = [
  "evidence.jsonl",
  "draft-decision.json",
  "challenger-critique.json",
  "final-decision.json",
  "before-tree.json",
  "after-tree.json",
  "command-results.json",
  "gate.json",
  "approval.json",
  "trajectories/maintainer.jsonl",
  "trajectories/challenger.jsonl",
  "trajectories/reviser.jsonl",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedRelativePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    !value.includes("\\") && !value.startsWith("/") && !/^[A-Za-z]:/.test(value) &&
    !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Invalid ${label}`);
}

function assertInteger(value: unknown, label: string, minimum = 0): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < minimum) throw new Error(`Invalid ${label}`);
}

function equalJson(left: unknown, right: unknown): boolean {
  return sha256Json(left) === sha256Json(right);
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON evidence: ${path}`, { cause: error });
  }
}

async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function parseJsonLines(text: string, label: string): Record<string, unknown>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.map((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSONL in ${label} at line ${index + 1}`, { cause: error });
    }
    assertRecord(parsed, `${label} line ${index + 1}`);
    return parsed;
  });
}

function deriveLockPath(campaign: string): string {
  const match = /^holdout-v4-attempt-(\d+)$/.exec(campaign);
  if (!match) throw new Error(`Selected campaign is not a versioned V4 attempt: ${campaign}`);
  return `holdout/v4/FREEZE-ATTEMPT-${match[1]}.json`;
}

async function git(root: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: root, windowsHide: true });
    return stdout.trimEnd();
  } catch (error) {
    throw new Error(`Freeze provenance Git check failed: ${args.join(" ")}`, { cause: error });
  }
}

async function assertAncestor(root: string, ancestor: string, descendant: string, label: string): Promise<void> {
  try {
    await execFileAsync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: root,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(`Freeze provenance ancestry mismatch: ${label}`, { cause: error });
  }
}

async function verifyFreezeProvenance(
  root: string,
  lockRelativePath: string,
  lockText: string,
  lock: V4Lock,
): Promise<void> {
  if (!/^holdout-freeze-v4-attempt-\d+$/.test(lock.freezeTag)) {
    throw new Error("Invalid V4 freeze tag name");
  }
  if (await git(root, ["cat-file", "-t", lock.freezeTag]) !== "tag") {
    throw new Error("V4 freeze tag must be annotated");
  }
  const tagCommit = await git(root, ["rev-list", "-n", "1", lock.freezeTag]);
  if (!/^[a-f0-9]{40}$/.test(tagCommit)) throw new Error("V4 freeze tag does not resolve to a commit");
  const taggedLockText = await git(root, ["show", `${lock.freezeTag}:${lockRelativePath}`]);
  if (sha256Text(`${taggedLockText}\n`) !== sha256Text(lockText)) {
    throw new Error("Current V4 lock bytes do not match the annotated freeze tag");
  }

  const frozenCommits = [
    ["system freeze", lock.systemFreezeCommit],
    ["holdout definition", lock.holdoutDefinitionCommit],
    ["evaluation harness", lock.evaluationHarnessCommit],
  ] as const;
  for (const [label, commit] of frozenCommits) {
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error(`Invalid ${label} commit in V4 lock`);
    const resolved = await git(root, ["rev-parse", "--verify", `${commit}^{commit}`]);
    if (resolved !== commit) throw new Error(`${label} commit does not resolve exactly`);
    await assertAncestor(root, commit, tagCommit, `${label} commit is not an ancestor of the freeze tag`);
  }
  await assertAncestor(root, tagCommit, "HEAD", "freeze tag is not an ancestor of the release commit");
}

async function loadCampaignInvalidations(root: string, campaign: string): Promise<Array<{
  path: string;
  text: string;
  receipt: InvalidationReceipt;
}>> {
  const directory = resolve(root, "holdout", "v4");
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith("EVALUATOR-INVALIDATION-") || !entry.name.endsWith(".json")) {
      continue;
    }
    const path = join(directory, entry.name);
    const text = await readFile(path, "utf8");
    const receipt = JSON.parse(text) as InvalidationReceipt;
    if (receipt.campaign === campaign) output.push({ path, text, receipt });
  }
  return output.sort((left, right) => left.receipt.caseId.localeCompare(right.receipt.caseId));
}

function validateRow(value: unknown, includedCaseIds: Set<string>, model: string, mode: string): EvaluationRow {
  assertRecord(value, "evaluation row");
  const arm = value.arm;
  if (arm !== "baseline" && arm !== "advanced") throw new Error("Invalid evaluation row arm");
  if (typeof value.runId !== "string" || !value.runId) throw new Error("Invalid evaluation row runId");
  if (typeof value.caseId !== "string" || !includedCaseIds.has(value.caseId)) {
    throw new Error("Evaluation row names an excluded or unknown case");
  }
  if (value.model !== model || value.mode !== mode) throw new Error("Evaluation row model or mode mismatch");
  if (!normalizedRelativePath(value.runPath)) throw new Error("Invalid evaluation row run path");
  for (const key of [
    "actionCorrect",
    "artifactCorrect",
    "noForbiddenMutation",
    "requiredCommandsPassed",
    "sourceCoverage",
    "contradictionFree",
    "annotationAligned",
    "operationalDecisionIntegrity",
  ]) {
    if (typeof value[key] !== "boolean") throw new Error(`Invalid evaluation row ${key}`);
  }
  const expectedOdi = Boolean(
    value.actionCorrect && value.artifactCorrect && value.noForbiddenMutation &&
    value.requiredCommandsPassed && value.sourceCoverage && value.contradictionFree,
  );
  if (value.operationalDecisionIntegrity !== expectedOdi) {
    throw new Error("Evaluation row ODI does not match blocking components");
  }
  if (!failureClasses.includes(value.failureClass as never)) throw new Error("Invalid evaluation failure class");
  if (!Array.isArray(value.changedFiles)) throw new Error("Invalid evaluation changed-files receipt");
  return value as unknown as EvaluationRow;
}

function expectedArtifactPaths(manifest: RunManifest): string[] {
  const fixed = manifest.arm === "baseline" ? BASELINE_ARTIFACTS : ADVANCED_ARTIFACTS;
  return [...fixed, ...manifest.proxyLedgerPaths].sort();
}

async function validateManifest(
  root: string,
  row: EvaluationRow,
  expectedAction: string,
  workspaceHash: string,
): Promise<number> {
  const runRoot = resolve(root, ...row.runPath.split("/"));
  if (row.failureClass === "MODEL_EXECUTION") {
    await access(join(runRoot, "error.json"));
    return 0;
  }
  const manifestPath = join(runRoot, "manifest.json");
  const manifest = RunManifestSchema.parse(await readJson(manifestPath));
  if (
    manifest.schemaVersion !== 2 || manifest.runId !== row.runId || manifest.caseId !== row.caseId ||
    manifest.arm !== row.arm || manifest.model !== row.model || manifest.mode !== row.mode
  ) {
    throw new Error(`Manifest identity mismatch: ${row.runId}`);
  }
  const expectedTrajectories = row.arm === "baseline"
    ? ["trajectories/baseline.jsonl"]
    : [
        "trajectories/maintainer.jsonl",
        "trajectories/challenger.jsonl",
        "trajectories/reviser.jsonl",
      ];
  if (!equalJson([...manifest.trajectoryPaths].sort(), [...expectedTrajectories].sort())) {
    throw new Error(`Manifest trajectory inventory mismatch: ${row.runId}`);
  }
  const expectedProxyLedgers = expectedTrajectories.map((path) => `${path}.proxy-ledger/proxy.jsonl`).sort();
  if (!equalJson([...manifest.proxyLedgerPaths].sort(), expectedProxyLedgers)) {
    throw new Error(`Manifest proxy-ledger inventory mismatch: ${row.runId}`);
  }
  if (!equalJson(Object.keys(manifest.artifactSha256).sort(), expectedArtifactPaths(manifest))) {
    throw new Error(`Manifest artifact inventory mismatch: ${row.runId}`);
  }
  if (manifest.caseSetSha256 !== sha256Json({ caseId: row.caseId, workspaceHash })) {
    throw new Error(`Manifest case-set binding mismatch: ${row.runId}`);
  }
  for (const [relativePath, expectedHash] of Object.entries(manifest.artifactSha256)) {
    if (!normalizedRelativePath(relativePath) || typeof expectedHash !== "string") {
      throw new Error(`Invalid manifest artifact declaration: ${row.runId}`);
    }
    const actualHash = await sha256File(resolve(runRoot, ...relativePath.split("/")));
    if (actualHash !== expectedHash) throw new Error(`Manifest artifact hash mismatch: ${row.runId}/${relativePath}`);
  }

  const gate = await readJson(join(runRoot, "gate.json"));
  assertRecord(gate, `gate ${row.runId}`);
  if (manifest.outcome !== gate.status) throw new Error(`Manifest outcome and gate status differ: ${row.runId}`);
  const rescored = await scoreRun(runRoot, { expectedAction });
  rescored.runPath = row.runPath;
  if (!equalJson(rescored, row)) {
    throw new Error(`Evaluation row does not match re-derived run artifacts: ${row.runId}`);
  }

  if (!Array.isArray(manifest.trajectoryPaths) || !Array.isArray(manifest.proxyLedgerPaths)) {
    throw new Error(`Missing trajectory receipts: ${row.runId}`);
  }
  const expectedSessions = row.arm === "baseline" ? 1 : 3;
  if (
    manifest.trajectoryPaths.length !== expectedSessions ||
    manifest.proxyLedgerPaths.length !== expectedSessions
  ) {
    throw new Error(`Model-session count mismatch: ${row.runId}`);
  }
  for (const relativePath of manifest.trajectoryPaths) {
    if (!normalizedRelativePath(relativePath)) throw new Error(`Invalid trajectory path: ${row.runId}`);
    const events = parseJsonLines(
      await readFile(resolve(runRoot, ...relativePath.split("/")), "utf8"),
      `${row.runId}/${relativePath}`,
    );
    if (events.filter((event) => event.type === "turn.completed").length !== 1) {
      throw new Error(`Incomplete model trajectory: ${row.runId}/${relativePath}`);
    }
  }
  for (const relativePath of manifest.proxyLedgerPaths) {
    if (!normalizedRelativePath(relativePath)) throw new Error(`Invalid proxy-ledger path: ${row.runId}`);
    const events = parseJsonLines(
      await readFile(resolve(runRoot, ...relativePath.split("/")), "utf8"),
      `${row.runId}/${relativePath}`,
    );
    const upstream = events.filter((event) => event.type === "upstream_response");
    if (
      upstream.length !== 1 || upstream[0]?.upstreamStatus !== 200 || upstream[0]?.upstreamError !== null ||
      events.some((event) => event.type === "request_rejected" || event.type === "proxy_failure")
    ) {
      throw new Error(`Invalid proxy execution receipt: ${row.runId}/${relativePath}`);
    }
  }
  assertRecord(manifest.tokenUsage, `token usage ${row.runId}`);
  assertRecord(manifest.tokenUsageAccounting, `token accounting ${row.runId}`);
  assertRecord(manifest.tokenUsageAccounting.sessionCoverage, `session coverage ${row.runId}`);
  if (
    manifest.tokenUsageAccounting.sessionCoverage.complete !== true ||
    manifest.tokenUsageAccounting.sessionCoverage.sessionCount !== expectedSessions ||
    manifest.tokenUsageAccounting.sessionCoverage.accountedSessionCount !== expectedSessions
  ) {
    throw new Error(`Incomplete trajectory usage accounting: ${row.runId}`);
  }
  if (
    row.inputTokens !== manifest.tokenUsage.input || row.cachedInputTokens !== manifest.tokenUsage.cachedInput ||
    row.outputTokens !== manifest.tokenUsage.output ||
    row.totalTokens !== (manifest.tokenUsage.input as number) + (manifest.tokenUsage.output as number)
  ) {
    throw new Error(`Row and manifest token totals differ: ${row.runId}`);
  }
  return expectedSessions;
}

function validateSlots(rows: EvaluationRow[], caseIds: string[], trialsPerCase: number, label: string): void {
  const expectedRows = caseIds.length * trialsPerCase * 2;
  if (rows.length !== expectedRows || new Set(rows.map((row) => row.runId)).size !== rows.length) {
    throw new Error(`${label} workflow row count or identity mismatch`);
  }
  const slots = new Set<string>();
  for (const row of rows) {
    const match = /^runs\/([^/]+)\/trial-(\d+)\/(baseline|advanced)$/.exec(row.runPath);
    const trial = Number(match?.[2]);
    if (
      !match || match[1] !== row.caseId || match[3] !== row.arm ||
      trial < 1 || trial > trialsPerCase
    ) {
      throw new Error(`Invalid ${label} workflow slot: ${row.runId}`);
    }
    const slot = `${row.caseId}:${trial}:${row.arm}`;
    if (slots.has(slot)) throw new Error(`Duplicate ${label} workflow slot: ${slot}`);
    slots.add(slot);
  }
}

function validateAggregate(summary: EvaluationSummary, rows: EvaluationRow[], invalidatedWorkflowRows: number): void {
  const aggregate = aggregateRows(rows);
  const selectedAggregate = {
    arms: summary.arms,
    absoluteOdiChange: summary.absoluteOdiChange,
    odiBootstrap95: summary.odiBootstrap95,
    resourceComparison: summary.resourceComparison,
  };
  if (!equalJson(aggregate, selectedAggregate)) {
    throw new Error("Evaluation aggregate metrics do not match re-derived row evidence");
  }
  const expectedTaxonomy = Object.fromEntries(failureClasses.map((failureClass) => [
    failureClass,
    rows.filter((row) => row.failureClass === failureClass).length,
  ])) as Record<string, number>;
  expectedTaxonomy.EVALUATOR_INVALID = invalidatedWorkflowRows;
  if (!equalJson(summary.failureTaxonomy, expectedTaxonomy)) {
    throw new Error("Evaluation failure taxonomy does not match re-derived row evidence");
  }
  if (expectedTaxonomy.INFRASTRUCTURE !== 0) {
    throw new Error("Infrastructure failures cannot be selected as V4 evidence");
  }
}

async function validateRunRows(input: {
  evaluationRoot: string;
  caseRoot: string;
  rows: EvaluationRow[];
  cases: FrozenCase[];
}): Promise<number> {
  const casesById = new Map(input.cases.map((entry) => [entry.caseId, entry]));
  const expectedActions = new Map<string, string>();
  for (const entry of input.cases) {
    expectedActions.set(entry.caseId, (await loadOracleV4(join(input.caseRoot, entry.caseId))).expectedAction);
  }
  let modelSessionCount = 0;
  for (const row of input.rows) {
    const frozenCase = casesById.get(row.caseId);
    const expectedAction = expectedActions.get(row.caseId);
    if (!frozenCase || !expectedAction) throw new Error(`Run row names an unfrozen case: ${row.caseId}`);
    if (row.expectedAction !== expectedAction) {
      throw new Error(`Run row expected action does not match the frozen oracle: ${row.runId}`);
    }
    modelSessionCount += await validateManifest(
      input.evaluationRoot,
      row,
      expectedAction,
      frozenCase.workspaceHash,
    );
  }
  return modelSessionCount;
}

async function validateAdjudicationBundle(input: {
  evaluationRoot: string;
  caseRoot: string;
  lock: V4Lock;
  lockText: string;
  selectedSummary: EvaluationSummary;
  summaryText: string;
  selectedRowsText: string;
  invalidationText: string;
  receipts: Array<{ text: string; receipt: InvalidationReceipt }>;
}): Promise<{ selectedModelSessionCount: number }> {
  if (input.receipts.length === 0) throw new Error("Selected V4 adjudication requires an invalidation receipt");
  const path = join(input.evaluationRoot, "adjudication.json");
  const value = await readJson(path);
  assertRecord(value, "adjudication receipt");
  if (
    value.schemaVersion !== 1 ||
    value.campaign !== input.receipts[0]?.receipt.campaign ||
    value.status !== "VALID_AFTER_SYMMETRIC_EVALUATOR_INVALIDATION" ||
    value.lockSha256 !== sha256Text(input.lockText)
  ) {
    throw new Error("Invalid adjudication status");
  }
  assertRecord(value.rawEvidence, "raw adjudication evidence");
  assertRecord(value.selectedEvidence, "selected adjudication evidence");
  const rawDir = join(input.evaluationRoot, "raw");
  const [rawSummaryText, rawRowsText, rawInvalidationsText] = await Promise.all([
    readFile(join(rawDir, "summary.json"), "utf8"),
    readFile(join(rawDir, "rows.jsonl"), "utf8"),
    readFile(join(rawDir, "evaluator-invalidations.json"), "utf8"),
  ]);
  const rawSummary = JSON.parse(rawSummaryText) as EvaluationSummary;
  if (
    rawSummary.schemaVersion !== 2 || rawSummary.mode !== input.lock.mode || rawSummary.model !== input.lock.model ||
    rawSummary.trialsPerCase !== input.lock.trialsPerCase || !Array.isArray(rawSummary.rows)
  ) {
    throw new Error("Raw V4 summary does not match the frozen campaign");
  }
  const lockedIds = [...input.lock.cases].sort((left, right) => left.caseId.localeCompare(right.caseId))
    .map((entry) => entry.caseId);
  if (
    rawSummary.selection.selectedCaseCount !== lockedIds.length ||
    rawSummary.selection.includedCaseCount !== lockedIds.length ||
    rawSummary.selection.excludedCaseCount !== 0 ||
    !equalJson(rawSummary.selection.includedCaseIds, lockedIds) ||
    !equalJson(rawSummary.selection.excludedCaseIds, []) ||
    rawSummary.selection.selectedCaseSetHash !== input.lock.caseSetHash ||
    rawSummary.selection.selectedCaseDefinitionSetHash !== input.lock.caseDefinitionSetHash ||
    rawSummary.caseSetHash !== input.lock.caseSetHash ||
    rawSummary.caseDefinitionSetHash !== input.lock.caseDefinitionSetHash
  ) {
    throw new Error("Raw V4 case selection does not match the frozen five-case set");
  }
  if (
    !rawSummary.lockVerification ||
    rawSummary.lockVerification.lockSha256 !== sha256Text(input.lockText) ||
    rawSummary.lockVerification.evaluationHarnessCommit !== input.lock.evaluationHarnessCommit ||
    rawSummary.comparisonDesign.class !== "SYSTEM_LEVEL_NON_COMPUTE_MATCHED" ||
    rawSummary.comparisonDesign.baselineSessions !== 1 ||
    rawSummary.comparisonDesign.advancedSessions !== 3
  ) {
    throw new Error("Raw V4 execution design or freeze binding mismatch");
  }
  const rawInvalidations = JSON.parse(rawInvalidationsText);
  if (
    !isRecord(rawInvalidations) || rawInvalidations.schemaVersion !== 1 ||
    !equalJson(rawInvalidations.selectedCaseIds, lockedIds) ||
    !equalJson(rawInvalidations.includedCaseIds, lockedIds) ||
    !equalJson(rawInvalidations.invalidations, [])
  ) {
    throw new Error("Raw V4 invalidation registry was not empty at execution time");
  }

  const rawRowsFromFile = parseJsonLines(rawRowsText, "raw V4 rows") as unknown as EvaluationRow[];
  if (!equalJson(rawRowsFromFile, rawSummary.rows)) {
    throw new Error("Raw V4 rows.jsonl does not match raw summary rows");
  }
  const rawRows = rawSummary.rows.map((row) => (
    validateRow(row, new Set(lockedIds), input.lock.model, input.lock.mode)
  ));
  validateSlots(rawRows, lockedIds, input.lock.trialsPerCase, "raw V4");
  validateAggregate(rawSummary, rawRows, 0);
  await validateRunRows({
    evaluationRoot: input.evaluationRoot,
    caseRoot: input.caseRoot,
    rows: rawRows,
    cases: input.lock.cases,
  });

  const recomputed = adjudicateEvaluationSummary({
    rawSummary,
    lock: input.lock,
    invalidations: input.receipts.map((entry) => entry.receipt),
  });
  if (!equalJson(recomputed, input.selectedSummary)) {
    throw new Error("Selected V4 summary is not the deterministic adjudication of the raw campaign");
  }
  const selectedRowsFromFile = parseJsonLines(input.selectedRowsText, "selected V4 rows") as unknown as EvaluationRow[];
  if (!equalJson(selectedRowsFromFile, input.selectedSummary.rows)) {
    throw new Error("Selected V4 rows.jsonl does not match selected summary rows");
  }

  const receipt = input.receipts[0];
  if (
    input.receipts.length !== 1 || !receipt ||
    value.invalidationReceiptSha256 !== sha256Text(receipt.text) ||
    typeof value.invalidationReceipt !== "string" ||
    !value.invalidationReceipt.replaceAll("\\", "/").endsWith(
      `holdout/v4/EVALUATOR-INVALIDATION-${receipt.receipt.caseId}.json`,
    )
  ) {
    throw new Error("Adjudication receipt is not bound to the evaluator invalidation");
  }
  if (
    value.rawEvidence.summarySha256 !== sha256Text(rawSummaryText) ||
    value.rawEvidence.rowsSha256 !== sha256Text(rawRowsText) ||
    value.rawEvidence.evaluatorInvalidationsSha256 !== sha256Text(rawInvalidationsText) ||
    value.rawEvidence.workflowRunCount !== rawRows.length ||
    value.selectedEvidence.summarySha256 !== sha256Text(input.summaryText) ||
    value.selectedEvidence.rowsSha256 !== sha256Text(input.selectedRowsText) ||
    value.selectedEvidence.evaluatorInvalidationsSha256 !== sha256Text(input.invalidationText) ||
    value.selectedEvidence.workflowRunCount !== input.selectedSummary.rows.length
  ) {
    throw new Error("Adjudication evidence hash mismatch");
  }
  return {
    selectedModelSessionCount: input.selectedSummary.rows.reduce(
      (sum, row) => sum + (row.arm === "baseline" ? 1 : 3),
      0,
    ),
  };
}

export async function verifySelectedV4Campaign(
  root: string,
  campaign: string,
  selectedSummary: string,
  options: { verifyGit?: boolean } = {},
): Promise<SelectedV4ValidationResult> {
  const absoluteRoot = resolve(root);
  const expectedSummary = `artifacts/evaluation/${campaign}/summary.json`;
  if (selectedSummary !== expectedSummary || !normalizedRelativePath(selectedSummary)) {
    throw new Error("Selected V4 summary path is not canonical for its campaign");
  }
  const evaluationRoot = resolve(absoluteRoot, "artifacts", "evaluation", campaign);
  const summaryPath = join(evaluationRoot, "summary.json");
  const [summaryText, selectedRowsText] = await Promise.all([
    readFile(summaryPath, "utf8"),
    readFile(join(evaluationRoot, "rows.jsonl"), "utf8"),
  ]);
  const summary = JSON.parse(summaryText) as EvaluationSummary & Record<string, unknown>;
  assertRecord(summary, "selected V4 summary");
  if (summary.schemaVersion !== 2 || summary.mode !== "live" || typeof summary.model !== "string") {
    throw new Error("Selected V4 summary is not a live schema-v2 campaign");
  }
  assertInteger(summary.trialsPerCase, "selected V4 trial count", 1);
  assertRecord(summary.selection, "selected V4 selection");
  if (!Array.isArray(summary.rows)) throw new Error("Selected V4 summary has no rows");

  const lockRelativePath = deriveLockPath(campaign);
  const lockPath = resolve(absoluteRoot, ...lockRelativePath.split("/"));
  const lockText = await readFile(lockPath, "utf8");
  const lock = JSON.parse(lockText) as V4Lock;
  if (
    lock.schemaVersion !== 2 || lock.status !== "FROZEN_BEFORE_MODEL_EXECUTION" ||
    lock.model !== summary.model || lock.mode !== summary.mode || lock.trialsPerCase !== summary.trialsPerCase ||
    !normalizedRelativePath(lock.caseRoot) || !Array.isArray(lock.cases) || !Array.isArray(lock.caseDefinitions) ||
    !isRecord(lock.contracts) || !/^[a-f0-9]{40}$/.test(lock.systemFreezeCommit) ||
    !/^[a-f0-9]{40}$/.test(lock.holdoutDefinitionCommit)
  ) {
    throw new Error("Selected V4 lock does not match the summary contract");
  }
  assertRecord(summary.lockVerification, "selected V4 lock verification");
  if (
    summary.lockVerification.lockSha256 !== sha256Text(lockText) ||
    summary.lockVerification.evaluationHarnessCommit !== lock.evaluationHarnessCommit
  ) {
    throw new Error("Selected V4 lock verification mismatch");
  }
  if (options.verifyGit !== false) {
    await verifyFreezeProvenance(absoluteRoot, lockRelativePath, lockText, lock);
  }

  for (const [relativePath, expectedHash] of Object.entries(lock.contracts)) {
    if (!normalizedRelativePath(relativePath) || typeof expectedHash !== "string") {
      throw new Error("Invalid frozen contract declaration");
    }
    if (await sha256File(resolve(absoluteRoot, ...relativePath.split("/"))) !== expectedHash) {
      throw new Error(`Frozen contract hash mismatch: ${relativePath}`);
    }
  }
  const caseRoot = resolve(absoluteRoot, ...lock.caseRoot.split("/"));
  if ((await snapshotTree(caseRoot)).sha256 !== lock.holdoutTreeHash) {
    throw new Error("Frozen V4 holdout tree hash mismatch");
  }
  const recomputedCases: FrozenCase[] = [];
  const recomputedDefinitions: FrozenDefinition[] = [];
  for (const entry of [...lock.cases].sort((left, right) => left.caseId.localeCompare(right.caseId))) {
    const caseDir = join(caseRoot, entry.caseId);
    recomputedCases.push({ caseId: entry.caseId, workspaceHash: (await snapshotTree(join(caseDir, "workspace"))).sha256 });
    recomputedDefinitions.push({ caseId: entry.caseId, sha256: (await snapshotTree(caseDir)).sha256 });
  }
  if (!equalJson(recomputedCases, [...lock.cases].sort((left, right) => left.caseId.localeCompare(right.caseId)))) {
    throw new Error("Frozen V4 workspace hash mismatch");
  }
  if (!equalJson(recomputedDefinitions, [...lock.caseDefinitions].sort((left, right) => left.caseId.localeCompare(right.caseId)))) {
    throw new Error("Frozen V4 definition hash mismatch");
  }
  if (sha256Json(recomputedCases) !== lock.caseSetHash || sha256Json(recomputedDefinitions) !== lock.caseDefinitionSetHash) {
    throw new Error("Frozen V4 aggregate case hash mismatch");
  }

  const receipts = await loadCampaignInvalidations(absoluteRoot, campaign);
  const invalidatedIds = receipts.map((entry) => entry.receipt.caseId).sort();
  for (const { receipt } of receipts) {
    if (
      receipt.schemaVersion !== 1 || receipt.status !== "EVALUATOR_INVALID" ||
      receipt.publicComparisonEligible !== false || receipt.disposition?.excludedSymmetrically !== true
    ) {
      throw new Error(`Invalid evaluator-invalidation receipt: ${receipt.caseId}`);
    }
  }
  const lockedIds = recomputedCases.map((entry) => entry.caseId);
  const includedIds = lockedIds.filter((caseId) => !invalidatedIds.includes(caseId));
  if (
    summary.selection.selectedCaseCount !== lockedIds.length ||
    summary.selection.includedCaseCount !== includedIds.length ||
    summary.selection.excludedCaseCount !== invalidatedIds.length ||
    !equalJson(summary.selection.includedCaseIds, includedIds) ||
    !equalJson(summary.selection.excludedCaseIds, invalidatedIds) ||
    summary.selection.selectedCaseSetHash !== lock.caseSetHash ||
    summary.selection.selectedCaseDefinitionSetHash !== lock.caseDefinitionSetHash
  ) {
    throw new Error("Selected V4 case disposition does not match evaluator receipts");
  }
  const includedCases = recomputedCases.filter((entry) => includedIds.includes(entry.caseId));
  const includedDefinitions = recomputedDefinitions.filter((entry) => includedIds.includes(entry.caseId));
  if (
    summary.caseSetHash !== sha256Json(includedCases) ||
    summary.caseDefinitionSetHash !== sha256Json(includedDefinitions)
  ) {
    throw new Error("Selected V4 included-case hashes do not match the freeze");
  }

  const rows = summary.rows.map((row) => validateRow(row, new Set(includedIds), summary.model, summary.mode));
  validateSlots(rows, includedIds, summary.trialsPerCase, "selected V4");
  validateAggregate(summary, rows, invalidatedIds.length * summary.trialsPerCase * 2);

  const invalidationPath = join(evaluationRoot, "evaluator-invalidations.json");
  const invalidationText = await readFile(invalidationPath, "utf8");
  const invalidationRecord = JSON.parse(invalidationText);
  assertRecord(invalidationRecord, "campaign invalidation registry");
  if (
    !equalJson(invalidationRecord.selectedCaseIds, lockedIds) ||
    !equalJson(invalidationRecord.includedCaseIds, includedIds) ||
    !Array.isArray(invalidationRecord.invalidations) || invalidationRecord.invalidations.length !== receipts.length
  ) {
    throw new Error("Campaign invalidation registry does not match selected cases");
  }
  for (const receipt of receipts) {
    const entry = invalidationRecord.invalidations.find((candidate: unknown) => (
      isRecord(candidate) && candidate.caseId === receipt.receipt.caseId
    ));
    if (!isRecord(entry) || entry.sourceReceiptSha256 !== sha256Text(receipt.text)) {
      throw new Error(`Campaign invalidation receipt hash mismatch: ${receipt.receipt.caseId}`);
    }
  }
  const adjudication = await validateAdjudicationBundle({
    evaluationRoot,
    caseRoot,
    lock,
    lockText,
    selectedSummary: summary,
    summaryText,
    selectedRowsText,
    invalidationText,
    receipts,
  });

  return {
    workflowRunCount: rows.length,
    modelSessionCount: adjudication.selectedModelSessionCount,
    caseSetHash: summary.caseSetHash as string,
    selectedCaseCount: lockedIds.length,
    includedCaseCount: includedIds.length,
    invalidatedCaseCount: invalidatedIds.length,
  };
}
