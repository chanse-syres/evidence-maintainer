import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadOracle, loadPublicCase } from "../src/core/case-loader.ts";
import type {
  BaselineResult,
  ChallengerVerdict,
  MaintainerProposal,
  MutationOperation,
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
    find: `export function collectPages(loadPage: (address: string) => Page, start: string): string[] {\n  const records: string[] = [];\n  let page = Number(start);\n  while (Number.isInteger(page) && page <= 3) {\n    records.push(...loadPage(String(page)).records);\n    page += 1;\n  }\n  return records;\n}`,
    replace: `export function collectPages(loadPage: (address: string) => Page, start: string): string[] {\n  const records: string[] = [];\n  const seen = new Set<string>();\n  let address: string | null = start;\n  while (address !== null) {\n    if (seen.has(address)) throw new Error(\"Pagination cycle detected\");\n    seen.add(address);\n    const page = loadPage(address);\n    records.push(...page.records);\n    address = page.nextPage;\n  }\n  return [...new Set(records)];\n}`,
    expectedCount: 1,
  },
};

function directBaseline(caseId: string, correct: MaintainerProposal): BaselineResult {
  const baseline: BaselineResult = { ...correct, arm: "baseline", executedCommands: [] };
  if (caseId === "update-official-commitment" || caseId === "noop-duplicate-news") {
    return baseline;
  }
  if (caseId === "update-transfer-destination") {
    return {
      ...baseline,
      evidenceUsed: ["obs-transfer-rumor"],
      operations: [{ kind: "SET_RECORD_FIELDS", file: "input/canonical.json", recordId: "athlete-21", fields: { destination: "Lakeside", status: "transferred" } }],
      summary: "The latest reported destination is applied directly.",
    };
  }
  if (caseId === "update-authoritative-rating") {
    return {
      ...baseline,
      operations: [{ kind: "SET_RECORD_FIELDS", file: "input/canonical.json", recordId: "athlete-31", fields: { rating: 93, ratingAsOf: "2026-08-25T17:30:00.000Z", otherProviderRating: 93 } }],
      summary: "The newest rating is copied into both visible rating fields.",
    };
  }
  if (caseId === "repair-selector-drift") {
    return {
      ...baseline,
      operations: [{ kind: "REPLACE_TEXT", file: "adapter.ts", find: "player-card", replace: "roster-person", expectedCount: 1 }],
      summary: "The old presentation class is replaced with the new class.",
    };
  }
  if (caseId === "repair-json-nesting") {
    return {
      ...baseline,
      operations: [{ kind: "REPLACE_TEXT", file: "adapter.ts", find: ".players ?? []", replace: ".data?.roster ?? []", expectedCount: 1 }],
      summary: "The old path is replaced by the newly observed path.",
    };
  }
  if (caseId === "repair-pagination") {
    return {
      ...baseline,
      operations: [{ kind: "REPLACE_TEXT", file: "adapter.ts", find: "page <= 3", replace: "page <= 10", expectedCount: 1 }],
      summary: "The numeric page bound is expanded.",
    };
  }
  if (caseId.startsWith("retry-")) {
    return {
      ...baseline,
      action: "NO_ACTION",
      retryCondition: null,
      summary: "The cached result is retained without a specific retry plan.",
    };
  }
  if (caseId === "noop-newer-publication-stale-effective") {
    return {
      ...baseline,
      action: "UPDATE_DATA",
      affectedFiles: ["input/canonical.json"],
      operations: [{ kind: "SET_RECORD_FIELDS", file: "input/canonical.json", recordId: "athlete-51", fields: { status: "offered" } }],
      summary: "The newest publication is treated as current state.",
    };
  }
  if (caseId === "review-conflicting-authorities") {
    return {
      ...baseline,
      action: "UPDATE_DATA",
      affectedFiles: ["input/canonical.json"],
      operations: [{
        kind: "SET_RECORD_FIELDS",
        file: "input/canonical.json",
        recordId: "athlete-71",
        fields: { status: "withdrawn" },
      }],
      minimumInformationRequest: [],
      approvalLevel: "SIMULATED_HUMAN",
      summary: "One official observation is selected despite an unresolved co-authoritative conflict.",
    };
  }
  if (caseId === "review-name-collision") {
    return {
      ...baseline,
      action: "UPDATE_DATA",
      affectedFiles: ["input/canonical.json"],
      operations: [{
        kind: "SET_RECORD_FIELDS",
        file: "input/canonical.json",
        recordId: "person-81",
        fields: { award: "Regional Scholar" },
      }],
      minimumInformationRequest: [],
      approvalLevel: "SIMULATED_HUMAN",
      summary: "The first normalized-name match is updated without a stable identity key.",
    };
  }
  if (caseId === "review-reintroduced-identity") {
    return {
      ...baseline,
      action: "UPDATE_DATA",
      affectedFiles: ["input/canonical.json"],
      operations: [{
        kind: "SET_RECORD_FIELDS",
        file: "input/canonical.json",
        recordId: "occurrence-91",
        fields: { status: "active", closedAt: null },
      }],
      minimumInformationRequest: [],
      approvalLevel: "SIMULATED_HUMAN",
      summary: "A same-name, same-slot observation is treated as continuity with the closed occurrence.",
    };
  }
  return {
    ...baseline,
    action: "UPDATE_DATA",
    affectedFiles: ["input/canonical.json"],
    operations: [{ kind: "SET_RECORD_FIELDS", file: "input/canonical.json", recordId: "athlete-61", fields: { status: "removed" } }],
    summary: "An absent athlete is removed from canonical state.",
  };
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
      fields: record.fields,
    }));
  } else if (oracle.expectedAction === "REPAIR_ADAPTER") {
    operations = [adapterRepairs[caseId]];
  }
  const affectedEntities = [
    ...new Set([
      ...oracle.expectedRecords.map((record) => record.recordId),
      ...loaded.observations.map((entry) => entry.subjectId).filter((value): value is string => Boolean(value)),
    ]),
  ];
  return {
    schemaVersion: 1,
    caseId,
    action: oracle.expectedAction,
    firstMaterialDivergence: `The first material divergence is established by ${oracle.requiredEvidenceIds.join(", ")}.`,
    failureOwner: oracle.expectedAction === "REPAIR_ADAPTER"
      ? "source-adapter"
      : oracle.expectedAction === "UPDATE_DATA"
        ? "canonical-data"
        : "source-observation",
    evidenceUsed: oracle.requiredEvidenceIds,
    evidenceRejected: loaded.observations.map((entry) => entry.id).filter((id) => !oracle.requiredEvidenceIds.includes(id)),
    affectedEntities,
    affectedFiles: oracle.allowedChangedFiles,
    operations,
    preservedInvariants: loaded.policy.invariants,
    unresolvedUncertainty: oracle.expectedAction === "HUMAN_REVIEW"
      ? ["The available evidence cannot establish a unique authoritative identity or state transition."]
      : [],
    minimumInformationRequest: oracle.requiredMinimumInformation,
    retryCondition: oracle.requiredRetryConditionIncludes.length > 0
      ? `Retry after ${oracle.requiredRetryConditionIncludes.join(" while retaining ")}.`
      : null,
    approvalLevel: oracle.expectedAction === "HUMAN_REVIEW" ? "NONE" : "SIMULATED_HUMAN",
    summary: oracle.expectedAction === "HUMAN_REVIEW"
      ? "The evidence is insufficient for a safe mutation; escalate with the exact missing information."
      : `Evidence supports ${oracle.expectedAction} while preserving declared invariants.`,
  };
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
      evidenceIds: oracle.requiredEvidenceIds,
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
