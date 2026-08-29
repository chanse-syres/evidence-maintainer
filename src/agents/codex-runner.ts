import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { once } from "node:events";
import {
  InfrastructureExecutionError,
  ModelExecutionError,
  type AgentRequest,
  type AgentResult,
  type AgentRunner,
  type ProxyRequestUsageCoverage,
  type TokenUsageSource,
} from "./runner.ts";
import { readProxyLedger, type ProxyLedgerSummary } from "./proxy-ledger.ts";

export const CODEX_RUNNER_IMAGE = "evidence-maintainer-codex:0.150.0-alpha.8";
export const CODEX_RUNNER_IMAGE_ID =
  "sha256:1aede06b3e83a7816241abcee33302a0363b09eca39b5ae3d0baf84b36b2c5f5";

export function createCodexArgs<T>(
  request: AgentRequest<T>,
  proxyBaseUrl = "http://credential-gateway:8080/backend-api/codex",
): string[] {
  return [
    "exec",
    "--config",
    `model_providers.evidence_proxy={name="Evidence credential gateway",base_url="${proxyBaseUrl}",wire_api="responses",requires_openai_auth=false,supports_websockets=false}`,
    "--config",
    "model_provider=\"evidence_proxy\"",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--json",
    "--sandbox",
    "read-only",
    "--model",
    request.model,
    "--output-schema",
    "/contracts/output-schema.json",
    "--cd",
    "/workspace",
    "-",
  ];
}

export function createDockerCodexArgs<T>(
  request: AgentRequest<T>,
  containerName: string,
  networkName: string,
  image = CODEX_RUNNER_IMAGE,
): string[] {
  return [
    "create",
    "--interactive",
    "--name",
    containerName,
    "--network",
    networkName,
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "256",
    "--cpus",
    "2",
    "--memory",
    "4g",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=256m",
    "--tmpfs",
    "/home/node/.codex:rw,noexec,nosuid,nodev,size=64m,uid=1000,gid=1000,mode=0700",
    "--mount",
    `type=bind,source=${resolve(request.workspace)},target=/workspace,readonly`,
    "--mount",
    `type=bind,source=${resolve(request.outputSchemaPath)},target=/contracts/output-schema.json,readonly`,
    image,
    ...createCodexArgs(request),
  ];
}

export function createProxyDockerArgs<T>(
  request: AgentRequest<T>,
  proxyName: string,
  ledgerDirectory: string,
  authPath: string,
  image = CODEX_RUNNER_IMAGE,
): string[] {
  return [
    "run",
    "--detach",
    "--rm",
    "--name",
    proxyName,
    "--network",
    "bridge",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "64",
    "--cpus",
    "0.5",
    "--memory",
    "192m",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=32m",
    "--mount",
    `type=bind,source=${resolve(authPath)},target=/run/secrets/codex-auth.json,readonly`,
    "--mount",
    `type=bind,source=${resolve(ledgerDirectory)},target=/run/evidence`,
    "--env",
    `CODEX_PROXY_ALLOWED_MODEL=${request.model}`,
    "--env",
    "CODEX_PROXY_LEDGER_PATH=/run/evidence/proxy.jsonl",
    "--entrypoint",
    "node",
    image,
    "/opt/evidence-maintainer/credential-proxy.mjs",
  ];
}

export function classifyAgentTermination(input: {
  timedOut: boolean;
  created: boolean;
  started: boolean;
  exitCode: number | null;
  oomKilled: boolean;
  budgetExhausted?: boolean;
}):
  | { owner: "success" }
  | { owner: "infrastructure" }
  | { owner: "model"; kind: "TIMEOUT" | "BUDGET_EXHAUSTED" | "RESOURCE_EXHAUSTED" | "AGENT_EXIT" } {
  if (input.timedOut) return { owner: "model", kind: "TIMEOUT" };
  if (!input.created || !input.started || input.exitCode === null) return { owner: "infrastructure" };
  if (input.budgetExhausted) return { owner: "model", kind: "BUDGET_EXHAUSTED" };
  if (input.oomKilled) return { owner: "model", kind: "RESOURCE_EXHAUSTED" };
  if (input.exitCode !== 0) return { owner: "model", kind: "AGENT_EXIT" };
  return { owner: "success" };
}

interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runProcess(
  executable: string,
  args: string[],
  input?: string,
): Promise<ProcessResult> {
  const child = spawn(executable, args, {
    shell: false,
    windowsHide: true,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout!.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr!.on("data", (chunk: Buffer) => stderr.push(chunk));
  if (input !== undefined) child.stdin!.end(input, "utf8");
  let code: number | null;
  try {
    [code] = await Promise.race([
      once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>,
      once(child, "error").then(([error]) => { throw error; }),
    ]);
  } catch (error) {
    throw new InfrastructureExecutionError(
      `Failed to launch ${executable}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    code: code ?? 1,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}

function extractOutput(events: unknown[]): unknown {
  for (const event of [...events].reverse()) {
    if (typeof event !== "object" || event === null) continue;
    const record = event as Record<string, unknown>;
    const item = typeof record.item === "object" && record.item !== null
      ? record.item as Record<string, unknown>
      : null;
    const raw = item?.type === "agent_message" && typeof item.text === "string"
      ? item.text
      : typeof record.output === "object" && record.output !== null
        ? record.output
        : null;
    if (raw && typeof raw === "object") return raw;
    if (typeof raw === "string") {
      const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      try {
        return JSON.parse(cleaned);
      } catch {
        continue;
      }
    }
  }
  throw new Error("No structured agent output was present in the Codex trajectory");
}

export function extractCodexUsage(
  events: unknown[],
): { input: number; cachedInput: number; output: number } | undefined {
  const completed = events.filter((event) => (
    typeof event === "object" &&
    event !== null &&
    (event as Record<string, unknown>).type === "turn.completed"
  ));
  if (completed.length !== 1) return undefined;
  for (const event of completed) {
    if (typeof event !== "object" || event === null) continue;
    const usage = (event as Record<string, unknown>).usage;
    if (typeof usage !== "object" || usage === null) continue;
    const record = usage as Record<string, unknown>;
    const input = record.input_tokens ?? record.input;
    const cachedInput = record.cached_input_tokens ?? record.cachedInput ?? 0;
    const output = record.output_tokens ?? record.output;
    if (
      typeof input === "number" && Number.isInteger(input) &&
      typeof cachedInput === "number" && Number.isInteger(cachedInput) &&
      typeof output === "number" && Number.isInteger(output) &&
      input >= 0 &&
      cachedInput >= 0 &&
      cachedInput <= input &&
      output >= 0
    ) {
      return { input, cachedInput, output };
    }
  }
  return undefined;
}

export function resolveUsageEvidence(
  proxySummary: ProxyLedgerSummary,
  trajectoryUsage: { input: number; cachedInput: number; output: number } | undefined,
): {
  usage?: { input: number; cachedInput: number; output: number };
  source?: TokenUsageSource;
  trajectoryAggregateCaptured: boolean;
  proxyRequestCoverage: ProxyRequestUsageCoverage;
} {
  const proxyUsage = proxySummary.usage ?? undefined;
  const partialProxyUsage = proxySummary.accountedUsage ?? undefined;
  if (
    proxyUsage &&
    trajectoryUsage &&
    (
      proxyUsage.input !== trajectoryUsage.input ||
      proxyUsage.cachedInput !== trajectoryUsage.cachedInput ||
      proxyUsage.output !== trajectoryUsage.output
    )
  ) {
    throw new InfrastructureExecutionError("Proxy and Codex trajectory usage receipts disagree");
  }
  if (
    !proxyUsage &&
    partialProxyUsage &&
    trajectoryUsage &&
    (
      partialProxyUsage.input > trajectoryUsage.input ||
      partialProxyUsage.cachedInput > trajectoryUsage.cachedInput ||
      partialProxyUsage.output > trajectoryUsage.output
    )
  ) {
    throw new InfrastructureExecutionError("Partial proxy usage exceeds the Codex trajectory aggregate");
  }
  const usage = proxyUsage ?? trajectoryUsage;
  const source: TokenUsageSource | undefined = proxyUsage
    ? "PROXY_REQUEST_SUM"
    : trajectoryUsage
      ? "TRAJECTORY_TURN_COMPLETED"
      : undefined;
  return {
    ...(usage ? { usage } : {}),
    ...(source ? { source } : {}),
    trajectoryAggregateCaptured: trajectoryUsage !== undefined,
    proxyRequestCoverage: {
      requestCount: proxySummary.coverage.requestCount,
      accountedRequestCount: proxySummary.coverage.accountedRequestCount,
      complete: proxySummary.coverage.complete,
    },
  };
}

export class CodexRunner implements AgentRunner {
  private readonly dockerExecutable: string;
  private readonly image: string;
  private readonly authPath: string;

  constructor(
    dockerExecutable = process.env.DOCKER_BIN ?? "docker",
    authPath = process.env.CODEX_AUTH_PATH ?? join(process.env.USERPROFILE ?? "", ".codex", "auth.json"),
  ) {
    this.dockerExecutable = dockerExecutable;
    this.image = CODEX_RUNNER_IMAGE;
    this.authPath = authPath;
  }

  async run<T>(request: AgentRequest<T>): Promise<AgentResult<T>> {
    const started = new Date();
    if (!this.authPath || !process.env.USERPROFILE && !process.env.CODEX_AUTH_PATH) {
      throw new InfrastructureExecutionError("Codex credential path is not configured");
    }
    try {
      await Promise.all([
        access(request.workspace),
        access(request.outputSchemaPath),
        access(this.authPath),
      ]);
    } catch (error) {
      throw new InfrastructureExecutionError(
        `Codex isolation preflight failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const stderrPath = `${request.trajectoryPath}.stderr.log`;
    await mkdir(dirname(request.trajectoryPath), { recursive: true });
    const proxyLedgerDirectory = `${request.trajectoryPath}.proxy-ledger`;
    const proxyLedgerPath = join(proxyLedgerDirectory, "proxy.jsonl");
    await mkdir(proxyLedgerDirectory, { recursive: true });
    const containerName = `evidence-maintainer-codex-${randomUUID()}`;
    const proxyName = `evidence-maintainer-proxy-${randomUUID()}`;
    const networkName = `evidence-maintainer-net-${randomUUID()}`;
    let networkCreated = false;
    let proxyStarted = false;
    try {
      const imageCheck = await runProcess(this.dockerExecutable, [
        "image",
        "inspect",
        "--format",
        "{{.Id}}",
        this.image,
      ]);
      if (imageCheck.code !== 0) {
        throw new InfrastructureExecutionError(
          `Pinned Codex runner image is unavailable: ${imageCheck.stderr.trim() || this.image}`,
        );
      }
      if (imageCheck.stdout.trim() !== CODEX_RUNNER_IMAGE_ID) {
        throw new InfrastructureExecutionError(
          `Codex runner image does not match the frozen image ID ${CODEX_RUNNER_IMAGE_ID}`,
        );
      }
      const network = await runProcess(this.dockerExecutable, ["network", "create", "--internal", networkName]);
      if (network.code !== 0) {
        throw new InfrastructureExecutionError(
          `Could not create the isolated model network: ${network.stderr.trim() || `exit ${network.code}`}`,
        );
      }
      networkCreated = true;
      const proxy = await runProcess(this.dockerExecutable, createProxyDockerArgs(
        request,
        proxyName,
        proxyLedgerDirectory,
        this.authPath,
        this.image,
      ));
      if (proxy.code !== 0) {
        throw new InfrastructureExecutionError(
          `Credential gateway could not start: ${proxy.stderr.trim() || `exit ${proxy.code}`}`,
        );
      }
      proxyStarted = true;
      const connected = await runProcess(this.dockerExecutable, [
        "network",
        "connect",
        "--alias",
        "credential-gateway",
        networkName,
        proxyName,
      ]);
      if (connected.code !== 0) {
        throw new InfrastructureExecutionError(
          `Credential gateway could not join the isolated network: ${connected.stderr.trim() || `exit ${connected.code}`}`,
        );
      }
      let ready = false;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const logs = await runProcess(this.dockerExecutable, ["logs", proxyName]);
        if (logs.stdout.includes("READY 8080")) {
          ready = true;
          break;
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      }
      if (!ready) throw new InfrastructureExecutionError("Credential gateway did not become ready");

      const gatewayHealth = await runProcess(this.dockerExecutable, [
        "run",
        "--rm",
        "--network",
        networkName,
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--entrypoint",
        "node",
        this.image,
        "--input-type=module",
        "--eval",
        'const response = await fetch("http://credential-gateway:8080/healthz"); if (!response.ok || (await response.text()).trim() !== "ok") process.exit(1);',
      ]);
      if (gatewayHealth.code !== 0) {
        throw new InfrastructureExecutionError(
          `Credential gateway was not reachable from the isolated model network: ${gatewayHealth.stderr.trim() || `exit ${gatewayHealth.code}`}`,
        );
      }

      const trajectoryStream = createWriteStream(request.trajectoryPath, { encoding: "utf8" });
      const stderrChunks: Buffer[] = [];
      const stdoutChunks: Buffer[] = [];
      const created = await runProcess(this.dockerExecutable, createDockerCodexArgs(
        request,
        containerName,
        networkName,
        this.image,
      ));
      if (created.code !== 0) {
        trajectoryStream.end();
        await once(trajectoryStream, "finish");
        throw new InfrastructureExecutionError(
          `Codex container could not be created: ${created.stderr.trim() || `exit ${created.code}`}`,
        );
      }
      const child = spawn(this.dockerExecutable, ["start", "--attach", "--interactive", containerName], {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
        trajectoryStream.write(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
      child.stdin.end(request.prompt, "utf8");
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
        const cleanup = spawn(this.dockerExecutable, ["rm", "-f", containerName], {
          shell: false,
          windowsHide: true,
          stdio: "ignore",
        });
        cleanup.on("error", () => undefined);
      }, request.timeoutMs);
      try {
        await Promise.race([
          once(child, "close"),
          once(child, "error").then(([error]) => { throw error; }),
        ]);
      } catch (error) {
        clearTimeout(timeout);
        trajectoryStream.end();
        await once(trajectoryStream, "finish");
        throw new InfrastructureExecutionError(
          `Codex container could not start: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      clearTimeout(timeout);
      trajectoryStream.end();
      await once(trajectoryStream, "finish");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      await writeFile(stderrPath, stderr, "utf8");
      if (timedOut) throw new ModelExecutionError("TIMEOUT", `Codex run timed out after ${request.timeoutMs}ms`);

      const stateResult = await runProcess(this.dockerExecutable, [
        "inspect",
        "--format",
        "{{json .State}}",
        containerName,
      ]);
      if (stateResult.code !== 0) {
        throw new InfrastructureExecutionError(
          `Codex container state could not be inspected: ${stateResult.stderr.trim() || `exit ${stateResult.code}`}`,
        );
      }
      let state: { ExitCode: number; OOMKilled: boolean; Error: string; StartedAt: string };
      try {
        state = JSON.parse(stateResult.stdout) as typeof state;
      } catch (error) {
        throw new InfrastructureExecutionError(
          `Codex container state was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const startedCleanly = Boolean(state.StartedAt && !state.StartedAt.startsWith("0001-") && !state.Error);
      let proxySummary: ProxyLedgerSummary;
      try {
        proxySummary = await readProxyLedger(proxyLedgerPath);
      } catch (error) {
        throw new InfrastructureExecutionError(
          `Credential gateway ledger could not be verified: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (proxySummary.proxyFailure || proxySummary.upstreamFailure) {
        throw new InfrastructureExecutionError("Credential gateway or upstream model service failed during the session");
      }
      const termination = classifyAgentTermination({
        timedOut: false,
        created: true,
        started: startedCleanly,
        exitCode: state.ExitCode,
        oomKilled: state.OOMKilled,
        budgetExhausted: proxySummary.budgetExhausted,
      });
      if (termination.owner === "infrastructure") {
        throw new InfrastructureExecutionError(
          `Codex container did not execute cleanly: ${state.Error || "missing start evidence"}`,
        );
      }
      if (termination.owner === "model") {
        throw new ModelExecutionError(
          termination.kind,
          `Codex agent ended with ${termination.kind} (exit ${state.ExitCode}): ${stderr.trim() || "no diagnostic output"}`,
        );
      }
      if (proxySummary.coverage.requestCount === 0) {
        throw new InfrastructureExecutionError("Credential gateway recorded no successful model request");
      }
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      let events: unknown[];
      try {
        events = stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as unknown);
      } catch (error) {
        throw new InfrastructureExecutionError(
          `Codex trajectory was not valid JSONL: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      let output: T;
      try {
        output = request.parse(extractOutput(events));
      } catch (error) {
        throw new ModelExecutionError(
          "INVALID_OUTPUT",
          `Codex output validation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const finished = new Date();
      const usageEvidence = resolveUsageEvidence(proxySummary, extractCodexUsage(events));
      return {
        mode: "live",
        role: request.role,
        model: request.model,
        startedAt: started.toISOString(),
        finishedAt: finished.toISOString(),
        durationMs: finished.getTime() - started.getTime(),
        exitCode: state.ExitCode,
        output,
        trajectoryPath: request.trajectoryPath,
        runtimeImageId: imageCheck.stdout.trim(),
        proxyLedgerPath,
        trajectoryAggregateCaptured: usageEvidence.trajectoryAggregateCaptured,
        proxyRequestUsageCoverage: usageEvidence.proxyRequestCoverage,
        ...(usageEvidence.usage ? { tokenUsage: usageEvidence.usage } : {}),
        ...(usageEvidence.source ? { tokenUsageSource: usageEvidence.source } : {}),
      };
    } finally {
      await runProcess(this.dockerExecutable, ["rm", "-f", containerName]).catch(() => undefined);
      if (proxyStarted) {
        await runProcess(this.dockerExecutable, ["rm", "-f", proxyName]).catch(() => undefined);
      }
      if (networkCreated) {
        await runProcess(this.dockerExecutable, ["network", "rm", networkName]).catch(() => undefined);
      }
    }
  }
}
