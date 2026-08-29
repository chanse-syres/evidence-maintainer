import {
  failureClasses,
  type EvaluationRow,
  type FailureClass,
} from "./score-run.ts";
import {
  mean,
  quantileType7,
  sampleStandardDeviation,
  sampleVariance,
  stratifiedNestedBootstrap,
  type BootstrapComparison,
} from "./statistics.ts";

export interface Interval {
  low: number;
  high: number;
}

export interface ResourceSummary {
  count: number;
  total: number;
  mean: number;
  sampleVariance: number;
  sampleStandardDeviation: number;
  median: number;
  p95: number;
}

export interface ArmSummary {
  caseCount: number;
  uniqueCaseCount: number;
  workflowRunCount: number;
  operationalDecisions: number;
  odi: number;
  odi95: Interval;
  actionCorrectCount: number;
  actionCorrectRate: number;
  artifactCorrectCount: number;
  artifactCorrectRate: number;
  noForbiddenMutationCount: number;
  noForbiddenMutationRate: number;
  requiredCommandsPassedCount: number;
  requiredCommandsPassedRate: number;
  sourceCoverageCount: number;
  sourceCoverageRate: number;
  contradictionFreeCount: number;
  contradictionFreeRate: number;
  annotationAlignedCount: number;
  annotationAlignedRate: number;
  failureClasses: Record<FailureClass, number>;
  medianDurationMs: number;
  totalTokens: number;
  durationMs: ResourceSummary;
  tokens: ResourceSummary;
}

export interface AggregateSummary {
  arms: {
    baseline: ArmSummary;
    advanced: ArmSummary;
  };
  absoluteOdiChange: number;
  odiBootstrap95: BootstrapComparison | null;
  resourceComparison: {
    advancedMinusBaselineTotalDurationMs: number;
    advancedMinusBaselineMeanDurationMs: number;
    advancedMinusBaselineMedianDurationMs: number;
    advancedMinusBaselineTotalTokens: number;
    advancedMinusBaselineMeanTokens: number;
  };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function wilsonInterval(successes: number, total: number, z = 1.96): Interval {
  if (total <= 0) return { low: 0, high: 0 };
  const proportion = successes / total;
  const zSquared = z * z;
  const denominator = 1 + zSquared / total;
  const center = (proportion + zSquared / (2 * total)) / denominator;
  const margin = (
    z * Math.sqrt((proportion * (1 - proportion) + zSquared / (4 * total)) / total)
  ) / denominator;
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function describe(values: number[]): ResourceSummary {
  return {
    count: values.length,
    total: values.reduce((sum, value) => sum + value, 0),
    mean: mean(values),
    sampleVariance: sampleVariance(values),
    sampleStandardDeviation: sampleStandardDeviation(values),
    median: median(values),
    p95: quantileType7(values, 0.95),
  };
}

function count(rows: EvaluationRow[], predicate: (row: EvaluationRow) => boolean): number {
  return rows.filter(predicate).length;
}

function summarize(rows: EvaluationRow[]): ArmSummary {
  const uniqueCaseCount = new Set(rows.map((row) => row.caseId)).size;
  const operationalDecisions = count(rows, (row) => row.operationalDecisionIntegrity);
  const actionCorrectCount = count(rows, (row) => row.actionCorrect);
  const artifactCorrectCount = count(rows, (row) => row.artifactCorrect);
  const noForbiddenMutationCount = count(rows, (row) => row.noForbiddenMutation);
  const requiredCommandsPassedCount = count(rows, (row) => row.requiredCommandsPassed);
  const sourceCoverageCount = count(rows, (row) => row.sourceCoverage);
  const contradictionFreeCount = count(rows, (row) => row.contradictionFree);
  const annotationAlignedCount = count(rows, (row) => row.annotationAligned);
  const failureClassCounts = Object.fromEntries(
    failureClasses.map((failureClass) => [
      failureClass,
      count(rows, (row) => row.failureClass === failureClass),
    ]),
  ) as Record<FailureClass, number>;
  const durations = rows.map((row) => row.durationMs).filter((value): value is number => value !== null);
  const tokens = rows.map((row) => row.totalTokens).filter((value): value is number => value !== null);
  const durationSummary = describe(durations);
  const tokenSummary = describe(tokens);
  return {
    caseCount: uniqueCaseCount,
    uniqueCaseCount,
    workflowRunCount: rows.length,
    operationalDecisions,
    odi: rate(operationalDecisions, rows.length),
    odi95: wilsonInterval(operationalDecisions, rows.length),
    actionCorrectCount,
    actionCorrectRate: rate(actionCorrectCount, rows.length),
    artifactCorrectCount,
    artifactCorrectRate: rate(artifactCorrectCount, rows.length),
    noForbiddenMutationCount,
    noForbiddenMutationRate: rate(noForbiddenMutationCount, rows.length),
    requiredCommandsPassedCount,
    requiredCommandsPassedRate: rate(requiredCommandsPassedCount, rows.length),
    sourceCoverageCount,
    sourceCoverageRate: rate(sourceCoverageCount, rows.length),
    contradictionFreeCount,
    contradictionFreeRate: rate(contradictionFreeCount, rows.length),
    annotationAlignedCount,
    annotationAlignedRate: rate(annotationAlignedCount, rows.length),
    failureClasses: failureClassCounts,
    medianDurationMs: durationSummary.median,
    totalTokens: tokenSummary.total,
    durationMs: durationSummary,
    tokens: tokenSummary,
  };
}

function supportsPairedBootstrap(rows: EvaluationRow[]): boolean {
  if (rows.length === 0 || rows.some((row) => row.expectedAction == null)) return false;
  const pairs = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = `${row.expectedAction}\u0000${row.caseId}`;
    const arms = pairs.get(key) ?? new Set<string>();
    arms.add(row.arm);
    pairs.set(key, arms);
  }
  return [...pairs.values()].every((arms) => arms.has("baseline") && arms.has("advanced"));
}

export function aggregateRows(rows: EvaluationRow[]): AggregateSummary {
  const baseline = summarize(rows.filter((row) => row.arm === "baseline"));
  const advanced = summarize(rows.filter((row) => row.arm === "advanced"));
  return {
    arms: { baseline, advanced },
    absoluteOdiChange: advanced.odi - baseline.odi,
    odiBootstrap95: supportsPairedBootstrap(rows)
      ? stratifiedNestedBootstrap(rows, (row) => row.operationalDecisionIntegrity ? 1 : 0)
      : null,
    resourceComparison: {
      advancedMinusBaselineTotalDurationMs: advanced.durationMs.total - baseline.durationMs.total,
      advancedMinusBaselineMeanDurationMs: advanced.durationMs.mean - baseline.durationMs.mean,
      advancedMinusBaselineMedianDurationMs: advanced.durationMs.median - baseline.durationMs.median,
      advancedMinusBaselineTotalTokens: advanced.tokens.total - baseline.tokens.total,
      advancedMinusBaselineMeanTokens: advanced.tokens.mean - baseline.tokens.mean,
    },
  };
}
