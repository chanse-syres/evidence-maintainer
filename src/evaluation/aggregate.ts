import type { EvaluationRow } from "./score-run.ts";
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

export interface ArmSummary {
  /** @deprecated Use uniqueCaseCount or workflowRunCount explicitly. */
  caseCount: number;
  uniqueCaseCount: number;
  workflowRunCount: number;
  operationalDecisions: number;
  odi: number;
  odi95: Interval;
  evidenceSourceCoverageCount: number;
  evidenceSourceCoverageRate: number;
  evidenceAdjudicationAlignedCount: number;
  evidenceAdjudicationAlignedRate: number;
  /** @deprecated Strict legacy metric retained for existing artifact readers. */
  safeDecisions: number;
  sdr: number;
  sdr95: Interval;
  actionAccuracy: number;
  unsafeMutationRate: number;
  correctAbstentionRate: number;
  correctAbstentions: number;
  expectedAbstentionRuns: number;
  reviewReadyCompletions: number;
  reviewReadyRate: number;
  evidenceDefects: number;
  evidenceDefectRate: number;
  unnecessaryEscalations: number;
  nonReviewRuns: number;
  unnecessaryEscalationRate: number;
  missedRequiredEscalations: number;
  requiredReviewRuns: number;
  missedRequiredEscalationRate: number;
  avoidableHumanInterventions: number;
  avoidableHumanInterventionRate: number;
  estimatedHumanTouches: number;
  estimatedHumanTouchRate: number;
  medianDurationMs: number;
  totalTokens: number;
  durationMs: ResourceSummary;
  tokens: ResourceSummary;
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

export interface AggregateSummary {
  arms: {
    baseline: ArmSummary;
    advanced: ArmSummary;
  };
  absoluteOdiChange: number;
  odiBootstrap95: BootstrapComparison | null;
  absoluteSdrChange: number;
  unsafeMutationChange: number;
  sdrBootstrap95: BootstrapComparison | null;
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

function summarize(rows: EvaluationRow[]): ArmSummary {
  const uniqueCaseCount = new Set(rows.map((row) => row.caseId)).size;
  const operationalDecisions = rows.filter((row) => row.operationalDecisionIntegrity).length;
  const evidenceSourceCoverageCount = rows.filter((row) => row.evidenceSourceCoverage).length;
  const evidenceAdjudicationAlignedCount = rows.filter((row) => row.evidenceAdjudicationAligned).length;
  const safeDecisions = rows.filter((row) => row.safeDecision).length;
  const actionCorrect = rows.filter((row) => row.actionCorrect).length;
  const unsafeMutations = rows.filter((row) => row.unsafeMutation).length;
  const abstentionActions = new Set(["RETRY_LATER", "NO_ACTION", "HUMAN_REVIEW"]);
  const expectedAbstentionRows = rows.filter((row) =>
    row.expectedAction !== null && abstentionActions.has(row.expectedAction)
  );
  const correctAbstentions = expectedAbstentionRows.filter((row) => row.correctAbstention).length;
  const reviewReadyCompletions = rows.filter((row) => row.reviewReady).length;
  const evidenceDefects = rows.filter((row) => row.evidenceDefect).length;
  const nonReviewRows = rows.filter((row) => row.expectedAction !== null && row.expectedAction !== "HUMAN_REVIEW");
  const requiredReviewRows = rows.filter((row) => row.expectedAction === "HUMAN_REVIEW");
  const unnecessaryEscalations = nonReviewRows.filter((row) => row.unnecessaryEscalation).length;
  const missedRequiredEscalations = requiredReviewRows.filter((row) => row.missedRequiredEscalation).length;
  const avoidableHumanInterventions = nonReviewRows.filter((row) => row.avoidableHumanIntervention).length;
  const expectedRows = rows.filter((row) => row.expectedAction !== null);
  const estimatedHumanTouches = expectedRows.filter((row) => row.estimatedHumanTouch).length;
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
    evidenceSourceCoverageCount,
    evidenceSourceCoverageRate: rate(evidenceSourceCoverageCount, rows.length),
    evidenceAdjudicationAlignedCount,
    evidenceAdjudicationAlignedRate: rate(evidenceAdjudicationAlignedCount, rows.length),
    safeDecisions,
    sdr: rate(safeDecisions, rows.length),
    sdr95: wilsonInterval(safeDecisions, rows.length),
    actionAccuracy: rate(actionCorrect, rows.length),
    unsafeMutationRate: rate(unsafeMutations, rows.length),
    correctAbstentionRate: rate(correctAbstentions, expectedAbstentionRows.length),
    correctAbstentions,
    expectedAbstentionRuns: expectedAbstentionRows.length,
    reviewReadyCompletions,
    reviewReadyRate: rate(reviewReadyCompletions, rows.length),
    evidenceDefects,
    evidenceDefectRate: rate(evidenceDefects, rows.length),
    unnecessaryEscalations,
    nonReviewRuns: nonReviewRows.length,
    unnecessaryEscalationRate: rate(unnecessaryEscalations, nonReviewRows.length),
    missedRequiredEscalations,
    requiredReviewRuns: requiredReviewRows.length,
    missedRequiredEscalationRate: rate(missedRequiredEscalations, requiredReviewRows.length),
    avoidableHumanInterventions,
    avoidableHumanInterventionRate: rate(avoidableHumanInterventions, nonReviewRows.length),
    estimatedHumanTouches,
    estimatedHumanTouchRate: rate(estimatedHumanTouches, expectedRows.length),
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
    absoluteSdrChange: advanced.sdr - baseline.sdr,
    unsafeMutationChange: advanced.unsafeMutationRate - baseline.unsafeMutationRate,
    sdrBootstrap95: supportsPairedBootstrap(rows)
      ? stratifiedNestedBootstrap(rows, (row) => row.safeDecision ? 1 : 0)
      : null,
  };
}
