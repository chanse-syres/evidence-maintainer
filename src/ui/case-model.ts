import type { ActionClass } from "../core/schemas.ts";
import { loadRunArtifacts } from "../reports/load-artifacts.ts";

export type ActionTone = "update" | "repair" | "retry" | "noop" | "review";

export interface ActionBadge {
  label: string;
  tone: ActionTone;
}

const actionPresentation: Record<ActionClass, ActionBadge> = {
  UPDATE_DATA: { label: "Update data", tone: "update" },
  REPAIR_ADAPTER: { label: "Repair adapter", tone: "repair" },
  RETRY_LATER: { label: "Retry later", tone: "retry" },
  NO_ACTION: { label: "No action", tone: "noop" },
  HUMAN_REVIEW: { label: "Human review", tone: "review" },
};

export function actionBadgeFor(action: ActionClass): ActionBadge {
  return actionPresentation[action];
}

export function evidenceModeLabel(mode: "live" | "recorded"): string {
  return mode === "live" ? "Live agent evidence" : "Recorded evidence";
}

export async function loadCaseModel(runDir: string) {
  const artifacts = await loadRunArtifacts(runDir);
  return {
    caseId: artifacts.manifest.caseId,
    title: artifacts.caseManifest.title,
    description: artifacts.caseManifest.description,
    action: artifacts.proposal.action,
    actionBadge: actionBadgeFor(artifacts.proposal.action),
    mode: artifacts.manifest.mode,
    modeLabel: evidenceModeLabel(artifacts.manifest.mode),
    model: artifacts.manifest.model,
    outcome: artifacts.manifest.outcome,
    durationMs: artifacts.manifest.durationMs,
    evidence: artifacts.evidence,
    proposal: artifacts.proposal,
    challenger: artifacts.challenger,
    checks: artifacts.gate.checks,
    gateStatus: artifacts.gate.status,
    diff: artifacts.diff,
    changedFiles: artifacts.gate.changedFiles,
    residualRisks: artifacts.challenger.residualRisks,
    approval: artifacts.approval,
    reportPath: `/reports/${artifacts.manifest.caseId}.html`,
    artifactHashes: Object.entries(artifacts.manifest.artifactSha256)
      .map(([path, sha256]) => ({ path, sha256 }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export type CaseModel = Awaited<ReturnType<typeof loadCaseModel>>;
