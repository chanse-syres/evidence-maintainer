import type {
  AgentRole,
  ProxyRequestUsageCoverage,
  TokenUsageSource,
} from "../agents/runner.ts";

export interface UsageTotal {
  input: number;
  cachedInput: number;
  output: number;
}

export interface UsageSessionInput {
  role: AgentRole;
  usage?: UsageTotal;
  source?: TokenUsageSource;
  trajectoryPath: string;
  proxyLedgerPath?: string;
  trajectoryAggregateCaptured: boolean;
  proxyRequestCoverage: ProxyRequestUsageCoverage;
}

export function buildTokenUsageAccounting(sessions: UsageSessionInput[]) {
  if (sessions.length === 0) throw new Error("Token usage accounting requires at least one session");
  const roles = sessions.map((session) => session.role);
  if (new Set(roles).size !== roles.length) throw new Error("Token usage session roles must be unique");

  const normalizedSessions = sessions.map((session) => ({
    role: session.role,
    usage: session.usage ?? null,
    source: session.source ?? "UNAVAILABLE" as const,
    trajectoryPath: session.trajectoryPath,
    proxyLedgerPath: session.proxyLedgerPath ?? null,
    trajectoryAggregateCaptured: session.trajectoryAggregateCaptured,
    proxyRequestCoverage: session.proxyRequestCoverage,
  }));
  for (const session of normalizedSessions) {
    if ((session.usage === null) !== (session.source === "UNAVAILABLE")) {
      throw new Error("Every accounted session requires both usage and a source");
    }
  }

  const accountedSessionCount = normalizedSessions.filter((session) => session.usage !== null).length;
  const sessionsComplete = accountedSessionCount === normalizedSessions.length;
  const requestCount = normalizedSessions.reduce(
    (sum, session) => sum + session.proxyRequestCoverage.requestCount,
    0,
  );
  const accountedRequestCount = normalizedSessions.reduce(
    (sum, session) => sum + session.proxyRequestCoverage.accountedRequestCount,
    0,
  );
  const sources = new Set(normalizedSessions.map((session) => session.source));
  const aggregateSource = !sessionsComplete
    ? "UNAVAILABLE"
    : sources.size === 1 && sources.has("PROXY_REQUEST_SUM")
      ? "PROXY"
      : sources.size === 1 && sources.has("TRAJECTORY_TURN_COMPLETED")
        ? "TRAJECTORY"
        : "MIXED";
  const tokenUsage = sessionsComplete
    ? normalizedSessions.reduce(
        (sum, session) => ({
          input: sum.input + session.usage!.input,
          cachedInput: sum.cachedInput + session.usage!.cachedInput,
          output: sum.output + session.usage!.output,
        }),
        { input: 0, cachedInput: 0, output: 0 },
      )
    : null;

  return {
    tokenUsage,
    tokenUsageAccounting: {
      sessions: normalizedSessions,
      sessionCoverage: {
        sessionCount: normalizedSessions.length,
        accountedSessionCount,
        complete: sessionsComplete,
      },
      proxyRequestCoverage: {
        requestCount,
        accountedRequestCount,
        complete: requestCount > 0 && accountedRequestCount === requestCount,
      },
      aggregateSource,
    },
  };
}
