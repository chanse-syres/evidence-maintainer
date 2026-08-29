import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { AgentRequest, AgentResult, AgentRunner } from "../src/agents/runner.ts";
import type { ChallengerVerdict, MaintainerProposal } from "../src/core/schemas.ts";
import { runAdvanced } from "../src/workflows/advanced.ts";

const updateProposal: MaintainerProposal = {
  schemaVersion: 1,
  caseId: "update-official-commitment",
  action: "UPDATE_DATA",
  firstMaterialDivergence: "The official announcement supersedes discovery data.",
  failureOwner: "canonical-data",
  evidenceUsed: ["obs-official-commitment"],
  evidenceRejected: ["obs-older-aggregator"],
  affectedEntities: ["athlete-11"],
  affectedFiles: ["input/canonical.json"],
  operations: [{
    kind: "SET_RECORD_FIELDS",
    file: "input/canonical.json",
    recordId: "athlete-11",
    assignments: [
      { field: "status", value: "committed" },
      { field: "team", value: "Coastal State" },
    ],
  }],
  preservedInvariants: ["Stable athlete identity is preserved"],
  unresolvedUncertainty: [],
  minimumInformationRequest: [],
  retryCondition: null,
  approvalLevel: "SIMULATED_HUMAN",
  summary: "Apply the official commitment state.",
};

const confirmUpdate: ChallengerVerdict = {
  schemaVersion: 1,
  caseId: "update-official-commitment",
  verdict: "CONFIRM",
  evidenceIds: ["obs-official-commitment"],
  violations: [],
  residualRisks: [],
  summary: "The official source owns both changed fields.",
};

class SequenceRunner implements AgentRunner {
  readonly roles: string[] = [];
  private readonly outputs: unknown[];
  private readonly sideEffect?: (request: AgentRequest<unknown>) => Promise<void>;

  constructor(outputs: unknown[], sideEffect?: (request: AgentRequest<unknown>) => Promise<void>) {
    this.outputs = [...outputs];
    this.sideEffect = sideEffect;
  }

  async run<T>(request: AgentRequest<T>): Promise<AgentResult<T>> {
    this.roles.push(request.role);
    if (this.sideEffect) await this.sideEffect(request as AgentRequest<unknown>);
    const output = request.parse(this.outputs.shift());
    const at = "2026-08-28T20:00:00.000Z";
    await writeFile(request.trajectoryPath, `${JSON.stringify({ type: "run.started", mode: "recorded" })}\n${JSON.stringify({ type: "run.completed", mode: "recorded", output })}\n`, "utf8");
    return {
      mode: "recorded",
      role: request.role,
      model: request.model,
      startedAt: at,
      finishedAt: at,
      durationMs: 0,
      exitCode: 0,
      output,
      trajectoryPath: request.trajectoryPath,
    };
  }
}

test("advanced workflow runs Maintainer then Challenger and approves a verified update", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-advanced-happy-"));
  const runner = new SequenceRunner([updateProposal, confirmUpdate]);
  const run = await runAdvanced({
    caseDir: resolve("cases", "update-official-commitment"),
    runRoot: root,
    runner,
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: true,
  });
  assert.deepEqual(runner.roles, ["maintainer", "challenger"]);
  assert.equal(run.outcome, "PASS");
  const canonical = JSON.parse(await readFile(join(root, "workspace", "input", "canonical.json"), "utf8"));
  const gate = JSON.parse(await readFile(join(root, "gate.json"), "utf8"));
  const approval = JSON.parse(await readFile(join(root, "approval.json"), "utf8"));
  assert.equal(canonical[0].status, "committed");
  assert.ok(gate.checks.every((check: { passed: boolean }) => check.passed));
  assert.equal(approval.decision, "APPROVED");
});

test("a Challenger rejection prevents approval", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-advanced-reject-"));
  const runner = new SequenceRunner([
    updateProposal,
    { ...confirmUpdate, verdict: "REJECT", violations: ["Claim is not supported"] },
  ]);
  const run = await runAdvanced({
    caseDir: resolve("cases", "update-official-commitment"),
    runRoot: root,
    runner,
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: true,
  });
  const approval = JSON.parse(await readFile(join(root, "approval.json"), "utf8"));
  assert.equal(run.outcome, "FAIL");
  assert.equal(approval.decision, "REJECTED");
});

test("unknown evidence IDs fail the evidence-supported gate", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-advanced-unknown-"));
  const proposal = { ...updateProposal, evidenceUsed: ["invented-evidence"] };
  const verdict = { ...confirmUpdate, evidenceIds: ["invented-evidence"] };
  await runAdvanced({
    caseDir: resolve("cases", "update-official-commitment"),
    runRoot: root,
    runner: new SequenceRunner([proposal, verdict]),
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: true,
  });
  const gate = JSON.parse(await readFile(join(root, "gate.json"), "utf8"));
  assert.ok(gate.checks.some((check: { id: string; passed: boolean }) => check.id === "evidence-supported" && !check.passed));
});

test("an unrelated direct workspace modification is caught", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-advanced-unrelated-"));
  let modified = false;
  const runner = new SequenceRunner([updateProposal, confirmUpdate], async (request) => {
    if (request.role === "maintainer" && !modified) {
      modified = true;
      await writeFile(join(request.workspace, "unrelated.txt"), "not allowed\n", "utf8");
    }
  });
  const run = await runAdvanced({
    caseDir: resolve("cases", "update-official-commitment"),
    runRoot: root,
    runner,
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: true,
  });
  assert.equal(run.outcome, "FAIL");
  const gate = JSON.parse(await readFile(join(root, "gate.json"), "utf8"));
  assert.ok(gate.checks.some((check: { id: string; passed: boolean }) => check.id === "allowed-write-surface" && !check.passed));
});

test("Challenger escalation passes only for a no-mutation human review with minimum information", async () => {
  const source = resolve("cases", "noop-duplicate-news");
  const caseRoot = await mkdtemp(join(tmpdir(), "evidence-review-case-"));
  await cp(source, caseRoot, { recursive: true });
  await writeFile(join(caseRoot, "oracle.json"), `${JSON.stringify({
    schemaVersion: 1,
    caseId: "noop-duplicate-news",
    expectedAction: "HUMAN_REVIEW",
    requiredEvidenceIds: ["obs-1", "obs-2"],
    allowedChangedFiles: [],
    expectedRecords: [],
    requiredChallengerVerdict: "ESCALATE",
    requiredMinimumInformation: ["stable roster ID"],
    requiredRetryConditionIncludes: [],
    expectedCommandExitCodes: {},
  }, null, 2)}\n`, "utf8");
  const proposal: MaintainerProposal = {
    ...updateProposal,
    caseId: "noop-duplicate-news",
    action: "HUMAN_REVIEW",
    evidenceUsed: ["obs-1", "obs-2"],
    affectedEntities: ["athlete-7"],
    affectedFiles: [],
    operations: [],
    minimumInformationRequest: ["stable roster ID"],
    summary: "Occurrence identity needs review.",
  };
  const verdict: ChallengerVerdict = {
    ...confirmUpdate,
    caseId: "noop-duplicate-news",
    verdict: "ESCALATE",
    evidenceIds: ["obs-1", "obs-2"],
  };
  const root = await mkdtemp(join(tmpdir(), "evidence-advanced-escalate-"));
  const run = await runAdvanced({
    caseDir: caseRoot,
    runRoot: root,
    runner: new SequenceRunner([proposal, verdict]),
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: true,
  });
  assert.equal(run.outcome, "PASS");

  const missingRoot = await mkdtemp(join(tmpdir(), "evidence-advanced-escalate-missing-"));
  const missingInformation = { ...proposal, minimumInformationRequest: [] };
  const missingRun = await runAdvanced({
    caseDir: caseRoot,
    runRoot: missingRoot,
    runner: new SequenceRunner([missingInformation, verdict]),
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: true,
  });
  assert.equal(missingRun.outcome, "FAIL");
  const missingGate = JSON.parse(await readFile(join(missingRoot, "gate.json"), "utf8"));
  assert.ok(missingGate.checks.some(
    (check: { id: string; passed: boolean }) => check.id === "required-artifact" && !check.passed,
  ));
});
