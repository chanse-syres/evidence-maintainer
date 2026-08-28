export interface ApprovalRecord {
  schemaVersion: 1;
  caseId: string;
  requested: boolean;
  eligible: boolean;
  decision: "APPROVED" | "REJECTED" | "NOT_REQUESTED";
  reason: string;
  recordedAt: string;
}

export function recordApproval(input: {
  caseId: string;
  requested: boolean;
  gateStatus: "PASS" | "FAIL";
  recordedAt?: string;
}): ApprovalRecord {
  const eligible = input.gateStatus === "PASS";
  const decision = !input.requested
    ? "NOT_REQUESTED"
    : eligible
      ? "APPROVED"
      : "REJECTED";
  return {
    schemaVersion: 1,
    caseId: input.caseId,
    requested: input.requested,
    eligible,
    decision,
    reason: decision === "APPROVED"
      ? "The deterministic gate passed and isolated application was requested."
      : decision === "REJECTED"
        ? "Approval is ineligible because the deterministic gate failed."
        : "No simulated approval was requested.",
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  };
}
