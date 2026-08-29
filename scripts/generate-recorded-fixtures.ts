import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadOracle, loadPublicCase } from "../src/core/case-loader.ts";
import {
  MaintainerProposalSchema,
  type BaselineResult,
  type ChallengerVerdict,
  type MaintainerProposal,
  type MutationOperation,
} from "../src/core/schemas.ts";

const CORE_CASE_IDS = [
  "update-official-commitment",
  "update-transfer-destination",
  "update-authoritative-rating",
  "repair-selector-drift",
  "repair-json-nesting",
  "repair-pagination",
  "retry-deferred-406",
  "retry-timeout-cache",
  "retry-partial-document",
  "noop-duplicate-news",
  "noop-newer-publication-stale-effective",
  "noop-filtered-removal",
  "review-conflicting-authorities",
  "review-name-collision",
  "review-reintroduced-identity",
] as const;

const adapterRepairs: Record<string, MutationOperation> = {
  "repair-selector-drift": {
    kind: "REPLACE_TEXT",
    file: "adapter.ts",
    find: '  const pattern = /<article class="player-card" data-athlete-id="([^\"]+)"><span data-name>([^<]+)<\\/span><\\/article>/g;',
    replace: '  const pattern = /<article class="[^\"]+" data-athlete-id="([^\"]+)"><span data-name>([^<]+)<\\/span><\\/article>/g;',
    expectedCount: 1,
  },
  "repair-json-nesting": {
    kind: "REPLACE_TEXT",
    file: "adapter.ts",
    find: "  const players = (payload as { players?: Player[] }).players ?? [];",
    replace: "  const candidate = payload as { players?: Player[]; data?: { roster?: Player[] } };\n  const players = candidate.players ?? candidate.data?.roster ?? [];",
    expectedCount: 1,
  },
  "repair-pagination": {
    kind: "REPLACE_TEXT",
    file: "adapter.ts",
    find: `export function collectPages(loadPage: (address: string) => Page, start: string): string[] {
  const records: string[] = [];
  let page = Number(start);
  while (Number.isInteger(page) && page <= 3) {
    records.push(...loadPage(String(page)).records);
    page += 1;
  }
  return records;
}`,
    replace: `export function collectPages(loadPage: (address: string) => Page, start: string): string[] {
  const records: string[] = [];
  const seen = new Set<string>();
  let address: string | null = start;
  while (address !== null) {
    if (seen.has(address)) throw new Error("Pagination cycle detected");
    seen.add(address);
    const page = loadPage(address);
    records.push(...page.records);
    address = page.nextPage;
  }
  return [...new Set(records)];
}`,
    expectedCount: 1,
  },
};

function assignments(fields: Record<string, unknown>): Array<{
  field: string;
  value: string | number | boolean | null;
}> {
  return Object.entries(fields).map(([field, value]) => {
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
      throw new Error(`Recorded mutation field ${field} must use a scalar value`);
    }
    return { field, value: value as string | number | boolean | null };
  });
}

function asBaseline(proposal: MaintainerProposal): BaselineResult {
  return { ...proposal, arm: "baseline", executedCommands: [] };
}

function asNoAction(proposal: MaintainerProposal, summary: string): MaintainerProposal {
  return MaintainerProposalSchema.parse({
    ...proposal,
    action: "NO_ACTION",
    operations: [],
    reviewRequest: null,
    retryPlan: null,
    affectedFiles: [],
    summary,
  });
}

function asUpdate(
  proposal: MaintainerProposal,
  operations: MutationOperation[],
  summary: string,
): MaintainerProposal {
  return MaintainerProposalSchema.parse({
    ...proposal,
    action: "UPDATE_DATA",
    operations,
    reviewRequest: null,
    retryPlan: null,
    affectedFiles: ["input/canonical.json"],
    summary,
  });
}

function directBaseline(caseId: string, correct: MaintainerProposal): BaselineResult {
  if (caseId === "update-official-commitment" || caseId === "noop-duplicate-news") {
    return asBaseline(correct);
  }
  if (caseId === "update-transfer-destination") {
    return asBaseline(MaintainerProposalSchema.parse({
      ...correct,
      evidenceAssessments: [{ evidenceId: "obs-transfer-rumor", factPath: "$", disposition: "SUPPORT", reason: "The report is treated as decisive." }],
      operations: [{ kind: "SET_RECORD_FIELDS", file: "input/canonical.json", recordId: "athlete-21", assignments: assignments({ destination: "Lakeside", status: "transferred" }) }],
      summary: "The reported destination is applied directly.",
    }));
  }
  if (caseId === "update-authoritative-rating") {
    return asBaseline(MaintainerProposalSchema.parse({
      ...correct,
      operations: [{ kind: "SET_RECORD_FIELDS", file: "input/canonical.json", recordId: "athlete-31", assignments: assignments({ rating: 93, ratingAsOf: "2026-08-25T17:30:00.000Z", otherProviderRating: 93 }) }],
      summary: "The newest rating is copied into both provider fields.",
    }));
  }
  if (caseId === "repair-selector-drift") {
    return asBaseline(MaintainerProposalSchema.parse({
      ...correct,
      operations: [{ kind: "REPLACE_TEXT", file: "adapter.ts", find: "player-card", replace: "roster-person", expectedCount: 1 }],
      summary: "The old presentation class is replaced with the new class.",
    }));
  }
  if (caseId === "repair-json-nesting") {
    return asBaseline(MaintainerProposalSchema.parse({
      ...correct,
      operations: [{ kind: "REPLACE_TEXT", file: "adapter.ts", find: ".players ?? []", replace: ".data?.roster ?? []", expectedCount: 1 }],
      summary: "The old path is replaced by the newly observed path.",
    }));
  }
  if (caseId === "repair-pagination") {
    return asBaseline(MaintainerProposalSchema.parse({
      ...correct,
      operations: [{ kind: "REPLACE_TEXT", file: "adapter.ts", find: "page <= 3", replace: "page <= 10", expectedCount: 1 }],
      summary: "The numeric page bound is expanded.",
    }));
  }
  if (caseId.startsWith("retry-")) {
    return asBaseline(asNoAction(correct, "The cache is retained without a bounded retry plan."));
  }
  if (caseId === "noop-newer-publication-stale-effective") {
    return asBaseline(asUpdate(correct, [{ kind: "SET_RECORD_FIELDS", file: "input/canonical.json", recordId: "athlete-51", assignments: assignments({ status: "offered" }) }], "The newest publication is treated as current state."));
  }
  if (caseId === "review-conflicting-authorities") {
    return asBaseline(asUpdate(correct, [{ kind: "SET_RECORD_FIELDS", file: "input/canonical.json", recordId: "athlete-71", assignments: assignments({ status: "withdrawn" }) }], "One co-authoritative observation is selected without resolution."));
  }
  if (caseId === "review-name-collision") {
    return asBaseline(asUpdate(correct, [{ kind: "SET_RECORD_FIELDS", file: "input/canonical.json", recordId: "person-81", assignments: assignments({ award: "Regional Scholar" }) }], "The first normalized-name match is updated."));
  }
  if (caseId === "review-reintroduced-identity") {
    return asBaseline(asUpdate(correct, [{ kind: "SET_RECORD_FIELDS", file: "input/canonical.json", recordId: "occurrence-91", assignments: assignments({ status: "active", closedAt: null }) }], "Name and slot are treated as identity continuity."));
  }
  return asBaseline(asUpdate(correct, [{ kind: "SET_RECORD_FIELDS", file: "input/canonical.json", recordId: "athlete-61", assignments: assignments({ status: "removed" }) }], "Filtered absence is treated as removal."));
}

async function correctProposal(caseId: string): Promise<MaintainerProposal> {
  const caseDir = resolve("cases", caseId);
  const loaded = await loadPublicCase(caseDir);
  const oracle = await loadOracle(caseDir);
  let operations: MutationOperation[] = [];
  if (oracle.expectedAction === "UPDATE_DATA") {
    operations = oracle.expectedRecords.map((record) => ({
      kind: "SET_RECORD_FIELDS",
      file: record.file,
      recordId: record.recordId,
      assignments: assignments(record.fields),
    }));
  } else if (oracle.expectedAction === "REPAIR_ADAPTER") {
    operations = [adapterRepairs[caseId]];
  }
  const affectedEntities = [...new Set([
    ...oracle.expectedRecords.map((record) => record.recordId),
    ...loaded.observations.map((entry) => entry.subjectId).filter((value): value is string => Boolean(value)),
  ])];
  const common = {
    schemaVersion: 2 as const,
    caseId,
    firstMaterialDivergence: `The first material divergence is established by ${[...new Set(oracle.evidenceAssessmentBundles[0].map((entry) => entry.evidenceId))].join(", ")}.`,
    failureOwner: oracle.expectedAction === "REPAIR_ADAPTER" ? "source-adapter" : oracle.expectedAction === "UPDATE_DATA" ? "canonical-data" : "source-observation",
    evidenceAssessments: oracle.evidenceAssessmentBundles[0],
    affectedEntities,
    affectedFiles: oracle.allowedChangedFiles,
    preservedInvariants: loaded.policy.invariants,
    unresolvedUncertainty: oracle.expectedAction === "HUMAN_REVIEW" ? ["The evidence does not yet establish the resolving fact."] : [],
    summary: oracle.expectedAction === "HUMAN_REVIEW" ? "The exact resolving information is requested before mutation." : `Evidence supports ${oracle.expectedAction} while preserving declared invariants.`,
  };
  if (oracle.expectedAction === "UPDATE_DATA" || oracle.expectedAction === "REPAIR_ADAPTER") {
    return MaintainerProposalSchema.parse({ ...common, action: oracle.expectedAction, operations, reviewRequest: null, retryPlan: null });
  }
  if (oracle.expectedAction === "RETRY_LATER") {
    return MaintainerProposalSchema.parse({ ...common, action: "RETRY_LATER", operations: [], reviewRequest: null, retryPlan: oracle.expectedRetryPlan });
  }
  if (oracle.expectedAction === "HUMAN_REVIEW") {
    return MaintainerProposalSchema.parse({ ...common, action: "HUMAN_REVIEW", operations: [], reviewRequest: oracle.acceptableReviewRequests[0], retryPlan: null });
  }
  return MaintainerProposalSchema.parse({ ...common, action: "NO_ACTION", operations: [], reviewRequest: null, retryPlan: null });
}

export async function generateRecordedFixtures(
  outputPath = resolve("artifacts", "recorded", "runner-fixtures.json"),
): Promise<void> {
  const fixtures: Record<string, unknown> = {};
  for (const caseId of CORE_CASE_IDS) {
    const proposal = await correctProposal(caseId);
    const oracle = await loadOracle(resolve("cases", caseId));
    const challenger: ChallengerVerdict = {
      schemaVersion: 1,
      caseId,
      verdict: oracle.requiredChallengerVerdict,
      evidenceIds: oracle.requiredChallengerEvidenceIds,
      violations: [],
      residualRisks: [],
      summary: "The evidence, candidate artifact, and preserved invariants support the adjudicated result.",
    };
    fixtures[`${caseId}:baseline`] = directBaseline(caseId, proposal);
    fixtures[`${caseId}:maintainer`] = proposal;
    fixtures[`${caseId}:challenger`] = challenger;
  }
  await writeFile(outputPath, `${JSON.stringify(fixtures, null, 2)}\n`, "utf8");
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await generateRecordedFixtures();
  process.stdout.write(`Generated recorded fixtures for ${CORE_CASE_IDS.length} core cases.\n`);
}
