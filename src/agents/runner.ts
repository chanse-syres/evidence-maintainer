export type AgentRole = "baseline" | "maintainer" | "challenger";

export type ModelExecutionFailureKind = "TIMEOUT" | "INVALID_OUTPUT" | "INVALID_OPERATION";

export class ModelExecutionError extends Error {
  readonly kind: ModelExecutionFailureKind;

  constructor(kind: ModelExecutionFailureKind, message: string) {
    super(message);
    this.name = "ModelExecutionError";
    this.kind = kind;
  }
}

export class InfrastructureExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InfrastructureExecutionError";
  }
}

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
