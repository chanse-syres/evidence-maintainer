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

// V1-V3 evidence remains readable during the V4 migration. New V4 cases must
// use PolicyV4Schema; this legacy schema is not a V4 execution contract.
export const PolicySchema = z.object({
  schemaVersion: z.literal(1),
  cutoff: TimestampSchema,
  authorityByField: z.record(z.string(), z.string().min(1)),
  freshnessWindowMinutes: z.number().int().nonnegative(),
  retryLimit: z.number().int().nonnegative(),
  invariants: z.array(z.string().min(1)).min(1),
  rules: z.array(z.string().min(1)).min(1),
}).strict();

export const AuthorityValiditySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("SNAPSHOT_MAX_AGE"),
    sourceId: z.string().min(1),
    authorityScope: z.string().min(1),
    maxAgeMinutes: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    mode: z.literal("EFFECTIVE_UNTIL_SUPERSEDED"),
    sourceId: z.string().min(1),
    authorityScope: z.string().min(1),
    applicabilityFactPath: z.string().regex(/^facts(?:\.[A-Za-z0-9_-]+)+$/),
  }).strict(),
  z.object({
    mode: z.literal("EVENT_AT_CUTOFF"),
    sourceId: z.string().min(1),
    authorityScope: z.string().min(1),
    eventFactPath: z.string().regex(/^facts(?:\.[A-Za-z0-9_-]+)+$/),
  }).strict(),
]);

export const PolicyV4Schema = z.object({
  schemaVersion: z.literal(2),
  cutoff: TimestampSchema,
  authorityByField: z.record(z.string(), z.string().min(1)),
  authorityValidity: z.array(AuthorityValiditySchema).min(1),
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
]);

export const EvidenceAssessmentSchema = z.object({
  evidenceId: z.string().min(1),
  factPath: z.string().regex(/^(?:\$|sourceId|observedAt|effectiveAt|authorityScope|subjectId|kind|status|contentType|schemaFingerprint|facts(?:\.[A-Za-z0-9_-]+)+)$/),
  disposition: z.enum(["SUPPORT", "REJECT", "CONTEXT"]),
  reason: z.string().min(1),
}).strict();

export const ReviewRequestSchema = z.object({
  subjectId: z.string().min(1),
  targetEvidenceId: z.string().min(1),
  requestedFactPaths: z.array(z.string().regex(/^facts(?:\.[A-Za-z0-9_-]+)+$/)).min(1),
}).strict();

export const AgreementCheckSchema = z.object({
  leftEvidenceId: z.string().min(1),
  leftFactPath: z.string().regex(/^facts(?:\.[A-Za-z0-9_-]+)+$/),
  rightEvidenceId: z.string().min(1),
  rightFactPath: z.string().regex(/^facts(?:\.[A-Za-z0-9_-]+)+$/),
}).strict();

export const ValueCheckSchema = z.object({
  evidenceId: z.string().min(1),
  factPath: z.string().regex(/^facts(?:\.[A-Za-z0-9_-]+)+$/),
  expectedValue: MutationFieldValueSchema,
}).strict();

export const LegacyRetryPlanSchema = z.object({
  notBefore: TimestampSchema,
  maxAttempts: z.number().int().positive(),
  escalateAfterAttempt: z.number().int().positive(),
  preserveRecordIds: z.array(z.string().min(1)),
  agreementChecks: z.array(AgreementCheckSchema),
  valueChecks: z.array(ValueCheckSchema),
}).strict();

export const ObservationSelectorSchema = z.object({
  sourceId: z.string().min(1),
  subjectId: z.string().min(1),
  kind: z.string().min(1).optional(),
  factPath: z.string().regex(/^facts(?:\.[A-Za-z0-9_-]+)+$/),
}).strict();

export const FutureConditionSchema = z.object({
  selector: ObservationSelectorSchema,
  operator: z.enum([
    "EQUALS",
    "NOT_EQUALS",
    "GREATER_THAN_OR_EQUAL",
    "LESS_THAN_OR_EQUAL",
    "EXISTS",
  ]),
  expectedValue: MutationFieldValueSchema.optional(),
}).strict().superRefine((condition, ctx) => {
  if (condition.operator !== "EXISTS" && condition.expectedValue === undefined) {
    ctx.addIssue({ code: "custom", message: "A comparison condition requires expectedValue" });
  }
  if (condition.operator === "EXISTS" && condition.expectedValue !== undefined) {
    ctx.addIssue({ code: "custom", message: "EXISTS does not accept expectedValue" });
  }
});

export const RetryPlanSchema = z.object({
  notBefore: TimestampSchema,
  maxAttempts: z.number().int().positive(),
  escalateAfterAttempt: z.number().int().positive(),
  preserveRecordIds: z.array(z.string().min(1)),
  acceptanceConditions: z.array(FutureConditionSchema).min(1),
}).strict().refine((plan) => plan.escalateAfterAttempt <= plan.maxAttempts, {
  message: "Escalation cannot occur after the retry budget",
});

const ProposalCommonShape = {
  schemaVersion: z.literal(2),
  caseId: z.string().min(1),
  firstMaterialDivergence: z.string().min(1),
  failureOwner: z.string().min(1),
  evidenceAssessments: z.array(EvidenceAssessmentSchema).min(1),
  affectedEntities: z.array(z.string().min(1)),
  affectedFiles: z.array(RelativePathSchema),
  preservedInvariants: z.array(z.string().min(1)).min(1),
  unresolvedUncertainty: z.array(z.string().min(1)),
  summary: z.string().min(1),
} as const;

const MutationProposalShape = {
  operations: z.array(MutationOperationSchema).min(1),
  reviewRequest: z.null(),
  retryPlan: z.null(),
} as const;

const NonMutationProposalShape = {
  operations: z.tuple([]),
  reviewRequest: z.null(),
  retryPlan: z.null(),
} as const;

const UpdateDataProposalSchema = z.object({
  ...ProposalCommonShape,
  action: z.literal("UPDATE_DATA"),
  ...MutationProposalShape,
}).strict();

const RepairAdapterProposalSchema = z.object({
  ...ProposalCommonShape,
  action: z.literal("REPAIR_ADAPTER"),
  ...MutationProposalShape,
}).strict();

const RetryLaterProposalSchema = z.object({
  ...ProposalCommonShape,
  action: z.literal("RETRY_LATER"),
  operations: z.tuple([]),
  reviewRequest: z.null(),
  retryPlan: LegacyRetryPlanSchema,
}).strict();

const NoActionProposalSchema = z.object({
  ...ProposalCommonShape,
  action: z.literal("NO_ACTION"),
  ...NonMutationProposalShape,
}).strict();

const HumanReviewProposalSchema = z.object({
  ...ProposalCommonShape,
  action: z.literal("HUMAN_REVIEW"),
  operations: z.tuple([]),
  reviewRequest: ReviewRequestSchema,
  retryPlan: z.null(),
}).strict();

// Archival V1-V3 reader. V4 agents use DecisionPackageSchema exclusively.
export const MaintainerProposalSchema = z.discriminatedUnion("action", [
  UpdateDataProposalSchema,
  RepairAdapterProposalSchema,
  RetryLaterProposalSchema,
  NoActionProposalSchema,
  HumanReviewProposalSchema,
]);

// Agent-facing JSON Schema must have an object root. Runtime parsing above
// still enforces the action-specific combinations after generation.
export const MaintainerProposalOutputContractSchema = z.object({
  ...ProposalCommonShape,
  action: ActionClassSchema,
  operations: z.array(MutationOperationSchema),
  reviewRequest: ReviewRequestSchema.nullable(),
  retryPlan: LegacyRetryPlanSchema.nullable(),
}).strict();

const DecisionCommonShape = {
  ...ProposalCommonShape,
  schemaVersion: z.literal(3),
} as const;

const UpdateDataDecisionSchema = z.object({
  ...DecisionCommonShape,
  action: z.literal("UPDATE_DATA"),
  ...MutationProposalShape,
}).strict();

const RepairAdapterDecisionSchema = z.object({
  ...DecisionCommonShape,
  action: z.literal("REPAIR_ADAPTER"),
  ...MutationProposalShape,
}).strict();

const RetryLaterDecisionSchema = z.object({
  ...DecisionCommonShape,
  action: z.literal("RETRY_LATER"),
  operations: z.tuple([]),
  reviewRequest: z.null(),
  retryPlan: RetryPlanSchema,
}).strict();

const NoActionDecisionSchema = z.object({
  ...DecisionCommonShape,
  action: z.literal("NO_ACTION"),
  ...NonMutationProposalShape,
}).strict();

const HumanReviewDecisionSchema = z.object({
  ...DecisionCommonShape,
  action: z.literal("HUMAN_REVIEW"),
  operations: z.tuple([]),
  reviewRequest: ReviewRequestSchema,
  retryPlan: z.null(),
}).strict();

export const DecisionPackageSchema = z.discriminatedUnion("action", [
  UpdateDataDecisionSchema,
  RepairAdapterDecisionSchema,
  RetryLaterDecisionSchema,
  NoActionDecisionSchema,
  HumanReviewDecisionSchema,
]);

export const DecisionPackageOutputContractSchema = z.object({
  ...DecisionCommonShape,
  action: ActionClassSchema,
  operations: z.array(MutationOperationSchema),
  reviewRequest: ReviewRequestSchema.nullable(),
  retryPlan: RetryPlanSchema.nullable(),
}).strict();

// Archival V1-V3 reader. V4 challenge sessions emit ChallengerCritiqueSchema.
export const ChallengerVerdictSchema = z.object({
  schemaVersion: z.literal(1),
  caseId: z.string().min(1),
  verdict: z.enum(["CONFIRM", "REJECT", "ESCALATE"]),
  evidenceIds: z.array(z.string().min(1)).min(1),
  violations: z.array(z.string().min(1)),
  residualRisks: z.array(z.string().min(1)),
  summary: z.string().min(1),
}).strict();

export const ChallengerCritiqueSchema = z.object({
  schemaVersion: z.literal(2),
  caseId: z.string().min(1),
  recommendation: z.enum(["ACCEPT_DRAFT", "REVISE_DRAFT"]),
  evidenceIds: z.array(z.string().min(1)),
  critiqueCategories: z.array(z.enum([
    "ACTION",
    "AUTHORITY",
    "IDENTITY",
    "TEMPORAL",
    "APPLICABILITY",
    "ARTIFACT",
    "WRITE_SURFACE",
    "REGRESSION",
    "UNCERTAINTY",
  ])),
  findings: z.array(z.string().min(1)),
  summary: z.string().min(1),
}).strict();

export const CheckResultSchema = z.object({
  id: z.string().min(1),
  passed: z.boolean(),
  blocking: z.boolean().default(true),
  summary: z.string().min(1),
  details: z.array(z.string()),
}).strict();

const BaselineFields = {
  arm: z.literal("baseline"),
  executedCommands: z.array(z.string()),
} as const;

export const BaselineResultSchema = z.discriminatedUnion("action", [
  UpdateDataProposalSchema.extend(BaselineFields).strict(),
  RepairAdapterProposalSchema.extend(BaselineFields).strict(),
  RetryLaterProposalSchema.extend(BaselineFields).strict(),
  NoActionProposalSchema.extend(BaselineFields).strict(),
  HumanReviewProposalSchema.extend(BaselineFields).strict(),
]);

export const BaselineResultOutputContractSchema = MaintainerProposalOutputContractSchema.extend({
  ...BaselineFields,
}).strict();

export const ExpectedRecordSchema = z.object({
  file: RelativePathSchema,
  recordId: z.string().min(1),
  fields: z.record(z.string(), z.json()),
}).strict();

export const CaseOracleSchema = z.object({
  schemaVersion: z.literal(2),
  caseId: z.string().min(1),
  expectedAction: ActionClassSchema,
  evidenceAssessmentBundles: z.array(z.array(EvidenceAssessmentSchema).min(1)).min(1),
  allowedEvidenceAssessments: z.array(EvidenceAssessmentSchema).min(1),
  requiredChallengerEvidenceIds: z.array(z.string().min(1)).min(1),
  allowedChangedFiles: z.array(RelativePathSchema),
  expectedRecords: z.array(ExpectedRecordSchema),
  requiredChallengerVerdict: z.enum(["CONFIRM", "REJECT", "ESCALATE"]),
  acceptableReviewRequests: z.array(ReviewRequestSchema),
  expectedRetryPlan: LegacyRetryPlanSchema.nullable(),
  expectedCommandExitCodes: z.record(z.string(), z.number().int()),
  hiddenProbePath: RelativePathSchema.nullable(),
}).strict();

export const RequiredRecordPropertySchema = z.object({
  file: RelativePathSchema,
  recordId: z.string().min(1),
  properties: z.record(z.string(), z.json()).refine((value) => Object.keys(value).length > 0, {
    message: "At least one required property is needed",
  }),
}).strict();

export const PreservedRecordPropertySchema = z.object({
  file: RelativePathSchema,
  recordId: z.string().min(1),
  propertyPaths: z.array(
    z.string().regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/),
  ).min(1),
}).strict();

export const RetryWindowSchema = z.object({
  earliestNotBefore: TimestampSchema,
  latestNotBefore: TimestampSchema,
  minimumAttempts: z.number().int().positive(),
  maximumAttempts: z.number().int().positive(),
  latestEscalationAttempt: z.number().int().positive(),
}).strict().superRefine((window, ctx) => {
  if (new Date(window.earliestNotBefore).getTime() > new Date(window.latestNotBefore).getTime()) {
    ctx.addIssue({ code: "custom", message: "Retry window cannot end before it begins" });
  }
  if (window.minimumAttempts > window.maximumAttempts) {
    ctx.addIssue({ code: "custom", message: "Minimum attempts cannot exceed maximum attempts" });
  }
  if (window.latestEscalationAttempt > window.maximumAttempts) {
    ctx.addIssue({ code: "custom", message: "Latest escalation cannot exceed maximum attempts" });
  }
});

export const ReviewRequirementsSchema = z.object({
  subjectId: z.string().min(1),
  acceptableTargetEvidenceIds: z.array(z.string().min(1)).min(1),
  requiredFactPaths: z.array(z.string().regex(/^facts(?:\.[A-Za-z0-9_-]+)+$/)).min(1),
}).strict();

const OracleV4Common = {
  schemaVersion: z.literal(3),
  caseId: z.string().min(1),
  requiredEvidenceSourceBundles: z.array(z.array(z.string().min(1)).min(1)).min(1),
  forbiddenEvidenceClaims: z.array(EvidenceAssessmentSchema),
  allowedChangedFiles: z.array(RelativePathSchema),
  expectedCommandExitCodes: z.record(z.string(), z.number().int()),
  hiddenProbePath: RelativePathSchema.nullable(),
} as const;

const UpdateDataOracleV4Schema = z.object({
  ...OracleV4Common,
  expectedAction: z.literal("UPDATE_DATA"),
  requiredRecordProperties: z.array(RequiredRecordPropertySchema).min(1),
  preservedRecordProperties: z.array(PreservedRecordPropertySchema).min(1),
}).strict();

const RepairAdapterOracleV4Schema = z.object({
  ...OracleV4Common,
  expectedAction: z.literal("REPAIR_ADAPTER"),
  requiredPublicCommands: z.array(z.string().min(1)),
  requiresHiddenProbe: z.boolean(),
}).strict();

const RetryLaterOracleV4Schema = z.object({
  ...OracleV4Common,
  expectedAction: z.literal("RETRY_LATER"),
  retryWindow: RetryWindowSchema,
  requiredPreserveRecordIds: z.array(z.string().min(1)),
  requiredFutureConditions: z.array(FutureConditionSchema).min(1),
  satisfyingObservations: z.array(SourceObservationSchema).min(1),
  nearMissObservationFixtures: z.array(z.object({
    id: z.string().min(1),
    observations: z.array(SourceObservationSchema).min(1),
  }).strict()).min(1),
}).strict();

const NoActionOracleV4Schema = z.object({
  ...OracleV4Common,
  expectedAction: z.literal("NO_ACTION"),
  requiredAuthoritySources: z.array(z.string().min(1)).min(1),
}).strict();

const HumanReviewOracleV4Schema = z.object({
  ...OracleV4Common,
  expectedAction: z.literal("HUMAN_REVIEW"),
  reviewRequirements: ReviewRequirementsSchema,
}).strict();

export const CaseOracleV4Schema = z.discriminatedUnion("expectedAction", [
  UpdateDataOracleV4Schema,
  RepairAdapterOracleV4Schema,
  RetryLaterOracleV4Schema,
  NoActionOracleV4Schema,
  HumanReviewOracleV4Schema,
]);

const TokenUsageSchema = z.object({
  input: z.number().int().nonnegative(),
  cachedInput: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
}).strict().refine((usage) => usage.cachedInput <= usage.input, {
  message: "Cached input must be a subset of input tokens",
});

const ProxyRequestCoverageSchema = z.object({
  requestCount: z.number().int().nonnegative(),
  accountedRequestCount: z.number().int().nonnegative(),
  complete: z.boolean(),
}).strict().superRefine((coverage, ctx) => {
  if (coverage.accountedRequestCount > coverage.requestCount) {
    ctx.addIssue({ code: "custom", message: "Accounted requests cannot exceed successful requests" });
  }
  if (coverage.complete !== (coverage.requestCount > 0 && coverage.accountedRequestCount === coverage.requestCount)) {
    ctx.addIssue({ code: "custom", message: "Proxy request coverage completeness is inconsistent" });
  }
});

const TokenUsageSessionSchema = z.object({
  role: z.enum(["baseline", "maintainer", "challenger", "reviser"]),
  usage: TokenUsageSchema.nullable(),
  source: z.enum(["PROXY_REQUEST_SUM", "TRAJECTORY_TURN_COMPLETED", "UNAVAILABLE"]),
  trajectoryPath: RelativePathSchema,
  proxyLedgerPath: RelativePathSchema.nullable(),
  trajectoryAggregateCaptured: z.boolean(),
  proxyRequestCoverage: ProxyRequestCoverageSchema,
}).strict().superRefine((session, ctx) => {
  if ((session.source === "UNAVAILABLE") !== (session.usage === null)) {
    ctx.addIssue({ code: "custom", message: "Unavailable sessions must have null usage and vice versa" });
  }
  if (session.source === "TRAJECTORY_TURN_COMPLETED" && !session.trajectoryAggregateCaptured) {
    ctx.addIssue({ code: "custom", message: "Trajectory-derived usage requires a terminal aggregate" });
  }
  if (session.source === "PROXY_REQUEST_SUM" && !session.proxyRequestCoverage.complete) {
    ctx.addIssue({ code: "custom", message: "Proxy-derived usage requires complete proxy request coverage" });
  }
});

const TokenUsageAccountingSchema = z.object({
  sessions: z.array(TokenUsageSessionSchema).min(1),
  sessionCoverage: z.object({
    sessionCount: z.number().int().positive(),
    accountedSessionCount: z.number().int().nonnegative(),
    complete: z.boolean(),
  }).strict(),
  proxyRequestCoverage: ProxyRequestCoverageSchema,
  aggregateSource: z.enum(["PROXY", "TRAJECTORY", "MIXED", "UNAVAILABLE"]),
}).strict().superRefine((accounting, ctx) => {
  const roles = accounting.sessions.map((session) => session.role);
  if (new Set(roles).size !== roles.length) {
    ctx.addIssue({ code: "custom", message: "Token usage session roles must be unique" });
  }
  const accountedSessions = accounting.sessions.filter((session) => session.usage !== null).length;
  const sessionComplete = accountedSessions === accounting.sessions.length;
  if (
    accounting.sessionCoverage.sessionCount !== accounting.sessions.length ||
    accounting.sessionCoverage.accountedSessionCount !== accountedSessions ||
    accounting.sessionCoverage.complete !== sessionComplete
  ) {
    ctx.addIssue({ code: "custom", message: "Session coverage does not match the session records" });
  }
  const proxyRequests = accounting.sessions.reduce(
    (sum, session) => sum + session.proxyRequestCoverage.requestCount,
    0,
  );
  const proxyAccounted = accounting.sessions.reduce(
    (sum, session) => sum + session.proxyRequestCoverage.accountedRequestCount,
    0,
  );
  if (
    accounting.proxyRequestCoverage.requestCount !== proxyRequests ||
    accounting.proxyRequestCoverage.accountedRequestCount !== proxyAccounted ||
    accounting.proxyRequestCoverage.complete !== (proxyRequests > 0 && proxyAccounted === proxyRequests)
  ) {
    ctx.addIssue({ code: "custom", message: "Aggregate proxy request coverage does not match the sessions" });
  }
  const sources = new Set(accounting.sessions.map((session) => session.source));
  const expectedSource = !sessionComplete
    ? "UNAVAILABLE"
    : sources.size === 1 && sources.has("PROXY_REQUEST_SUM")
      ? "PROXY"
      : sources.size === 1 && sources.has("TRAJECTORY_TURN_COMPLETED")
        ? "TRAJECTORY"
        : "MIXED";
  if (accounting.aggregateSource !== expectedSource) {
    ctx.addIssue({ code: "custom", message: "Aggregate token source does not match the sessions" });
  }
});

export const RunManifestSchema = z.object({
  schemaVersion: z.literal(2),
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
  proxyLedgerPaths: z.array(RelativePathSchema),
  artifactSha256: z.record(z.string(), Sha256Schema),
  tokenUsage: TokenUsageSchema.nullable(),
  tokenUsageAccounting: TokenUsageAccountingSchema.nullable(),
  runtimeImages: z.array(z.object({
    role: z.enum(["baseline", "maintainer", "challenger", "reviser"]),
    imageId: Sha256Schema,
  }).strict()).nullable(),
  outcome: z.enum(["PASS", "FAIL", "ERROR"]),
}).strict().superRefine((manifest, ctx) => {
  if (manifest.tokenUsageAccounting === null) {
    if (manifest.tokenUsage !== null) {
      ctx.addIssue({ code: "custom", message: "Token usage requires accounting provenance" });
    }
    return;
  }
  const accounting = manifest.tokenUsageAccounting;
  const expectedRoles = manifest.arm === "baseline"
    ? ["baseline"]
    : ["maintainer", "challenger", "reviser"];
  const actualRoles = accounting.sessions.map((session) => session.role).sort();
  if (JSON.stringify(actualRoles) !== JSON.stringify([...expectedRoles].sort())) {
    ctx.addIssue({ code: "custom", message: "Token usage session roles do not match the run arm" });
  }
  const sessionTrajectories = accounting.sessions.map((session) => session.trajectoryPath).sort();
  if (JSON.stringify(sessionTrajectories) !== JSON.stringify([...manifest.trajectoryPaths].sort())) {
    ctx.addIssue({ code: "custom", message: "Token usage trajectories do not match the manifest" });
  }
  const sessionLedgers = accounting.sessions
    .map((session) => session.proxyLedgerPath)
    .filter((path): path is string => path !== null)
    .sort();
  if (JSON.stringify(sessionLedgers) !== JSON.stringify([...manifest.proxyLedgerPaths].sort())) {
    ctx.addIssue({ code: "custom", message: "Token usage proxy ledgers do not match the manifest" });
  }
  const complete = accounting.sessionCoverage.complete;
  if (!complete && manifest.tokenUsage !== null) {
    ctx.addIssue({ code: "custom", message: "Incomplete session accounting requires null aggregate usage" });
  }
  if (complete) {
    const expected = accounting.sessions.reduce(
      (sum, session) => ({
        input: sum.input + session.usage!.input,
        cachedInput: sum.cachedInput + session.usage!.cachedInput,
        output: sum.output + session.usage!.output,
      }),
      { input: 0, cachedInput: 0, output: 0 },
    );
    if (manifest.tokenUsage === null || JSON.stringify(manifest.tokenUsage) !== JSON.stringify(expected)) {
      ctx.addIssue({ code: "custom", message: "Aggregate token usage does not equal the session totals" });
    }
  }
});

export type ActionClass = z.infer<typeof ActionClassSchema>;
export type CaseManifest = z.infer<typeof CaseManifestSchema>;
export type SourceObservation = z.infer<typeof SourceObservationSchema>;
export type Policy = z.infer<typeof PolicySchema>;
export type AuthorityValidity = z.infer<typeof AuthorityValiditySchema>;
export type PolicyV4 = z.infer<typeof PolicyV4Schema>;
export type EvidenceEvent = z.infer<typeof EvidenceEventSchema>;
export type MutationOperation = z.infer<typeof MutationOperationSchema>;
export type EvidenceAssessment = z.infer<typeof EvidenceAssessmentSchema>;
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;
export type ObservationSelector = z.infer<typeof ObservationSelectorSchema>;
export type FutureCondition = z.infer<typeof FutureConditionSchema>;
export type LegacyRetryPlan = z.infer<typeof LegacyRetryPlanSchema>;
export type RetryPlan = z.infer<typeof RetryPlanSchema>;
export type MaintainerProposal = z.infer<typeof MaintainerProposalSchema>;
export type DecisionPackage = z.infer<typeof DecisionPackageSchema>;
export type ChallengerVerdict = z.infer<typeof ChallengerVerdictSchema>;
export type ChallengerCritique = z.infer<typeof ChallengerCritiqueSchema>;
export type CheckResult = z.infer<typeof CheckResultSchema>;
export type BaselineResult = z.infer<typeof BaselineResultSchema>;
export type CaseOracle = z.infer<typeof CaseOracleSchema>;
export type CaseOracleV4 = z.infer<typeof CaseOracleV4Schema>;
export type RunManifest = z.infer<typeof RunManifestSchema>;

export { RelativePathSchema, Sha256Schema, TimestampSchema };
