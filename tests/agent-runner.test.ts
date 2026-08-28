import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { MaintainerProposalSchema } from "../src/core/schemas.ts";
import { createCodexArgs } from "../src/agents/codex-runner.ts";
import { loadPrompt } from "../src/agents/prompt-loader.ts";
import { RecordedRunner } from "../src/agents/recorded-runner.ts";

test("recorded runner validates output and writes truth-labeled trajectory boundaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-recorded-runner-"));
  const trajectoryPath = join(root, "trajectory.jsonl");
  const runner = new RecordedRunner(resolve("artifacts", "recorded", "runner-fixtures.json"));
  const result = await runner.run({
    runId: "test-run",
    role: "maintainer",
    caseId: "update-official-commitment",
    workspace: root,
    prompt: "Select a safe action.",
    outputSchemaPath: resolve("schemas", "maintainer-proposal.schema.json"),
    model: "recorded-fixture",
    timeoutMs: 10_000,
    trajectoryPath,
    parse: (value) => MaintainerProposalSchema.parse(value),
  });
  const rows = (await readFile(trajectoryPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(result.mode, "recorded");
  assert.equal(result.output.action, "UPDATE_DATA");
  assert.equal(result.tokenUsage, undefined);
  assert.equal(rows[0].type, "run.started");
  assert.equal(rows.at(-1).type, "run.completed");
  assert.ok(rows.every((row) => row.mode === "recorded"));
});

test("recorded runner rejects a missing case-role fixture", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-recorded-missing-"));
  const runner = new RecordedRunner(resolve("artifacts", "recorded", "runner-fixtures.json"));
  await assert.rejects(() => runner.run({
    runId: "missing-run",
    role: "challenger",
    caseId: "not-a-case",
    workspace: root,
    prompt: "Challenge it.",
    outputSchemaPath: resolve("schemas", "challenger-verdict.schema.json"),
    model: "recorded-fixture",
    timeoutMs: 10_000,
    trajectoryPath: join(root, "missing.jsonl"),
    parse: (value) => value,
  }), /missing recorded fixture/i);
});

test("Codex runner builds a shell-free argument vector", () => {
  const request = {
    runId: "live-run",
    role: "maintainer" as const,
    caseId: "case-1",
    workspace: "C:/sandbox/case-1",
    prompt: "Act safely.",
    outputSchemaPath: "C:/schemas/maintainer.json",
    model: "gpt-5.6-terra",
    timeoutMs: 120_000,
    trajectoryPath: "C:/artifacts/live.jsonl",
    parse: (value: unknown) => value,
  };
  assert.deepEqual(createCodexArgs(request), [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--json",
    "--sandbox",
    "workspace-write",
    "--model",
    "gpt-5.6-terra",
    "--output-schema",
    "C:/schemas/maintainer.json",
    "--cd",
    "C:/sandbox/case-1",
    "-",
  ]);
});

test("prompt loader performs explicit substitutions and rejects unresolved variables", async () => {
  const rendered = await loadPrompt("maintainer", {
    CASE_ID: "update-official-commitment",
    CASE_CONTEXT: "Context",
    EVIDENCE_LEDGER: "{}",
    OUTPUT_CONTRACT: "Schema",
  });
  assert.match(rendered, /update-official-commitment/);
  assert.match(rendered, /Context/);
  assert.doesNotMatch(rendered, /\{\{[A-Z_]+\}\}/);
  await assert.rejects(() => loadPrompt("maintainer", { CASE_ID: "only-one" }), /unresolved prompt variable/i);
});
