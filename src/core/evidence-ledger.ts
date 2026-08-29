import { sha256Json } from "./canonical-json.ts";
import {
  EvidenceEventSchema,
  type EvidenceEvent,
} from "./schemas.ts";
import type { LoadedPublicCase, LoadedPublicCaseV4 } from "./case-loader.ts";

interface EventDraft {
  kind: EvidenceEvent["kind"];
  occurredAt: string;
  evidenceIds: string[];
  payload: unknown;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function finalize(drafts: EventDraft[]): EvidenceEvent[] {
  return drafts.map((draft, index) => {
    const seq = index + 1;
    const id = `evt-${String(seq).padStart(3, "0")}`;
    const content = { id, seq, ...draft };
    return EvidenceEventSchema.parse({ ...content, sha256: sha256Json(content) });
  });
}

export function buildEvidenceLedger(loaded: LoadedPublicCase | LoadedPublicCaseV4): EvidenceEvent[] {
  const capturedAt = [...loaded.manifest.provenance]
    .map((entry) => entry.capturedAt)
    .sort()[0];
  const observations = [...loaded.observations].sort((left, right) =>
    left.observedAt.localeCompare(right.observedAt) ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.id.localeCompare(right.id),
  );

  const drafts: EventDraft[] = [
    {
      kind: "CASE_OPENED",
      occurredAt: capturedAt,
      evidenceIds: [loaded.manifest.id],
      payload: {
        caseId: loaded.manifest.id,
        title: loaded.manifest.title,
        sourceClass: loaded.manifest.sourceClass,
      },
    },
    {
      kind: "CANONICAL_SNAPSHOT",
      occurredAt: capturedAt,
      evidenceIds: ["input/canonical.json"],
      payload: {
        path: "input/canonical.json",
        sha256: loaded.workspaceFiles.find((file) => file.path === "input/canonical.json")?.sha256 ?? "",
        value: cloneJson(loaded.canonical),
      },
    },
    ...observations.map<EventDraft>((observation) => ({
      kind: "SOURCE_OBSERVATION",
      occurredAt: observation.observedAt,
      evidenceIds: [observation.id],
      payload: cloneJson(observation),
    })),
    {
      kind: "POLICY_LOADED",
      occurredAt: loaded.policy.cutoff,
      evidenceIds: ["input/policy.json"],
      payload: {
        path: "input/policy.json",
        sha256: loaded.workspaceFiles.find((file) => file.path === "input/policy.json")?.sha256 ?? "",
        value: cloneJson(loaded.policy),
      },
    },
    {
      kind: "WORKSPACE_HASHED",
      occurredAt: capturedAt,
      evidenceIds: loaded.workspaceFiles.map((file) => file.path),
      payload: {
        sha256: loaded.workspaceHash,
        files: cloneJson(loaded.workspaceFiles),
      },
    },
  ];

  return finalize(drafts);
}
