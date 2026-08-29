import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { posix, resolve } from "node:path";
import { z } from "zod";
import { InfrastructureExecutionError } from "../agents/runner.ts";
import { canonicalJson } from "./canonical-json.ts";
import type { CommandResult } from "./deterministic-gate.ts";

export const REQUIRED_COMMAND_IMAGE =
  "node@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d";

const NODE_TEST_COMMAND = /^node --experimental-strip-types --test ([A-Za-z0-9._/-]+\.test\.ts)$/;

const HiddenProbeFileSchema = z.object({
  schemaVersion: z.literal(1),
  exportName: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/),
  cases: z.array(z.object({
    id: z.string().min(1),
    args: z.array(z.json()),
    expected: z.json(),
  }).strict()).min(1),
}).strict();

interface DockerState {
  ExitCode: number;
  OOMKilled: boolean;
  Error: string;
  StartedAt: string;
}

interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

const candidateProbeSource = (exportName: string) => `
import { createInterface } from "node:readline";
const candidateModule = await import("file:///workspace/adapter.ts");
const candidate = candidateModule[${JSON.stringify(exportName)}];
if (typeof candidate !== "function") {
  process.stderr.write("Requested adapter export is not a function.\\n");
  process.exit(2);
}
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  const request = JSON.parse(line);
  try {
    const value = await candidate(...request.args);
    process.stdout.write(JSON.stringify({ id: request.id, ok: true, value }) + "\\n");
  } catch {
    process.stdout.write(JSON.stringify({ id: request.id, ok: false }) + "\\n");
  }
}
`;

export function parseRequiredCommand(command: string): string[] {
  const match = NODE_TEST_COMMAND.exec(command);
  const rawPath = match?.[1] ?? "";
  const normalizedPath = posix.normalize(rawPath);
  if (
    !match ||
    !rawPath ||
    rawPath.startsWith("/") ||
    rawPath.includes("\\") ||
    normalizedPath === "." ||
    normalizedPath.startsWith("../") ||
    normalizedPath !== rawPath
  ) {
    throw new InfrastructureExecutionError(`Required command is outside the evaluator allowlist: ${command}`);
  }
  return ["node", "--experimental-strip-types", "--test", normalizedPath];
}

function hardenedContainerArgs(workspace: string, containerName: string): string[] {
  return [
    "create",
    "--name",
    containerName,
    "--network",
    "none",
    "--read-only",
    "--user",
    "1000:1000",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "64",
    "--cpus",
    "1",
    "--memory",
    "512m",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=64m,uid=1000,gid=1000,mode=0700",
    "--mount",
    `type=bind,source=${resolve(workspace)},target=/workspace,readonly`,
    "--workdir",
    "/workspace",
  ];
}

export function createDockerCommandArgs(
  workspace: string,
  command: string,
  containerName: string,
): string[] {
  return [
    ...hardenedContainerArgs(workspace, containerName),
    REQUIRED_COMMAND_IMAGE,
    ...parseRequiredCommand(command),
  ];
}

export function createHiddenProbeDockerArgs(
  workspace: string,
  containerName: string,
  exportName: string,
): string[] {
  return [
    ...hardenedContainerArgs(workspace, containerName),
    "--interactive",
    REQUIRED_COMMAND_IMAGE,
    "node",
    "--experimental-strip-types",
    "--input-type=module",
    "--eval",
    candidateProbeSource(exportName),
  ];
}

export function validateNodeTestResult(result: CommandResult): CommandResult {
  if (result.exitCode !== 0) return result;
  const output = `${result.stdout}\n${result.stderr}`;
  const hasPassingTests = /(?:#|ℹ)\s*pass\s+[1-9]\d*/iu.test(output);
  const hasZeroFailures = /(?:#|ℹ)\s*fail\s+0\b/iu.test(output);
  if (hasPassingTests && hasZeroFailures) return result;
  return {
    ...result,
    exitCode: 1,
    stderr: `${result.stderr}${result.stderr ? "\n" : ""}Missing trusted TAP completion evidence.`,
  };
}

async function runProcess(executable: string, args: string[]): Promise<ProcessResult> {
  const child = spawn(executable, args, {
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  let code: number | null;
  try {
    [code] = await Promise.race([
      once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>,
      once(child, "error").then(([error]) => { throw error; }),
    ]);
  } catch (error) {
    throw new InfrastructureExecutionError(
      `Unable to run Docker control command: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    code: code ?? 1,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}

async function forceRemoveContainer(dockerExecutable: string, name: string): Promise<void> {
  await runProcess(dockerExecutable, ["rm", "-f", name]).catch(() => undefined);
}

async function runCreatedContainer(input: {
  createArgs: string[];
  containerName: string;
  stdin?: string;
  timeoutMs: number;
}): Promise<CommandResult> {
  const dockerExecutable = process.env.DOCKER_BIN ?? "docker";
  const created = await runProcess(dockerExecutable, input.createArgs);
  if (created.code !== 0) {
    throw new InfrastructureExecutionError(
      `Unable to create isolated command container: ${created.stderr.trim() || `exit ${created.code}`}`,
    );
  }
  try {
    const startArgs = ["start", "--attach"];
    if (input.stdin !== undefined) startArgs.push("--interactive");
    startArgs.push(input.containerName);
    const child = spawn(dockerExecutable, startArgs, {
      shell: false,
      windowsHide: true,
      stdio: [input.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout!.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr!.on("data", (chunk: Buffer) => stderr.push(chunk));
    if (input.stdin !== undefined) child.stdin!.end(input.stdin, "utf8");
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
      void forceRemoveContainer(dockerExecutable, input.containerName);
    }, input.timeoutMs);
    try {
      await Promise.race([
        once(child, "close"),
        once(child, "error").then(([error]) => { throw error; }),
      ]);
    } catch (error) {
      clearTimeout(timeout);
      throw new InfrastructureExecutionError(
        `Unable to start isolated command container: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    clearTimeout(timeout);
    if (timedOut) {
      return {
        exitCode: 124,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: `${Buffer.concat(stderr).toString("utf8")}Command exceeded the evaluator timeout.`,
      };
    }
    const inspected = await runProcess(dockerExecutable, [
      "inspect",
      "--format",
      "{{json .State}}",
      input.containerName,
    ]);
    if (inspected.code !== 0) {
      throw new InfrastructureExecutionError(
        `Unable to inspect isolated command container: ${inspected.stderr.trim() || `exit ${inspected.code}`}`,
      );
    }
    let state: DockerState;
    try {
      state = JSON.parse(inspected.stdout) as DockerState;
    } catch (error) {
      throw new InfrastructureExecutionError(
        `Isolated command state was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!state.StartedAt || state.StartedAt.startsWith("0001-") || state.Error) {
      throw new InfrastructureExecutionError(
        `Isolated command container never started cleanly: ${state.Error || "missing start timestamp"}`,
      );
    }
    return {
      exitCode: state.ExitCode,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    };
  } finally {
    await forceRemoveContainer(dockerExecutable, input.containerName);
  }
}

export async function runRequiredCommandIsolated(
  command: string,
  workspace: string,
  timeoutMs = 30_000,
): Promise<CommandResult> {
  const containerName = `evidence-maintainer-command-${randomUUID()}`;
  const result = await runCreatedContainer({
    createArgs: createDockerCommandArgs(workspace, command, containerName),
    containerName,
    timeoutMs,
  });
  return validateNodeTestResult(result);
}

export async function runHiddenProbeIsolated(
  workspace: string,
  probeFile: string,
  timeoutMs = 30_000,
): Promise<CommandResult> {
  let probe: z.infer<typeof HiddenProbeFileSchema>;
  try {
    probe = HiddenProbeFileSchema.parse(JSON.parse(await readFile(resolve(probeFile), "utf8")));
  } catch (error) {
    throw new InfrastructureExecutionError(
      `Hidden probe definition is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const containerName = `evidence-maintainer-probe-${randomUUID()}`;
  const requestBody = `${probe.cases.map((entry) => JSON.stringify({ id: entry.id, args: entry.args })).join("\n")}\n`;
  const candidateResult = await runCreatedContainer({
    createArgs: createHiddenProbeDockerArgs(workspace, containerName, probe.exportName),
    containerName,
    stdin: requestBody,
    timeoutMs,
  });
  if (candidateResult.exitCode !== 0) return candidateResult;
  const responses = new Map<string, unknown>();
  let invalidOutputCount = 0;
  for (const line of candidateResult.stdout.split(/\r?\n/).filter(Boolean)) {
    try {
      const value = JSON.parse(line) as { id?: unknown; ok?: unknown; value?: unknown };
      if (typeof value.id !== "string" || value.ok !== true || responses.has(value.id)) {
        invalidOutputCount += 1;
        continue;
      }
      responses.set(value.id, value.value);
    } catch {
      invalidOutputCount += 1;
    }
  }
  let passed = 0;
  let failed = invalidOutputCount;
  for (const expected of probe.cases) {
    const actual = responses.get(expected.id);
    if (actual !== undefined && canonicalJson(actual) === canonicalJson(expected.expected)) passed += 1;
    else failed += 1;
  }
  for (const responseId of responses.keys()) {
    if (!probe.cases.some((entry) => entry.id === responseId)) failed += 1;
  }
  return {
    exitCode: failed === 0 ? 0 : 1,
    stdout: `# pass ${passed}\n# fail ${failed}\n`,
    stderr: failed === 0 ? "" : "One or more private generalization probes failed.\n",
  };
}
