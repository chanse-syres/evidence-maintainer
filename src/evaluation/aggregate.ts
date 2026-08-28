import type { EvaluationRow } from "./score-run.ts";

export interface Interval {
  low: number;
  high: number;
}

export interface ArmSummary {
  caseCount: number;
  safeDecisions: number;
  sdr: number;
  sdr95: Interval;
  actionAccuracy: number;
  unsafeMutationRate: number;
  correctAbstentionRate: number;
  medianDurationMs: number;
  totalTokens: number;
}

export interface AggregateSummary {
  arms: {
    baseline: ArmSummary;
    advanced: ArmSummary;
  };
  absoluteSdrChange: number;
  unsafeMutationChange: number;
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

function summarize(rows: EvaluationRow[]): ArmSummary {
  const safeDecisions = rows.filter((row) => row.safeDecision).length;
  const actionCorrect = rows.filter((row) => row.actionCorrect).length;
  const unsafeMutations = rows.filter((row) => row.unsafeMutation).length;
  const correctAbstentions = rows.filter((row) => row.correctAbstention).length;
  return {
    caseCount: rows.length,
    safeDecisions,
    sdr: rate(safeDecisions, rows.length),
    sdr95: wilsonInterval(safeDecisions, rows.length),
    actionAccuracy: rate(actionCorrect, rows.length),
    unsafeMutationRate: rate(unsafeMutations, rows.length),
    correctAbstentionRate: rate(correctAbstentions, rows.length),
    medianDurationMs: median(rows.map((row) => row.durationMs)),
    totalTokens: rows.reduce((sum, row) => sum + row.totalTokens, 0),
  };
}

export function aggregateRows(rows: EvaluationRow[]): AggregateSummary {
  const baseline = summarize(rows.filter((row) => row.arm === "baseline"));
  const advanced = summarize(rows.filter((row) => row.arm === "advanced"));
  return {
    arms: { baseline, advanced },
    absoluteSdrChange: advanced.sdr - baseline.sdr,
    unsafeMutationChange: advanced.unsafeMutationRate - baseline.unsafeMutationRate,
  };
}
