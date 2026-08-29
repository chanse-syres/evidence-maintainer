import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { RecordedRunner } from "../src/agents/recorded-runner.ts";
import type { AgentRequest, AgentResult, AgentRunner } from "../src/agents/runner.ts";
import { runBaseline } from "../src/workflows/baseline.ts";

class InspectingRunner implements AgentRunner {
  readonly roles: string[] = [];
  private readonly inner: AgentRunner;

  constructor(inner: AgentRunner) {
    this.inner = inner;
  }

  async run<T>(request: AgentRequest<T>): Promise<AgentResult<T>> {
    this.roles.push(request.role);
    assert.equal(request.role, "baseline");
    assert.doesNotMatch(request.prompt, /expectedAction|oracle\.json|allowedChangedFiles/);
    assert.match(request.prompt, /obs-1/);
    assert.match(request.prompt, /canonical/);
    assert.match(request.prompt, /policy/);
    await assert.rejects(() => access(join(request.workspace, "oracle.json")));
    return this.inner.run(request);
  }
}

test("baseline runs one direct agent without oracle leakage and records a gated approval", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-baseline-"));
  const runner = new InspectingRunner(
    new RecordedRunner(resolve("artifacts", "recorded", "runner-fixtures.json")),
  );
  const run = await runBaseline({
    caseDir: resolve("cases", "noop-duplicate-news"),
    runRoot: root,
    runner,
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: true,
  });
  assert.deepEqual(runner.roles, ["baseline"]);
  assert.equal(run.arm, "baseline");
  assert.equal(run.mode, "recorded");
  assert.equal(run.outcome, "PASS");
  const approval = JSON.parse(await readFile(join(root, "approval.json"), "utf8"));
  const gate = JSON.parse(await readFile(join(root, "gate.json"), "utf8"));
  const result = JSON.parse(await readFile(join(root, "baseline-result.json"), "utf8"));
  assert.equal(approval.decision, "APPROVED");
  assert.equal(gate.status, "PASS");
  assert.equal(result.action, "NO_ACTION");
  assert.ok(run.artifactSha256["gate.json"]);
  await access(join(root, "manifest.json"));
  await access(join(root, "before-tree.json"));
  await access(join(root, "after-tree.json"));
  await access(join(root, "trajectories", "baseline.jsonl"));
});

test("baseline approval remains withheld when the operator did not approve", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-baseline-no-approval-"));
  await runBaseline({
    caseDir: resolve("cases", "noop-duplicate-news"),
    runRoot: root,
    runner: new RecordedRunner(resolve("artifacts", "recorded", "runner-fixtures.json")),
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: false,
  });
  const approval = JSON.parse(await readFile(join(root, "approval.json"), "utf8"));
  assert.equal(approval.decision, "NOT_REQUESTED");
});

test("baseline receives the complete agent-visible workspace without terminal access", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-baseline-workspace-snapshot-"));
  class WorkspaceSnapshotRunner implements AgentRunner {
    private readonly inner = new RecordedRunner(resolve("artifacts", "recorded", "runner-fixtures.json"));

    async run<T>(request: AgentRequest<T>): Promise<AgentResult<T>> {
      assert.match(request.prompt, /export function extractPlayers/);
      assert.match(request.prompt, /\\"roster\\"/);
      assert.match(request.prompt, /adapter\.test\.ts/);
      return this.inner.run(request);
    }
  }

  await runBaseline({
    caseDir: resolve("cases", "repair-json-nesting"),
    runRoot: root,
    runner: new WorkspaceSnapshotRunner(),
    model: "recorded-fixture",
    timeoutMs: 30_000,
    approve: true,
  });
});
