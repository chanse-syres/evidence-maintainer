import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { once } from "node:events";
import type { AgentRequest, AgentResult, AgentRunner } from "./runner.ts";

export class AgentExecutionError extends Error {
  readonly trajectoryPath: string;
  readonly stderrPath: string;
  readonly exitCode: number | null;

  constructor(
    message: string,
    trajectoryPath: string,
    stderrPath: string,
    exitCode: number | null,
  ) {
    super(message);
    this.name = "AgentExecutionError";
    this.trajectoryPath = trajectoryPath;
    this.stderrPath = stderrPath;
    this.exitCode = exitCode;
  }
}

export function createCodexArgs<T>(request: AgentRequest<T>): string[] {
  return [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--json",
    "--sandbox",
    "workspace-write",
    "--model",
    request.model,
    "--output-schema",
    request.outputSchemaPath,
    "--cd",
    request.workspace,
    "-",
  ];
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

function extractUsage(events: unknown[]): { input: number; output: number } | undefined {
  for (const event of [...events].reverse()) {
    if (typeof event !== "object" || event === null) continue;
    const usage = (event as Record<string, unknown>).usage;
    if (typeof usage !== "object" || usage === null) continue;
    const record = usage as Record<string, unknown>;
    const input = record.input_tokens ?? record.input;
    const output = record.output_tokens ?? record.output;
    if (typeof input === "number" && typeof output === "number") {
      return { input, output };
    }
  }
  return undefined;
}

export class CodexRunner implements AgentRunner {
  private readonly executable: string;

  constructor(executable = process.env.CODEX_BIN ?? "codex") {
    this.executable = executable;
  }

  async run<T>(request: AgentRequest<T>): Promise<AgentResult<T>> {
    const started = new Date();
    const stderrPath = `${request.trajectoryPath}.stderr.log`;
    await mkdir(dirname(request.trajectoryPath), { recursive: true });
    const trajectoryStream = createWriteStream(request.trajectoryPath, { encoding: "utf8" });
    const stderrChunks: Buffer[] = [];
    const stdoutChunks: Buffer[] = [];
    const child = spawn(this.executable, createCodexArgs(request), {
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
    }, request.timeoutMs);
    const [exitCode] = await once(child, "close") as [number | null, NodeJS.Signals | null];
    clearTimeout(timeout);
    trajectoryStream.end();
    await once(trajectoryStream, "finish");
    const stderr = Buffer.concat(stderrChunks).toString("utf8");
    await writeFile(stderrPath, stderr, "utf8");
    if (timedOut) {
      throw new AgentExecutionError(`Codex run timed out after ${request.timeoutMs}ms`, request.trajectoryPath, stderrPath, exitCode);
    }
    if (exitCode !== 0) {
      throw new AgentExecutionError(`Codex exited with code ${exitCode}`, request.trajectoryPath, stderrPath, exitCode);
    }
    const stdout = Buffer.concat(stdoutChunks).toString("utf8");
    const events = stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as unknown);
    let output: T;
    try {
      output = request.parse(extractOutput(events));
    } catch (error) {
      throw new AgentExecutionError(
        `Codex output validation failed: ${error instanceof Error ? error.message : String(error)}`,
        request.trajectoryPath,
        stderrPath,
        exitCode,
      );
    }
    const finished = new Date();
    const tokenUsage = extractUsage(events);
    return {
      mode: "live",
      role: request.role,
      model: request.model,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: finished.getTime() - started.getTime(),
      exitCode,
      output,
      trajectoryPath: request.trajectoryPath,
      ...(tokenUsage ? { tokenUsage } : {}),
    };
  }
}
