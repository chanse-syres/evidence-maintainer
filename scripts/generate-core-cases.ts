import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256Text } from "../src/core/canonical-json.ts";
import type { ActionClass } from "../src/core/schemas.ts";

interface CaseDefinition {
  id: string;
  title: string;
  description: string;
  createdFrom: string;
  allowedWritePaths: string[];
  requiredCommands: string[];
  files: Record<string, string>;
  oracle: {
    expectedAction: ActionClass;
    requiredEvidenceIds: string[];
    allowedChangedFiles: string[];
    expectedRecords: Array<{ file: string; recordId: string; fields: Record<string, unknown> }>;
    requiredChallengerVerdict: "CONFIRM" | "REJECT" | "ESCALATE";
    requiredMinimumInformation?: string[];
    requiredRetryConditionIncludes?: string[];
    expectedCommandExitCodes?: Record<string, number>;
  };
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const capturedAt = "2026-08-28T18:00:00.000Z";

function policy(input: {
  cutoff?: string;
  authorityByField?: Record<string, string>;
  freshnessWindowMinutes?: number;
  invariants: string[];
  rules: string[];
}) {
  return {
    schemaVersion: 1,
    cutoff: input.cutoff ?? "2026-08-28T17:00:00.000Z",
    authorityByField: input.authorityByField ?? {},
    freshnessWindowMinutes: input.freshnessWindowMinutes ?? 10_080,
    retryLimit: 2,
    invariants: input.invariants,
    rules: input.rules,
  };
}

function observation(input: {
  id: string;
  sourceId: string;
  observedAt: string;
  effectiveAt?: string | null;
  authorityScope?: string[];
  subjectId?: string | null;
  kind: string;
  status?: number | null;
  contentType?: string | null;
  schemaFingerprint?: string | null;
  facts: Record<string, unknown>;
}) {
  return {
    id: input.id,
    sourceId: input.sourceId,
    observedAt: input.observedAt,
    effectiveAt: input.effectiveAt ?? null,
    authorityScope: input.authorityScope ?? [],
    subjectId: input.subjectId ?? null,
    kind: input.kind,
    status: input.status ?? null,
    contentType: input.contentType ?? null,
    schemaFingerprint: input.schemaFingerprint ?? null,
    facts: input.facts,
  };
}

const adapterCommand = "node --experimental-strip-types --test adapter.test.ts";

const definitions: CaseDefinition[] = [
  {
    id: "update-transfer-destination",
    title: "Resolve a transfer only from official destination evidence",
    description: "A destination institution confirms enrollment after earlier speculation and an outbound portal record.",
    createdFrom: "Public recruiting transfer reconciliation pattern",
    allowedWritePaths: ["input/canonical.json"],
    requiredCommands: [],
    files: {
      "input/canonical.json": json([{ id: "athlete-21", name: "Morgan Reed", status: "transfer-out", destination: null, effectiveAt: "2026-08-12T16:00:00.000Z" }]),
      "input/observations.json": json([
        observation({ id: "obs-transfer-rumor", sourceId: "news-aggregator", observedAt: "2026-08-20T09:00:00.000Z", effectiveAt: "2026-08-19T18:00:00.000Z", authorityScope: ["discovery"], subjectId: "athlete-21", kind: "destination-rumor", status: 200, contentType: "text/html", schemaFingerprint: "news-v2", facts: { destination: "Lakeside" } }),
        observation({ id: "obs-official-destination", sourceId: "official-destination-roster", observedAt: "2026-08-24T16:30:00.000Z", effectiveAt: "2026-08-24T16:00:00.000Z", authorityScope: ["transfer-destination", "enrollment-status"], subjectId: "athlete-21", kind: "official-roster", status: 200, contentType: "application/json", schemaFingerprint: "official-roster-v5", facts: { destination: "Summit State", status: "transferred" } }),
      ]),
      "input/policy.json": json(policy({ authorityByField: { destination: "official-destination-roster", status: "official-destination-roster" }, invariants: ["Athlete identity remains stable", "Rumors cannot resolve a destination"], rules: ["Use effective authority at or before cutoff", "Destination and status must move together"] })),
    },
    oracle: { expectedAction: "UPDATE_DATA", requiredEvidenceIds: ["obs-official-destination"], allowedChangedFiles: ["input/canonical.json"], expectedRecords: [{ file: "input/canonical.json", recordId: "athlete-21", fields: { destination: "Summit State", status: "transferred" } }], requiredChallengerVerdict: "CONFIRM" },
  },
  {
    id: "update-authoritative-rating",
    title: "Update only the rating owned by its publishing authority",
    description: "One rating provider updates its scoped value while a separate provider remains unchanged and cannot override it.",
    createdFrom: "Field-scoped public rating maintenance pattern",
    allowedWritePaths: ["input/canonical.json"],
    requiredCommands: [],
    files: {
      "input/canonical.json": json([{ id: "athlete-31", name: "Riley Chen", provider: "ScoutMetric", rating: 88, ratingAsOf: "2026-08-01T12:00:00.000Z", otherProviderRating: 91 }]),
      "input/observations.json": json([
        observation({ id: "obs-other-provider", sourceId: "RankGrid", observedAt: "2026-08-22T15:00:00.000Z", effectiveAt: "2026-08-15T12:00:00.000Z", authorityScope: ["RankGrid.rating"], subjectId: "athlete-31", kind: "rating", status: 200, contentType: "application/json", schemaFingerprint: "rating-v1", facts: { rating: 91 } }),
        observation({ id: "obs-scoutmetric-rating", sourceId: "ScoutMetric", observedAt: "2026-08-25T18:00:00.000Z", effectiveAt: "2026-08-25T17:30:00.000Z", authorityScope: ["ScoutMetric.rating"], subjectId: "athlete-31", kind: "rating", status: 200, contentType: "application/json", schemaFingerprint: "rating-v3", facts: { rating: 93 } }),
      ]),
      "input/policy.json": json(policy({ authorityByField: { rating: "ScoutMetric", otherProviderRating: "RankGrid" }, invariants: ["Provider-specific ratings do not overwrite one another", "Stable athlete identity is preserved"], rules: ["A provider owns only its named rating field", "Use the latest effective value from that provider"] })),
    },
    oracle: { expectedAction: "UPDATE_DATA", requiredEvidenceIds: ["obs-scoutmetric-rating"], allowedChangedFiles: ["input/canonical.json"], expectedRecords: [{ file: "input/canonical.json", recordId: "athlete-31", fields: { rating: 93, ratingAsOf: "2026-08-25T17:30:00.000Z", otherProviderRating: 91 } }], requiredChallengerVerdict: "CONFIRM" },
  },
  {
    id: "repair-selector-drift",
    title: "Repair semantic selector drift without overfitting presentation classes",
    description: "A stable data attribute survives a redesign while a presentation-only class changes.",
    createdFrom: "Observed public roster selector drift pattern",
    allowedWritePaths: ["adapter.ts"],
    requiredCommands: [adapterCommand],
    files: {
      "input/canonical.json": json([]),
      "input/observations.json": json([observation({ id: "obs-selector-drift", sourceId: "official-roster", observedAt: "2026-08-26T10:00:00.000Z", authorityScope: ["roster-shape"], kind: "schema-change", status: 200, contentType: "text/html", schemaFingerprint: "roster-semantic-id-v2", facts: { stableAttribute: "data-athlete-id", oldClass: "player-card", newClass: "roster-person" } })]),
      "input/policy.json": json(policy({ invariants: ["Old and new fixtures return identical athlete identities", "Presentation classes are not authority"], rules: ["Anchor extraction to stable semantic attributes", "Preserve old fixture behavior"] })),
      "adapter.ts": `export interface Athlete { id: string; name: string }\n\nexport function extractAthletes(html: string): Athlete[] {\n  const pattern = /<article class="player-card" data-athlete-id="([^"]+)"><span data-name>([^<]+)<\\/span><\\/article>/g;\n  return [...html.matchAll(pattern)].map((match) => ({ id: match[1], name: match[2] }));\n}\n`,
      "adapter.test.ts": `import assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\nimport test from "node:test";\nimport { extractAthletes } from "./adapter.ts";\n\ntest("old fixture remains supported", () => assert.deepEqual(extractAthletes(readFileSync("fixtures/old.html", "utf8")), [{ id: "p-1", name: "Alex North" }]));\ntest("new fixture uses the stable semantic athlete ID", () => assert.deepEqual(extractAthletes(readFileSync("fixtures/new.html", "utf8")), [{ id: "p-2", name: "Sam West" }]));\n`,
      "fixtures/old.html": `<article class="player-card" data-athlete-id="p-1"><span data-name>Alex North</span></article>\n`,
      "fixtures/new.html": `<article class="roster-person" data-athlete-id="p-2"><span data-name>Sam West</span></article>\n`,
    },
    oracle: { expectedAction: "REPAIR_ADAPTER", requiredEvidenceIds: ["obs-selector-drift"], allowedChangedFiles: ["adapter.ts"], expectedRecords: [], requiredChallengerVerdict: "CONFIRM", expectedCommandExitCodes: { [adapterCommand]: 0 } },
  },
  {
    id: "repair-json-nesting",
    title: "Repair a roster payload that moved under a stable semantic envelope",
    description: "Players move from a top-level array to data.roster while record semantics remain stable.",
    createdFrom: "Observed public JSON nesting drift pattern",
    allowedWritePaths: ["adapter.ts"],
    requiredCommands: [adapterCommand],
    files: {
      "input/canonical.json": json([]),
      "input/observations.json": json([observation({ id: "obs-json-nesting", sourceId: "official-api", observedAt: "2026-08-26T11:00:00.000Z", authorityScope: ["roster-shape"], kind: "schema-change", status: 200, contentType: "application/json", schemaFingerprint: "roster-envelope-v2", facts: { oldPath: "players", newPath: "data.roster", itemIdentity: "id" } })]),
      "input/policy.json": json(policy({ invariants: ["Old and new payloads produce the same normalized records", "Record IDs remain stable"], rules: ["Support the documented envelope transition", "Reject unrelated arrays"] })),
      "adapter.ts": `export interface Player { id: string; name: string }\n\nexport function extractPlayers(payload: unknown): Player[] {\n  const players = (payload as { players?: Player[] }).players ?? [];\n  return players.map(({ id, name }) => ({ id, name }));\n}\n`,
      "adapter.test.ts": `import assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\nimport test from "node:test";\nimport { extractPlayers } from "./adapter.ts";\nconst load = (name: string) => JSON.parse(readFileSync(name, "utf8"));\ntest("old top-level payload remains supported", () => assert.deepEqual(extractPlayers(load("fixtures/old.json")), [{ id: "p-1", name: "Alex North" }]));\ntest("new semantic envelope is supported", () => assert.deepEqual(extractPlayers(load("fixtures/new.json")), [{ id: "p-2", name: "Sam West" }]));\n`,
      "fixtures/old.json": json({ players: [{ id: "p-1", name: "Alex North" }] }),
      "fixtures/new.json": json({ data: { roster: [{ id: "p-2", name: "Sam West" }] } }),
    },
    oracle: { expectedAction: "REPAIR_ADAPTER", requiredEvidenceIds: ["obs-json-nesting"], allowedChangedFiles: ["adapter.ts"], expectedRecords: [], requiredChallengerVerdict: "CONFIRM", expectedCommandExitCodes: { [adapterCommand]: 0 } },
  },
  {
    id: "repair-pagination",
    title: "Repair cursor pagination while preserving complete historical collection",
    description: "Opaque nextPage tokens replace numeric pages and a correct adapter must collect all pages without duplicates.",
    createdFrom: "Observed public API pagination transition pattern",
    allowedWritePaths: ["adapter.ts"],
    requiredCommands: [adapterCommand],
    files: {
      "input/canonical.json": json([]),
      "input/observations.json": json([observation({ id: "obs-pagination-token", sourceId: "official-api", observedAt: "2026-08-26T12:00:00.000Z", authorityScope: ["pagination-contract"], kind: "schema-change", status: 200, contentType: "application/json", schemaFingerprint: "cursor-pagination-v1", facts: { oldAddress: "integer page", newAddress: "nextPage token", expectedRecords: 3 } })]),
      "input/policy.json": json(policy({ invariants: ["Every fixture record appears exactly once", "Historical numeric pagination remains supported"], rules: ["Follow the response-provided continuation address", "Terminate only on a null continuation"] })),
      "adapter.ts": `export interface Page { records: string[]; nextPage: string | null }\n\nexport function collectPages(loadPage: (address: string) => Page, start: string): string[] {\n  const records: string[] = [];\n  let page = Number(start);\n  while (Number.isInteger(page) && page <= 3) {\n    records.push(...loadPage(String(page)).records);\n    page += 1;\n  }\n  return records;\n}\n`,
      "adapter.test.ts": `import assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\nimport test from "node:test";\nimport { collectPages, type Page } from "./adapter.ts";\nconst load = (name: string) => JSON.parse(readFileSync(name, "utf8")) as Record<string, Page>;\ntest("old numeric fixture remains supported", () => { const pages = load("fixtures/old.json"); assert.deepEqual(collectPages((key) => pages[key], "1"), ["a", "b", "c"]); });\ntest("new opaque continuation tokens are followed", () => { const pages = load("fixtures/new.json"); assert.deepEqual(collectPages((key) => pages[key], "start"), ["d", "e", "f"]); });\n`,
      "fixtures/old.json": json({ "1": { records: ["a"], nextPage: "2" }, "2": { records: ["b"], nextPage: "3" }, "3": { records: ["c"], nextPage: null } }),
      "fixtures/new.json": json({ start: { records: ["d"], nextPage: "token-b" }, "token-b": { records: ["e"], nextPage: "token-c" }, "token-c": { records: ["f"], nextPage: null } }),
    },
    oracle: { expectedAction: "REPAIR_ADAPTER", requiredEvidenceIds: ["obs-pagination-token"], allowedChangedFiles: ["adapter.ts"], expectedRecords: [], requiredChallengerVerdict: "CONFIRM", expectedCommandExitCodes: { [adapterCommand]: 0 } },
  },
  {
    id: "retry-deferred-406",
    title: "Treat an expected 406 as bounded deferral, not data removal",
    description: "The source contract marks 406 as a temporary deferral and a recent cache remains authoritative.",
    createdFrom: "Public-source deferred response pattern",
    allowedWritePaths: [],
    requiredCommands: [],
    files: {
      "input/canonical.json": json([{ id: "source-41", cachedAt: "2026-08-28T16:45:00.000Z", records: 42 }]),
      "input/observations.json": json([observation({ id: "obs-deferred-406", sourceId: "public-provider", observedAt: "2026-08-28T16:50:00.000Z", kind: "deferred-response", status: 406, contentType: "text/html", schemaFingerprint: "deferred-contract-v1", facts: { deferred: true, retryAfterMinutes: 30, cacheValid: true } })]),
      "input/policy.json": json(policy({ freshnessWindowMinutes: 60, invariants: ["A deferred response cannot delete cached records", "Retries are bounded"], rules: ["Use the valid cache during expected deferral", "Retry after 30 minutes at most twice"] })),
    },
    oracle: { expectedAction: "RETRY_LATER", requiredEvidenceIds: ["obs-deferred-406"], allowedChangedFiles: [], expectedRecords: [], requiredChallengerVerdict: "CONFIRM", requiredRetryConditionIncludes: ["30 minutes", "cache"] },
  },
  {
    id: "retry-timeout-cache",
    title: "Retry a transient timeout while retaining a fresh cache",
    description: "A single timeout occurs inside the bounded freshness window with no contradictory source evidence.",
    createdFrom: "Public adapter timeout and cache fallback pattern",
    allowedWritePaths: [],
    requiredCommands: [],
    files: {
      "input/canonical.json": json([{ id: "source-42", cachedAt: "2026-08-28T16:40:00.000Z", records: 18 }]),
      "input/observations.json": json([observation({ id: "obs-timeout", sourceId: "public-provider", observedAt: "2026-08-28T16:50:00.000Z", kind: "network-timeout", status: null, contentType: null, schemaFingerprint: null, facts: { timeoutMs: 10000, contradictoryEvidence: false } })]),
      "input/policy.json": json(policy({ freshnessWindowMinutes: 45, invariants: ["A transient timeout cannot erase cached records", "Retries are bounded"], rules: ["Retain cache inside freshness window", "Retry after 15 minutes"] })),
    },
    oracle: { expectedAction: "RETRY_LATER", requiredEvidenceIds: ["obs-timeout"], allowedChangedFiles: [], expectedRecords: [], requiredChallengerVerdict: "CONFIRM", requiredRetryConditionIncludes: ["15 minutes", "cache"] },
  },
  {
    id: "retry-partial-document",
    title: "Reject a partial 200 response and wait for a complete document",
    description: "HTTP succeeds but a closing marker and expected schema fingerprint are absent.",
    createdFrom: "Partial public-document response pattern",
    allowedWritePaths: [],
    requiredCommands: [],
    files: {
      "input/canonical.json": json([{ id: "source-43", cachedAt: "2026-08-28T16:20:00.000Z", records: 63 }]),
      "input/observations.json": json([observation({ id: "obs-partial-document", sourceId: "public-provider", observedAt: "2026-08-28T16:55:00.000Z", kind: "partial-document", status: 200, contentType: "text/html", schemaFingerprint: "incomplete:6f21", facts: { closingMarkerPresent: false, contentLength: 4096, expectedMinimumLength: 18000 } })]),
      "input/policy.json": json(policy({ freshnessWindowMinutes: 90, invariants: ["Partial documents cannot replace complete state", "Retries are bounded"], rules: ["Require closing marker and known complete fingerprint", "Retry for a complete document after 20 minutes"] })),
    },
    oracle: { expectedAction: "RETRY_LATER", requiredEvidenceIds: ["obs-partial-document"], allowedChangedFiles: [], expectedRecords: [], requiredChallengerVerdict: "CONFIRM", requiredRetryConditionIncludes: ["20 minutes", "complete document"] },
  },
  {
    id: "noop-newer-publication-stale-effective",
    title: "A newer publication can still describe older effective state",
    description: "A newly published retrospective article predates the canonical effective cutoff and cannot roll state backward.",
    createdFrom: "Bitemporal public-data authority pattern",
    allowedWritePaths: [],
    requiredCommands: [],
    files: {
      "input/canonical.json": json([{ id: "athlete-51", status: "committed", effectiveAt: "2026-08-20T18:00:00.000Z" }]),
      "input/observations.json": json([observation({ id: "obs-new-publication-old-state", sourceId: "official-archive", observedAt: "2026-08-27T12:00:00.000Z", effectiveAt: "2026-08-10T12:00:00.000Z", authorityScope: ["historical-status"], subjectId: "athlete-51", kind: "retrospective", status: 200, contentType: "text/html", schemaFingerprint: "archive-v1", facts: { status: "offered" } })]),
      "input/policy.json": json(policy({ authorityByField: { status: "official-team" }, invariants: ["Effective state never rolls backward because publication is newer"], rules: ["Compare effective time before publication time", "Historical archives are evidence of past state"] })),
    },
    oracle: { expectedAction: "NO_ACTION", requiredEvidenceIds: ["obs-new-publication-old-state"], allowedChangedFiles: [], expectedRecords: [], requiredChallengerVerdict: "CONFIRM" },
  },
  {
    id: "noop-filtered-removal",
    title: "Filtered absence is not roster removal",
    description: "A source view filtered to quarterbacks omits a defensive player without asserting removal.",
    createdFrom: "Scoped public roster view pattern",
    allowedWritePaths: [],
    requiredCommands: [],
    files: {
      "input/canonical.json": json([{ id: "athlete-61", name: "Taylor Moss", position: "DB", status: "active" }]),
      "input/observations.json": json([observation({ id: "obs-filtered-quarterbacks", sourceId: "official-roster", observedAt: "2026-08-27T13:00:00.000Z", authorityScope: ["QB-subset"], kind: "filtered-roster", status: 200, contentType: "application/json", schemaFingerprint: "roster-filter-v2", facts: { filter: "position=QB", returnedIds: ["athlete-62", "athlete-63"], omittedId: "athlete-61" } })]),
      "input/policy.json": json(policy({ authorityByField: { status: "official-roster-unfiltered" }, invariants: ["Subset absence cannot delete an out-of-scope entity"], rules: ["Interpret result sets within declared filter scope", "Removal requires an unfiltered authoritative view or explicit transaction"] })),
    },
    oracle: { expectedAction: "NO_ACTION", requiredEvidenceIds: ["obs-filtered-quarterbacks"], allowedChangedFiles: [], expectedRecords: [], requiredChallengerVerdict: "CONFIRM" },
  },
  {
    id: "review-conflicting-authorities",
    title: "Escalate two authoritative records that disagree at the same effective time",
    description: "Two independently authoritative systems publish incompatible status values for the same entity and neither record contains a supersession edge.",
    createdFrom: "Cross-system authority conflict in public-data maintenance",
    allowedWritePaths: [],
    requiredCommands: [],
    files: {
      "input/canonical.json": json([{ id: "athlete-71", name: "Ari Monroe", status: "active", effectiveAt: "2026-08-20T18:00:00.000Z" }]),
      "input/observations.json": json([
        observation({ id: "obs-athletics-active", sourceId: "official-athletics-roster", observedAt: "2026-08-27T15:00:00.000Z", effectiveAt: "2026-08-27T14:00:00.000Z", authorityScope: ["participation-status"], subjectId: "athlete-71", kind: "official-roster", status: 200, contentType: "application/json", schemaFingerprint: "athletics-roster-v6", facts: { status: "active", supersedes: null } }),
        observation({ id: "obs-registrar-withdrawn", sourceId: "official-registrar", observedAt: "2026-08-27T15:04:00.000Z", effectiveAt: "2026-08-27T14:00:00.000Z", authorityScope: ["enrollment-status", "participation-status"], subjectId: "athlete-71", kind: "official-enrollment", status: 200, contentType: "application/json", schemaFingerprint: "registrar-status-v3", facts: { status: "withdrawn", supersedes: null } }),
      ]),
      "input/policy.json": json(policy({ authorityByField: { status: "official-athletics-roster|official-registrar" }, invariants: ["Conflicting co-authoritative records cannot be resolved by source order", "Canonical state remains unchanged without a supersession edge"], rules: ["Escalate when co-authoritative values disagree at the same effective time", "Require a signed cross-system resolution and its effective timestamp"] })),
    },
    oracle: {
      expectedAction: "HUMAN_REVIEW",
      requiredEvidenceIds: ["obs-athletics-active", "obs-registrar-withdrawn"],
      allowedChangedFiles: [],
      expectedRecords: [],
      requiredChallengerVerdict: "ESCALATE",
      requiredMinimumInformation: ["signed cross-system resolution", "effective timestamp"],
    },
  },
  {
    id: "review-name-collision",
    title: "Refuse to merge a name-only observation into either matching identity",
    description: "A source reports a common name without a stable identifier while two canonical people share that name and overlap in time.",
    createdFrom: "Ambiguous entity resolution in public records",
    allowedWritePaths: [],
    requiredCommands: [],
    files: {
      "input/canonical.json": json([
        { id: "person-81", name: "Jordan Lee", program: "North", graduationYear: 2027, status: "active" },
        { id: "person-82", name: "Jordan Lee", program: "South", graduationYear: 2028, status: "active" },
      ]),
      "input/observations.json": json([
        observation({ id: "obs-name-only-award", sourceId: "official-awards-feed", observedAt: "2026-08-27T16:00:00.000Z", effectiveAt: "2026-08-27T15:30:00.000Z", authorityScope: ["award-status"], subjectId: null, kind: "award-announcement", status: 200, contentType: "application/json", schemaFingerprint: "award-feed-v2", facts: { name: "Jordan Lee", award: "Regional Scholar", stableId: null, program: null, graduationYear: null } }),
      ]),
      "input/policy.json": json(policy({ authorityByField: { award: "official-awards-feed" }, invariants: ["Names are not identity keys", "No award may be attached to an ambiguous person"], rules: ["Entity resolution requires a stable source identifier or two independent disambiguators", "Escalate a name collision rather than choosing the first record"] })),
    },
    oracle: {
      expectedAction: "HUMAN_REVIEW",
      requiredEvidenceIds: ["obs-name-only-award"],
      allowedChangedFiles: [],
      expectedRecords: [],
      requiredChallengerVerdict: "ESCALATE",
      requiredMinimumInformation: ["stable source identifier", "program or graduation year"],
    },
  },
  {
    id: "review-reintroduced-identity",
    title: "Treat a reintroduced name and slot as a potentially new occurrence",
    description: "A previously closed roster slot is reused by the same display name after a gap, but the new publication omits the occurrence-stable identifier needed to prove continuity.",
    createdFrom: "Occurrence identity under removal and reintroduction",
    allowedWritePaths: [],
    requiredCommands: [],
    files: {
      "input/canonical.json": json([{ id: "occurrence-91", displayName: "Casey Quinn", slot: 14, status: "departed", openedAt: "2025-09-01T00:00:00.000Z", closedAt: "2026-05-20T00:00:00.000Z", sourceOccurrenceId: "roster-2025-14" }]),
      "input/observations.json": json([
        observation({ id: "obs-reintroduced-slot", sourceId: "official-roster", observedAt: "2026-08-27T17:00:00.000Z", effectiveAt: "2026-08-27T16:00:00.000Z", authorityScope: ["roster-membership"], subjectId: null, kind: "roster-entry", status: 200, contentType: "application/json", schemaFingerprint: "roster-v7-no-occurrence-id", facts: { displayName: "Casey Quinn", slot: 14, status: "active", sourceOccurrenceId: null, priorEntryPresent: false } }),
      ]),
      "input/policy.json": json(policy({ authorityByField: { status: "official-roster" }, invariants: ["A closed occurrence is immutable", "Display name and physical slot do not establish identity continuity"], rules: ["A reintroduced entry requires an occurrence-stable identifier", "Escalate before linking a post-gap entry to a closed occurrence"] })),
    },
    oracle: {
      expectedAction: "HUMAN_REVIEW",
      requiredEvidenceIds: ["obs-reintroduced-slot"],
      allowedChangedFiles: [],
      expectedRecords: [],
      requiredChallengerVerdict: "ESCALATE",
      requiredMinimumInformation: ["occurrence-stable identifier", "continuity or new-occurrence confirmation"],
    },
  },
];

async function writeCase(root: string, definition: CaseDefinition): Promise<void> {
  const caseDir = resolve(root, definition.id);
  const provenance = [];
  const agentVisibleFiles = [];
  for (const [relativePath, content] of Object.entries(definition.files).sort(([a], [b]) => a.localeCompare(b))) {
    const fullPath = resolve(caseDir, "workspace", ...relativePath.split("/"));
    await mkdir(resolve(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content, "utf8");
    const path = `workspace/${relativePath}`;
    agentVisibleFiles.push(path);
    provenance.push({
      sourceId: `fixture-${relativePath.replaceAll("/", "-")}`,
      path,
      sourceClass: "SYNTHETIC",
      capturedAt,
      transformation: "Synthetic frozen fixture derived from a public-data maintenance pattern",
      permissionBasis: "Created for this benchmark",
      sha256: sha256Text(content),
    });
  }
  const manifest = {
    schemaVersion: 1,
    id: definition.id,
    title: definition.title,
    description: definition.description,
    sourceClass: "SYNTHETIC",
    createdFrom: definition.createdFrom,
    agentVisibleFiles,
    allowedWritePaths: definition.allowedWritePaths,
    requiredCommands: definition.requiredCommands,
    provenance,
  };
  const oracle = {
    schemaVersion: 1,
    caseId: definition.id,
    expectedAction: definition.oracle.expectedAction,
    requiredEvidenceIds: definition.oracle.requiredEvidenceIds,
    allowedChangedFiles: definition.oracle.allowedChangedFiles,
    expectedRecords: definition.oracle.expectedRecords,
    requiredChallengerVerdict: definition.oracle.requiredChallengerVerdict,
    requiredMinimumInformation: definition.oracle.requiredMinimumInformation ?? [],
    requiredRetryConditionIncludes: definition.oracle.requiredRetryConditionIncludes ?? [],
    expectedCommandExitCodes: definition.oracle.expectedCommandExitCodes ?? {},
  };
  await writeFile(resolve(caseDir, "case.json"), json(manifest), "utf8");
  await writeFile(resolve(caseDir, "oracle.json"), json(oracle), "utf8");
}

export async function generateCoreCases(root = resolve("cases")): Promise<string[]> {
  for (const definition of definitions) {
    await writeCase(root, definition);
  }
  return definitions.map((definition) => definition.id);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const ids = await generateCoreCases();
  process.stdout.write(`Generated ${ids.length} core cases:\n${ids.join("\n")}\n`);
}
