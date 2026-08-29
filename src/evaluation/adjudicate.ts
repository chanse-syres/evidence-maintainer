import { sha256Json } from "../core/canonical-json.ts";
import { aggregateRows } from "./aggregate.ts";
import { failureClasses, type EvaluationRow } from "./score-run.ts";
import type { EvaluationSummary } from "./run-evaluation.ts";

interface EvaluationLockForAdjudication {
  freezeTag: string;
  caseSetHash: string;
  caseDefinitionSetHash: string;
  cases: Array<{ caseId: string; workspaceHash: string }>;
  caseDefinitions: Array<{ caseId: string; sha256: string }>;
}

interface EvaluatorInvalidationReceipt {
  schemaVersion: number;
  campaign: string;
  caseId: string;
  status: string;
  recordedAt: string;
  publicComparisonEligible: boolean;
  reason: string;
  disposition: {
    excludedSymmetrically: boolean;
    excludedWorkflowRows: number;
  };
}

export interface AdjudicatedEvaluationSummary extends EvaluationSummary {
  adjudication: {
    status: "POST_RUN_EVALUATOR_INVALIDATION_APPLIED";
    recordedAt: string;
    sourceGeneratedAt: string;
    sourceWorkflowRunCount: number;
    includedWorkflowRunCount: number;
    invalidatedCaseIds: string[];
    invalidations: Array<{ caseId: string; reason: string }>;
    rawResourceSummary: {
      baseline: EvaluationSummary["arms"]["baseline"];
      advanced: EvaluationSummary["arms"]["advanced"];
      resourceComparison: EvaluationSummary["resourceComparison"];
    };
  };
}

function campaignFromFreezeTag(freezeTag: string): string {
  const prefix = "holdout-freeze-v4-";
  if (!freezeTag.startsWith(prefix)) {
    throw new Error("evaluation lock has no V4 campaign freeze tag");
  }
  return `holdout-v4-${freezeTag.slice(prefix.length)}`;
}

function sorted<T extends { caseId: string }>(entries: T[]): T[] {
  return [...entries].sort((left, right) => left.caseId.localeCompare(right.caseId));
}

function sameStrings(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

export function adjudicateEvaluationSummary(input: {
  rawSummary: EvaluationSummary;
  lock: EvaluationLockForAdjudication;
  invalidations: EvaluatorInvalidationReceipt[];
}): AdjudicatedEvaluationSummary {
  const { rawSummary, lock } = input;
  const campaign = campaignFromFreezeTag(lock.freezeTag);
  if (input.invalidations.length === 0) {
    throw new Error("post-run adjudication requires at least one evaluator invalidation");
  }

  const lockedCaseIds = sorted(lock.cases).map((entry) => entry.caseId);
  const definitionCaseIds = sorted(lock.caseDefinitions).map((entry) => entry.caseId);
  if (!sameStrings(lockedCaseIds, definitionCaseIds)) {
    throw new Error("evaluation lock case and definition IDs do not match");
  }
  if (
    rawSummary.selection.selectedCaseCount !== lockedCaseIds.length ||
    rawSummary.selection.excludedCaseCount !== 0 ||
    !sameStrings(rawSummary.selection.includedCaseIds, lockedCaseIds)
  ) {
    throw new Error("raw summary is not bound to the frozen selected case set");
  }
  if (
    rawSummary.selection.selectedCaseSetHash !== lock.caseSetHash ||
    rawSummary.selection.selectedCaseDefinitionSetHash !== lock.caseDefinitionSetHash
  ) {
    throw new Error("raw summary selected hashes do not match the evaluation lock");
  }

  const invalidatedIds = new Set<string>();
  for (const receipt of input.invalidations) {
    if (receipt.schemaVersion !== 1 || receipt.status !== "EVALUATOR_INVALID") {
      throw new Error("invalid evaluator-invalidation receipt");
    }
    if (receipt.campaign !== campaign) {
      throw new Error("invalidation campaign does not match the frozen campaign");
    }
    if (!lockedCaseIds.includes(receipt.caseId)) {
      throw new Error(`invalidation names an unfrozen case: ${receipt.caseId}`);
    }
    if (invalidatedIds.has(receipt.caseId)) {
      throw new Error(`duplicate evaluator invalidation: ${receipt.caseId}`);
    }
    if (
      receipt.publicComparisonEligible !== false ||
      receipt.disposition?.excludedSymmetrically !== true ||
      !receipt.reason?.trim()
    ) {
      throw new Error(`invalid evaluator disposition: ${receipt.caseId}`);
    }
    const expectedRows = rawSummary.trialsPerCase * 2;
    if (receipt.disposition.excludedWorkflowRows !== expectedRows) {
      throw new Error(`evaluator invalidation row count mismatch: ${receipt.caseId}`);
    }
    invalidatedIds.add(receipt.caseId);
  }

  const includedCaseIds = lockedCaseIds.filter((caseId) => !invalidatedIds.has(caseId));
  if (includedCaseIds.length === 0) {
    throw new Error("evaluator invalidations excluded every frozen case");
  }
  const expectedRawRows = lockedCaseIds.length * rawSummary.trialsPerCase * 2;
  if (rawSummary.rows.length !== expectedRawRows) {
    throw new Error("raw summary does not contain every frozen workflow slot");
  }
  for (const caseId of lockedCaseIds) {
    for (const arm of ["baseline", "advanced"] as const) {
      const count = rawSummary.rows.filter((row) => row.caseId === caseId && row.arm === arm).length;
      if (count !== rawSummary.trialsPerCase) {
        throw new Error(`raw workflow slot count mismatch: ${caseId}/${arm}`);
      }
    }
  }

  const rows = rawSummary.rows.filter((row) => !invalidatedIds.has(row.caseId));
  const aggregate = aggregateRows(rows);
  const failureTaxonomy = Object.fromEntries(failureClasses.map((failureClass) => [
    failureClass,
    rows.filter((row: EvaluationRow) => row.failureClass === failureClass).length,
  ])) as EvaluationSummary["failureTaxonomy"];
  failureTaxonomy.EVALUATOR_INVALID = invalidatedIds.size * rawSummary.trialsPerCase * 2;

  const includedCases = sorted(lock.cases).filter((entry) => !invalidatedIds.has(entry.caseId));
  const includedDefinitions = sorted(lock.caseDefinitions).filter((entry) => !invalidatedIds.has(entry.caseId));
  const receipts = [...input.invalidations].sort((left, right) => left.caseId.localeCompare(right.caseId));
  const recordedAt = receipts.map((receipt) => receipt.recordedAt).sort().at(-1);
  if (!recordedAt || Number.isNaN(Date.parse(recordedAt))) {
    throw new Error("evaluator invalidation has no valid recordedAt timestamp");
  }

  return {
    ...rawSummary,
    generatedAt: recordedAt,
    caseSetHash: sha256Json(includedCases),
    caseDefinitionSetHash: sha256Json(includedDefinitions),
    selection: {
      selectedCaseCount: lockedCaseIds.length,
      includedCaseCount: includedCaseIds.length,
      excludedCaseCount: invalidatedIds.size,
      selectedCaseSetHash: lock.caseSetHash,
      selectedCaseDefinitionSetHash: lock.caseDefinitionSetHash,
      includedCaseIds,
      excludedCaseIds: [...invalidatedIds].sort(),
    },
    failureTaxonomy,
    ...aggregate,
    rows,
    adjudication: {
      status: "POST_RUN_EVALUATOR_INVALIDATION_APPLIED",
      recordedAt,
      sourceGeneratedAt: rawSummary.generatedAt,
      sourceWorkflowRunCount: rawSummary.rows.length,
      includedWorkflowRunCount: rows.length,
      invalidatedCaseIds: [...invalidatedIds].sort(),
      invalidations: receipts.map((receipt) => ({
        caseId: receipt.caseId,
        reason: receipt.reason,
      })),
      rawResourceSummary: {
        baseline: rawSummary.arms.baseline,
        advanced: rawSummary.arms.advanced,
        resourceComparison: rawSummary.resourceComparison,
      },
    },
  };
}
