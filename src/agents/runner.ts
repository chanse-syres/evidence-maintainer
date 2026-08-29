export type AgentRole = "baseline" | "maintainer" | "challenger";

export interface AgentRequest<T> {
  runId: string;
  role: AgentRole;
  caseId: string;
  workspace: string;
  prompt: string;
  outputSchemaPath: string;
  model: string;
  timeoutMs: number;
  trajectoryPath: string;
  parse: (value: unknown) => T;
}

export interface AgentResult<T> {
  mode: "live" | "recorded";
  role: AgentRole;
  model: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number;
  output: T;
  trajectoryPath: string;
  tokenUsage?: { input: number; cachedInput: number; output: number };
}

export interface AgentRunner {
  run<T>(request: AgentRequest<T>): Promise<AgentResult<T>>;
}
