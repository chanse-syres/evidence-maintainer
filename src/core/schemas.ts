import { z } from "zod";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampSchema = z.iso.datetime({ offset: true });
const RelativePathSchema = z.string().min(1).refine((value) => {
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    return false;
  }
  return !value.split("/").some((segment) => segment === ".." || segment === "");
}, "must be a normalized relative path");

export const ActionClassSchema = z.enum([
  "UPDATE_DATA",
  "REPAIR_ADAPTER",
  "RETRY_LATER",
  "NO_ACTION",
  "HUMAN_REVIEW",
]);

export const ApprovalLevelSchema = z.enum(["NONE", "SIMULATED_HUMAN"]);

export const ProvenanceSchema = z.object({
  sourceId: z.string().min(1),
  path: RelativePathSchema,
  url: z.url().optional(),
  sourceClass: z.enum(["PUBLIC", "SYNTHETIC", "EXPRESSLY_APPROVED"]),
  capturedAt: TimestampSchema,
  transformation: z.string().min(1),
  permissionBasis: z.string().min(1),
  sha256: Sha256Schema,
}).strict();

export const CaseManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1),
  description: z.string().min(1),
  sourceClass: z.enum(["PUBLIC", "SYNTHETIC", "EXPRESSLY_APPROVED"]),
  createdFrom: z.string().min(1),
  agentVisibleFiles: z.array(RelativePathSchema).min(1),
  allowedWritePaths: z.array(RelativePathSchema),
  requiredCommands: z.array(z.string().min(1)),
  provenance: z.array(ProvenanceSchema).min(1),
}).strict();

export const SourceObservationSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  observedAt: TimestampSchema,
  effectiveAt: TimestampSchema.nullable().default(null),
  authorityScope: z.array(z.string().min(1)),
  subjectId: z.string().min(1).nullable().default(null),
  kind: z.string().min(1),
  status: z.number().int().min(100).max(599).nullable().default(null),
  contentType: z.string().min(1).nullable().default(null),
  schemaFingerprint: z.string().min(1).nullable().default(null),
  facts: z.record(z.string(), z.json()),
}).strict();

export const PolicySchema = z.object({
  schemaVersion: z.literal(1),
  cutoff: TimestampSchema,
  authorityByField: z.record(z.string(), z.string().min(1)),
  freshnessWindowMinutes: z.number().int().nonnegative(),
  retryLimit: z.number().int().nonnegative(),
  invariants: z.array(z.string().min(1)).min(1),
  rules: z.array(z.string().min(1)).min(1),
}).strict();

export const EvidenceEventSchema = z.object({
  id: z.string().min(1),
  seq: z.number().int().positive(),
  kind: z.enum([
    "CASE_OPENED",
    "CANONICAL_SNAPSHOT",
    "SOURCE_OBSERVATION",
    "POLICY_LOADED",
    "WORKSPACE_HASHED",
  ]),
  occurredAt: TimestampSchema,
  evidenceIds: z.array(z.string().min(1)),
  payload: z.record(z.string(), z.json()),
  sha256: Sha256Schema,
}).strict();

const MutationFieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const MutationFieldAssignmentSchema = z.object({
  field: z.string().min(1),
  value: MutationFieldValueSchema,
}).strict();

export const MutationOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("SET_RECORD_FIELDS"),
    file: RelativePathSchema,
    recordId: z.string().min(1),
    assignments: z.array(MutationFieldAssignmentSchema).min(1),
  }).strict(),
  z.object({
    kind: z.literal("REPLACE_TEXT"),
    file: RelativePathSchema,
    find: z.string().min(1),
    replace: z.string(),
    expectedCount: z.number().int().positive(),
  }).strict(),
  z.object({
    kind: z.literal("NO_MUTATION"),
    reason: z.string().min(1),
  }).strict(),
]);

export const MaintainerProposalSchema = z.object({
  schemaVersion: z.literal(1),
  caseId: z.string().min(1),
  action: ActionClassSchema,
  firstMaterialDivergence: z.string().min(1),
  failureOwner: z.string().min(1),
  evidenceUsed: z.array(z.string().min(1)).min(1),
  evidenceRejected: z.array(z.string().min(1)),
  affectedEntities: z.array(z.string().min(1)),
  affectedFiles: z.array(RelativePathSchema),
  operations: z.array(MutationOperationSchema),
  preservedInvariants: z.array(z.string().min(1)).min(1),
  unresolvedUncertainty: z.array(z.string().min(1)),
  minimumInformationRequest: z.array(z.string().min(1)),
  retryCondition: z.string().min(1).nullable(),
  approvalLevel: ApprovalLevelSchema,
  summary: z.string().min(1),
}).strict();

export const ChallengerVerdictSchema = z.object({
  schemaVersion: z.literal(1),
  caseId: z.string().min(1),
  verdict: z.enum(["CONFIRM", "REJECT", "ESCALATE"]),
  evidenceIds: z.array(z.string().min(1)).min(1),
  violations: z.array(z.string().min(1)),
  residualRisks: z.array(z.string().min(1)),
  summary: z.string().min(1),
}).strict();

export const CheckResultSchema = z.object({
  id: z.string().min(1),
  passed: z.boolean(),
  summary: z.string().min(1),
  details: z.array(z.string()),
}).strict();

export const BaselineResultSchema = MaintainerProposalSchema.extend({
  arm: z.literal("baseline"),
  executedCommands: z.array(z.string()),
}).strict();

export const ExpectedRecordSchema = z.object({
  file: RelativePathSchema,
  recordId: z.string().min(1),
  fields: z.record(z.string(), z.json()),
}).strict();

export const CaseOracleSchema = z.object({
  schemaVersion: z.literal(1),
  caseId: z.string().min(1),
  expectedAction: ActionClassSchema,
  requiredEvidenceIds: z.array(z.string().min(1)).min(1),
  allowedChangedFiles: z.array(RelativePathSchema),
  expectedRecords: z.array(ExpectedRecordSchema),
  requiredChallengerVerdict: z.enum(["CONFIRM", "REJECT", "ESCALATE"]),
  requiredMinimumInformation: z.array(z.string().min(1)),
  requiredRetryConditionIncludes: z.array(z.string().min(1)),
  expectedCommandExitCodes: z.record(z.string(), z.number().int()),
}).strict();

export const RunManifestSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.literal("evidence-maintainer"),
  runId: z.string().min(1),
  caseId: z.string().min(1),
  arm: z.enum(["baseline", "advanced"]),
  mode: z.enum(["live", "recorded"]),
  model: z.string().min(1),
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema,
  durationMs: z.number().int().nonnegative(),
  timeoutMs: z.number().int().positive(),
  promptSha256: Sha256Schema,
  outputSchemaSha256: Sha256Schema,
  caseSetSha256: Sha256Schema,
  trajectoryPaths: z.array(RelativePathSchema).min(1),
  artifactSha256: z.record(z.string(), Sha256Schema),
  tokenUsage: z.object({
    input: z.number().int().nonnegative(),
    cachedInput: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
  }).strict().nullable(),
  outcome: z.enum(["PASS", "FAIL", "ERROR"]),
}).strict();

export type ActionClass = z.infer<typeof ActionClassSchema>;
export type CaseManifest = z.infer<typeof CaseManifestSchema>;
export type SourceObservation = z.infer<typeof SourceObservationSchema>;
export type Policy = z.infer<typeof PolicySchema>;
export type EvidenceEvent = z.infer<typeof EvidenceEventSchema>;
export type MutationOperation = z.infer<typeof MutationOperationSchema>;
export type MaintainerProposal = z.infer<typeof MaintainerProposalSchema>;
export type ChallengerVerdict = z.infer<typeof ChallengerVerdictSchema>;
export type CheckResult = z.infer<typeof CheckResultSchema>;
export type BaselineResult = z.infer<typeof BaselineResultSchema>;
export type CaseOracle = z.infer<typeof CaseOracleSchema>;
export type RunManifest = z.infer<typeof RunManifestSchema>;

export { RelativePathSchema, Sha256Schema, TimestampSchema };
