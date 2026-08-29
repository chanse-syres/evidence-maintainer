import type {
  CaseOracle,
  CaseOracleV4,
  DecisionPackage,
  MaintainerProposal,
} from "./schemas.ts";

export function validateCandidateOperations(
  proposal: MaintainerProposal,
  manifestAllowedPaths: readonly string[],
  oracle: CaseOracle,
): string[] {
  const errors: string[] = [];
  const manifestAllowed = new Set(manifestAllowedPaths);
  const oracleAllowed = new Set(oracle.allowedChangedFiles);
  const mutationAction = proposal.action === "UPDATE_DATA" || proposal.action === "REPAIR_ADAPTER";
  const operationFiles = proposal.operations.map((operation) => operation.file);
  if (mutationAction && operationFiles.length === 0) {
    errors.push("Mutation action requires at least one operation.");
  }
  if (!mutationAction && operationFiles.length > 0) {
    errors.push("Non-mutation action cannot include operations.");
  }
  for (const file of operationFiles) {
    if (!manifestAllowed.has(file) || !oracleAllowed.has(file)) {
      errors.push(`Operation target is not allowed by both evaluator surfaces: ${file}`);
    }
  }
  const operationSet = [...new Set(operationFiles)].sort();
  const oracleSet = [...oracleAllowed].sort();
  if (mutationAction && JSON.stringify(operationSet) !== JSON.stringify(oracleSet)) {
    errors.push("Operation targets do not exactly cover the adjudicated writable files.");
  }
  return errors;
}

export function validateDecisionOperations(
  packageValue: DecisionPackage,
  manifestAllowedPaths: readonly string[],
  oracle: CaseOracleV4,
): string[] {
  const errors: string[] = [];
  const manifestAllowed = new Set(manifestAllowedPaths);
  const oracleAllowed = new Set(oracle.allowedChangedFiles);
  const mutationAction = packageValue.action === "UPDATE_DATA" || packageValue.action === "REPAIR_ADAPTER";
  const operationFiles = packageValue.operations.map((operation) => operation.file);
  if (mutationAction && operationFiles.length === 0) {
    errors.push("Mutation action requires at least one operation.");
  }
  if (!mutationAction && operationFiles.length > 0) {
    errors.push("Non-mutation action cannot include operations.");
  }
  for (const file of operationFiles) {
    if (!manifestAllowed.has(file) || !oracleAllowed.has(file)) {
      errors.push(`Operation target is not allowed by both evaluator surfaces: ${file}`);
    }
  }
  return errors;
}
