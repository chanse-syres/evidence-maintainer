export interface Interval {
  low: number;
  high: number;
}

export interface BootstrapComparison {
  baseline: Interval;
  advanced: Interval;
  difference: Interval;
  iterations: number;
  seed: number;
  method: "stratified-nested-case-trial-bootstrap";
}

export interface BootstrapRow {
  caseId: string;
  arm: "baseline" | "advanced";
  expectedAction: string | null;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function sampleVariance(values: readonly number[]): number {
  if (values.length <= 1) return 0;
  const average = mean(values);
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
}

export function sampleStandardDeviation(values: readonly number[]): number {
  return Math.sqrt(sampleVariance(values));
}

export function quantileType7(values: readonly number[], probability: number): number {
  if (values.length === 0) return 0;
  if (probability < 0 || probability > 1) throw new Error("Probability must be between 0 and 1");
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleWithReplacement<T>(values: readonly T[], count: number, random: () => number): T[] {
  if (values.length === 0) return [];
  return Array.from({ length: count }, () => values[Math.floor(random() * values.length)]);
}

export function caseBalancedMean<T extends BootstrapRow>(
  rows: readonly T[],
  accessor: (row: T) => number | null,
  arm: "baseline" | "advanced",
): number {
  const valuesByCase = new Map<string, number[]>();
  for (const row of rows) {
    if (row.arm !== arm) continue;
    const value = accessor(row);
    if (value === null) continue;
    const values = valuesByCase.get(row.caseId) ?? [];
    values.push(value);
    valuesByCase.set(row.caseId, values);
  }
  return mean([...valuesByCase.values()].map((values) => mean(values)));
}

export function stratifiedNestedBootstrap<T extends BootstrapRow>(
  rows: readonly T[],
  accessor: (row: T) => number | null,
  options: { iterations?: number; seed?: number } = {},
): BootstrapComparison {
  const iterations = options.iterations ?? 20_000;
  const seed = options.seed ?? 20260829;
  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new Error("Bootstrap iterations must be a positive integer");
  }
  const strata = new Map<string, Map<string, { baseline: T[]; advanced: T[] }>>();
  for (const row of rows) {
    if (!row.expectedAction) throw new Error("Bootstrap rows require expectedAction");
    const cases = strata.get(row.expectedAction) ?? new Map();
    const pair = cases.get(row.caseId) ?? { baseline: [], advanced: [] };
    pair[row.arm].push(row);
    cases.set(row.caseId, pair);
    strata.set(row.expectedAction, cases);
  }
  if (strata.size === 0) throw new Error("Bootstrap requires rows");
  for (const cases of strata.values()) {
    for (const pair of cases.values()) {
      if (pair.baseline.length === 0 || pair.advanced.length === 0) {
        throw new Error("Every bootstrap case requires both arms");
      }
    }
  }

  const random = mulberry32(seed);
  const baselineSamples: number[] = [];
  const advancedSamples: number[] = [];
  const differences: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const baselineValues: number[] = [];
    const advancedValues: number[] = [];
    for (const cases of strata.values()) {
      const caseIds = [...cases.keys()].sort();
      for (const caseId of sampleWithReplacement(caseIds, caseIds.length, random)) {
        const pair = cases.get(caseId)!;
        for (const arm of ["baseline", "advanced"] as const) {
          const sourceRows = pair[arm];
          const sampledRows = sampleWithReplacement(sourceRows, sourceRows.length, random);
          const sampledValues = sampledRows.map(accessor).filter((value): value is number => value !== null);
          const destination = arm === "baseline" ? baselineValues : advancedValues;
          if (sampledValues.length > 0) destination.push(mean(sampledValues));
        }
      }
    }
    const baseline = mean(baselineValues);
    const advanced = mean(advancedValues);
    baselineSamples.push(baseline);
    advancedSamples.push(advanced);
    differences.push(advanced - baseline);
  }
  const interval = (values: number[]): Interval => ({
    low: quantileType7(values, 0.025),
    high: quantileType7(values, 0.975),
  });
  return {
    baseline: interval(baselineSamples),
    advanced: interval(advancedSamples),
    difference: interval(differences),
    iterations,
    seed,
    method: "stratified-nested-case-trial-bootstrap",
  };
}
