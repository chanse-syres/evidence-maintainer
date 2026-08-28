import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentRequest, AgentResult, AgentRunner } from "./runner.ts";

type FixtureMap = Record<string, unknown>;

function event(type: string, request: AgentRequest<unknown>, at: string, payload: Record<string, unknown> = {}) {
  return {
    type,
    mode: "recorded",
    at,
    runId: request.runId,
    caseId: request.caseId,
    role: request.role,
    model: request.model,
    ...payload,
  };
}

export class RecordedRunner implements AgentRunner {
  private readonly fixturePath: string;

  constructor(fixturePath: string) {
    this.fixturePath = fixturePath;
  }

  async run<T>(request: AgentRequest<T>): Promise<AgentResult<T>> {
    const started = new Date();
    const fixtures = JSON.parse(await readFile(this.fixturePath, "utf8")) as FixtureMap;
    const key = `${request.caseId}:${request.role}`;
    if (!(key in fixtures)) {
      throw new Error(`Missing recorded fixture for ${key}`);
    }
    const output = request.parse(fixtures[key]);
    const finished = new Date();
    const rows = [
      event("run.started", request as AgentRequest<unknown>, started.toISOString(), {
        prompt: request.prompt,
        outputSchemaPath: request.outputSchemaPath,
      }),
      event("agent.output", request as AgentRequest<unknown>, finished.toISOString(), { output }),
      event("run.completed", request as AgentRequest<unknown>, finished.toISOString(), {
        exitCode: 0,
        durationMs: Math.max(0, finished.getTime() - started.getTime()),
      }),
    ];
    await mkdir(dirname(request.trajectoryPath), { recursive: true });
    await writeFile(request.trajectoryPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
    return {
      mode: "recorded",
      role: request.role,
      model: request.model,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: Math.max(0, finished.getTime() - started.getTime()),
      exitCode: 0,
      output,
      trajectoryPath: request.trajectoryPath,
    };
  }
}
