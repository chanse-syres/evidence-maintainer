import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { MaintainerProposalSchema } from "../src/core/schemas.ts";
import {
  classifyAgentTermination,
  createCodexArgs,
  createDockerCodexArgs,
  createProxyDockerArgs,
  extractCodexUsage,
  resolveUsageEvidence,
} from "../src/agents/codex-runner.ts";
import { loadPrompt } from "../src/agents/prompt-loader.ts";
import { RecordedRunner } from "../src/agents/recorded-runner.ts";
import type { AgentRole } from "../src/agents/runner.ts";

test("reviser is a first-class agent role", () => {
  const role: AgentRole = "reviser";
  assert.equal(role, "reviser");
});

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
    "--config",
    'model_providers.evidence_proxy={name="Evidence credential gateway",base_url="http://credential-gateway:8080/backend-api/codex",wire_api="responses",requires_openai_auth=false,supports_websockets=false}',
    "--config",
    'model_provider="evidence_proxy"',
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--json",
    "--sandbox",
    "read-only",
    "--model",
    "gpt-5.6-terra",
    "--output-schema",
    "/contracts/output-schema.json",
    "--cd",
    "/workspace",
    "-",
  ]);
});

test("Codex runner mounts only one read-only workspace and schema behind an internal gateway", () => {
  const request = {
    runId: "live-run",
    role: "maintainer" as const,
    caseId: "case-1",
    workspace: "C:/isolated/case-1",
    prompt: "Act safely.",
    outputSchemaPath: "C:/isolated/schema.json",
    model: "gpt-5.6-terra",
    timeoutMs: 120_000,
    trajectoryPath: "C:/artifacts/live.jsonl",
    parse: (value: unknown) => value,
  };
  const args = createDockerCodexArgs(request, "run-123", "isolated-net");
  assert.ok(args.includes("--read-only"));
  assert.ok(args.includes("--interactive"));
  assert.ok(args.includes("ALL"));
  assert.ok(args.includes("no-new-privileges"));
  assert.ok(args.includes("isolated-net"));
  assert.ok(args.includes("type=bind,source=C:\\isolated\\case-1,target=/workspace,readonly"));
  assert.ok(args.includes("type=bind,source=C:\\isolated\\schema.json,target=/contracts/output-schema.json,readonly"));
  assert.equal(args.some((value) => /auth\.json|oracle|artifacts|docker\.sock/i.test(value)), false);
  assert.equal(args.some((value) => value === "--env" || value === "-e"), false);
  assert.ok(args.some((value) => value.includes("http://credential-gateway:8080/backend-api/codex")));
});

test("credential gateway is pinned to the requested model and writes only to its private ledger mount", () => {
  const request = {
    runId: "live-run",
    role: "maintainer" as const,
    caseId: "case-1",
    workspace: "C:/isolated/case-1",
    prompt: "Act safely.",
    outputSchemaPath: "C:/isolated/schema.json",
    model: "gpt-5.6-terra",
    timeoutMs: 120_000,
    trajectoryPath: "C:/artifacts/live.jsonl",
    parse: (value: unknown) => value,
  };
  const args = createProxyDockerArgs(
    request,
    "proxy-123",
    "C:/isolated/proxy-ledger",
    "C:/isolated/auth.json",
  );
  assert.ok(args.includes("CODEX_PROXY_ALLOWED_MODEL=gpt-5.6-terra"));
  assert.ok(args.includes("CODEX_PROXY_LEDGER_PATH=/run/evidence/proxy.jsonl"));
  assert.ok(args.includes("type=bind,source=C:\\isolated\\proxy-ledger,target=/run/evidence"));
  assert.equal(createDockerCodexArgs(request, "run-123", "isolated-net").some((value) => /proxy-ledger|run\/evidence/i.test(value)), false);
});

test("agent termination distinguishes owned limits from infrastructure", () => {
  assert.deepEqual(classifyAgentTermination({ timedOut: true, created: true, started: true, exitCode: 137, oomKilled: true }), { owner: "model", kind: "TIMEOUT" });
  assert.deepEqual(classifyAgentTermination({ timedOut: false, created: false, started: false, exitCode: null, oomKilled: false }), { owner: "infrastructure" });
  assert.deepEqual(classifyAgentTermination({ timedOut: false, created: true, started: true, exitCode: 1, oomKilled: false, budgetExhausted: true }), { owner: "model", kind: "BUDGET_EXHAUSTED" });
  assert.deepEqual(classifyAgentTermination({ timedOut: false, created: true, started: true, exitCode: 137, oomKilled: true }), { owner: "model", kind: "RESOURCE_EXHAUSTED" });
  assert.deepEqual(classifyAgentTermination({ timedOut: false, created: true, started: true, exitCode: 2, oomKilled: false }), { owner: "model", kind: "AGENT_EXIT" });
  assert.deepEqual(classifyAgentTermination({ timedOut: false, created: true, started: true, exitCode: 0, oomKilled: false }), { owner: "success" });
});

test("Codex usage preserves cached input without double-counting it", () => {
  const usage = extractCodexUsage([
    { type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 4 } },
  ]);
  assert.deepEqual(usage, { input: 10, cachedInput: 2, output: 4 });
  assert.equal(extractCodexUsage([
    { type: "turn.completed", usage: { input_tokens: 7, cached_input_tokens: 1, output_tokens: 3 } },
    { type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 4 } },
  ]), undefined);
  assert.equal(extractCodexUsage([
    { type: "item.completed", usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 4 } },
  ]), undefined);
  assert.equal(extractCodexUsage([
    { type: "turn.completed", usage: { input_tokens: 10.5, cached_input_tokens: 2, output_tokens: 4 } },
  ]), undefined);
});

test("trajectory aggregate supplies honest usage when upstream omits usage receipts", () => {
  const resolved = resolveUsageEvidence({
    usage: null,
    accountedUsage: null,
    coverage: { requestCount: 1, accountedRequestCount: 0, complete: false },
    budgetExhausted: false,
    proxyFailure: false,
    upstreamFailure: false,
  }, { input: 12_738, cachedInput: 0, output: 330 });

  assert.deepEqual(resolved, {
    usage: { input: 12_738, cachedInput: 0, output: 330 },
    source: "TRAJECTORY_TURN_COMPLETED",
    trajectoryAggregateCaptured: true,
    proxyRequestCoverage: {
      requestCount: 1,
      accountedRequestCount: 0,
      complete: false,
    },
  });
});

test("proxy and trajectory usage must agree before either can be treated as complete evidence", () => {
  const summary = {
    usage: { input: 100, cachedInput: 20, output: 30 },
    accountedUsage: { input: 100, cachedInput: 20, output: 30 },
    coverage: { requestCount: 1, accountedRequestCount: 1, complete: true },
    budgetExhausted: false,
    proxyFailure: false,
    upstreamFailure: false,
  };
  assert.equal(resolveUsageEvidence(summary, { input: 100, cachedInput: 20, output: 30 }).source, "PROXY_REQUEST_SUM");
  assert.throws(
    () => resolveUsageEvidence(summary, { input: 101, cachedInput: 20, output: 30 }),
    /usage receipts disagree/i,
  );
});

test("a trajectory fallback cannot be smaller than already-accounted proxy usage", () => {
  const summary = {
    usage: null,
    accountedUsage: { input: 80, cachedInput: 10, output: 20 },
    coverage: { requestCount: 2, accountedRequestCount: 1, complete: false },
    budgetExhausted: false,
    proxyFailure: false,
    upstreamFailure: false,
  };
  assert.throws(
    () => resolveUsageEvidence(summary, { input: 79, cachedInput: 10, output: 20 }),
    /partial proxy usage exceeds/i,
  );
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
