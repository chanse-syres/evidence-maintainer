import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { AgentRequest, AgentResult, AgentRunner } from "../src/agents/runner.ts";
import { ChallengerVerdictSchema, MaintainerProposalSchema } from "../src/core/schemas.ts";
import { runAdvanced } from "../src/workflows/advanced.ts";

const recordedFixtures = JSON.parse(
  await readFile(resolve("artifacts", "recorded", "runner-fixtures.json"), "utf8"),
) as Record<string, unknown>;
const updateProposal = MaintainerProposalSchema.parse(
  recordedFixtures["update-official-commitment:maintainer"],
);
const confirmUpdate = ChallengerVerdictSchema.parse(
  recordedFixtures["update-official-commitment:challenger"],
);

class SequenceRunner implements AgentRunner {
  readonly roles: string[] = [];
  readonly prompts: string[] = [];
  private readonly outputs: unknown[];
  private readonly usages: Array<{ input: number; cachedInput: number; output: number } | undefined>;
  private readonly sideEffect?: (request: AgentRequest<unknown>) => Promise<void>;

  constructor(
    outputs: unknown[],
    sideEffect?: (request: AgentRequest<unknown>) => Promise<void>,
    usages: Array<{ input: number; cachedInput: number; output: number } | undefined> = [],
  ) {
    this.outputs = [...outputs];
    this.sideEffect = sideEffect;
    this.usages = [...usages];
  }

  async run<T>(request: AgentRequest<T>): Promise<AgentResult<T>> {
    this.roles.push(request.role);
    this.prompts.push(request.prompt);
    if (this.sideEffect) await this.sideEffect(request as AgentRequest<unknown>);
    const output = request.parse(this.outputs.shift());
    const at = "2026-08-28T20:00:00.000Z";
    await writeFile(request.trajectoryPath, `${JSON.stringify({ type: "run.started", mode: "recorded" })}\n${JSON.stringify({ type: "run.completed", mode: "recorded", output })}\n`, "utf8");
    const tokenUsage = this.usages.shift();
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
      tokenUsage,
      ...(tokenUsage
        ? {
            tokenUsageSource: "TRAJECTORY_TURN_COMPLETED" as const,
            trajectoryAggregateCaptured: true,
            proxyRequestUsageCoverage: {
              requestCount: 1,
              accountedRequestCount: 0,
              complete: false,
            },
          }
        : {}),
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
  assert.match(runner.prompts[0], /gate and simulated approval run after/i);
  assert.match(runner.prompts[0], /not\s+prerequisites/i);
  assert.match(runner.prompts[0], /RETRY_LATER[^]*temporary or incomplete source state/i);
  assert.match(runner.prompts[0], /REPAIR_ADAPTER[^]*writable adapter code/i);
  assert.match(runner.prompts[0], /HUMAN_REVIEW[^]*missing decisive evidence/i);
  assert.match(runner.prompts[0], /NO_ACTION[^]*canonical state should remain\s+unchanged/i);
  assert.equal(run.outcome, "PASS");
  const canonical = JSON.parse(await readFile(join(root, "workspace", "input", "canonical.json"), "utf8"));
  const gate = JSON.parse(await readFile(join(root, "gate.json"), "utf8"));
  const approval = JSON.parse(await readFile(join(root, "approval.json"), "utf8"));
  assert.equal(canonical[0].status, "committed");
  assert.ok(gate.checks.every((check: { passed: boolean }) => check.passed));
  assert.equal(approval.decision, "APPROVED");
});

test("advanced workflow rejects any Challenger workspace mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-advanced-challenger-write-"));
  const runner = new SequenceRunner(
    [updateProposal, confirmUpdate],
    async (request) => {
      if (request.role === "challenger") {
        await writeFile(join(request.workspace, "input", "canonical.json"), "[]\n", "utf8");
      }
    },
  );
  await assert.rejects(
    () => runAdvanced({
      caseDir: resolve("cases", "update-official-commitment"),
      runRoot: root,
      runner,
      model: "recorded-fixture",
      timeoutMs: 30_000,
      approve: true,
    }),
    /Challenger modified the candidate workspace/,
  );
});

test("advanced workflow sums input, cached input, and output usage across both agents", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-advanced-token-usage-"));
  const runner = new SequenceRunner(
    [updateProposal, confirmUpdate],
    undefined,
    [
      { input: 120, cachedInput: 80, output: 12 },
      { input: 90, cachedInput: 64, output: 8 },
    ],
  );
  const run = await runAdvanced({
    caseDir: resolve("cases", "update-official-commitment"),
    runRoot: root,
    runner,
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: true,
  });
  assert.deepEqual(run.tokenUsage, { input: 210, cachedInput: 144, output: 20 });
});

test("Maintainer and Challenger receive the complete agent-visible workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-advanced-workspace-snapshot-"));
  const fixtures = JSON.parse(
    await readFile(resolve("artifacts", "recorded", "runner-fixtures.json"), "utf8"),
  ) as Record<string, unknown>;
  const runner = new SequenceRunner([
    fixtures["repair-json-nesting:maintainer"],
    fixtures["repair-json-nesting:challenger"],
  ]);
  const run = await runAdvanced({
    caseDir: resolve("cases", "repair-json-nesting"),
    runRoot: root,
    runner,
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: true,
  });
  assert.equal(run.outcome, "PASS");
  for (const prompt of runner.prompts) {
    assert.match(prompt, /export function extractPlayers/);
    assert.match(prompt, /\\"roster\\"/);
    assert.match(prompt, /adapter\.test\.ts/);
  }
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
  const proposal = {
    ...updateProposal,
    evidenceAssessments: updateProposal.evidenceAssessments.map((entry) => ({
      ...entry,
      evidenceId: "invented-evidence",
    })),
  };
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

test("human review accepts an adjudicated resolving-information bundle and rejects a vague substitute", async () => {
  const proposal = MaintainerProposalSchema.parse(recordedFixtures["review-name-collision:maintainer"]);
  const verdict = ChallengerVerdictSchema.parse(recordedFixtures["review-name-collision:challenger"]);
  const root = await mkdtemp(join(tmpdir(), "evidence-advanced-review-"));
  const run = await runAdvanced({
    caseDir: resolve("cases", "review-name-collision"),
    runRoot: root,
    runner: new SequenceRunner([proposal, verdict]),
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: true,
  });
  assert.equal(run.outcome, "PASS");

  const alternateRoot = await mkdtemp(join(tmpdir(), "evidence-advanced-review-alternate-"));
  const alternate = MaintainerProposalSchema.parse({
    ...proposal,
    reviewRequest: {
      subjectId: "Jordan Lee",
      targetEvidenceId: "obs-name-only-award",
      requestedFactPaths: ["facts.program", "facts.graduationYear"],
    },
  });
  const alternateRun = await runAdvanced({
    caseDir: resolve("cases", "review-name-collision"),
    runRoot: alternateRoot,
    runner: new SequenceRunner([alternate, verdict]),
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: true,
  });
  assert.equal(alternateRun.outcome, "PASS");

  const vagueRoot = await mkdtemp(join(tmpdir(), "evidence-advanced-review-vague-"));
  const vague = MaintainerProposalSchema.parse({
    ...proposal,
    reviewRequest: {
      subjectId: "Unknown Jordan Lee",
      targetEvidenceId: "obs-name-only-award",
      requestedFactPaths: ["facts.stableId"],
    },
  });
  const vagueRun = await runAdvanced({
    caseDir: resolve("cases", "review-name-collision"),
    runRoot: vagueRoot,
    runner: new SequenceRunner([vague, verdict]),
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: true,
  });
  assert.equal(vagueRun.outcome, "FAIL");
  const vagueGate = JSON.parse(await readFile(join(vagueRoot, "gate.json"), "utf8"));
  assert.ok(vagueGate.checks.some(
    (check: { id: string; passed: boolean }) => check.id === "required-artifact" && !check.passed,
  ));
});
