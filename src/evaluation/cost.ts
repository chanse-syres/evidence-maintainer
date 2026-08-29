import type { EvaluationRow } from "./score-run.ts";

export interface UsagePricing {
  inputPerMillionUsd: number;
  cachedInputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

export interface RawTokenUsage {
  input: number;
  cachedInput: number;
  output: number;
}

export interface CostEstimate {
  tokenUsage: RawTokenUsage & {
    uncachedInput: number;
    total: number;
  };
  estimatedCostUsd: number;
}

function nonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be nonnegative`);
}

export function estimateUsageCost(usage: RawTokenUsage, pricing: UsagePricing): CostEstimate {
  nonnegative(usage.input, "input");
  nonnegative(usage.cachedInput, "cachedInput");
  nonnegative(usage.output, "output");
  if (usage.cachedInput > usage.input) throw new Error("cachedInput cannot exceed input");
  nonnegative(pricing.inputPerMillionUsd, "inputPerMillionUsd");
  nonnegative(pricing.cachedInputPerMillionUsd, "cachedInputPerMillionUsd");
  nonnegative(pricing.outputPerMillionUsd, "outputPerMillionUsd");
  const uncachedInput = usage.input - usage.cachedInput;
  return {
    tokenUsage: {
      ...usage,
      uncachedInput,
      total: usage.input + usage.output,
    },
    estimatedCostUsd: (
      uncachedInput * pricing.inputPerMillionUsd +
      usage.cachedInput * pricing.cachedInputPerMillionUsd +
      usage.output * pricing.outputPerMillionUsd
    ) / 1_000_000,
  };
}

export function summarizeCompletedRowUsage(rows: readonly EvaluationRow[]): RawTokenUsage & {
  workflowRunsWithUsage: number;
} {
  const complete = rows.filter((row) =>
    row.inputTokens !== null && row.cachedInputTokens !== null && row.outputTokens !== null
  );
  return {
    input: complete.reduce((sum, row) => sum + row.inputTokens!, 0),
    cachedInput: complete.reduce((sum, row) => sum + row.cachedInputTokens!, 0),
    output: complete.reduce((sum, row) => sum + row.outputTokens!, 0),
    workflowRunsWithUsage: complete.length,
  };
}
