import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  CaseManifestSchema,
  CheckResultSchema,
  DecisionPackageSchema,
  EvidenceEventSchema,
  RunManifestSchema,
  type CaseManifest,
  type CheckResult,
  type DecisionPackage,
  type EvidenceEvent,
  type RunManifest,
} from "../core/schemas.ts";
import { diffTrees, type TreeSnapshot } from "../core/tree-snapshot.ts";

const TreeDiffSchema = z.object({
  added: z.array(z.string()),
  removed: z.array(z.string()),
  modified: z.array(z.string()),
}).strict();

const GateSchema = z.object({
  status: z.enum(["PASS", "FAIL"]),
  checks: z.array(CheckResultSchema),
  changedFiles: z.array(z.string()),
  diff: TreeDiffSchema,
}).strict();

const TreeSnapshotSchema = z.object({
  files: z.array(z.object({
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().nonnegative(),
  }).strict()),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const ApprovalSchema = z.object({
  schemaVersion: z.literal(1),
  caseId: z.string().min(1),
  requested: z.boolean(),
  eligible: z.boolean(),
  decision: z.enum(["APPROVED", "WITHHELD", "NOT_REQUESTED"]),
  reason: z.string().min(1),
  recordedAt: z.string().min(1),
}).strict();

export type TreeDiff = z.infer<typeof TreeDiffSchema>;
export type GateArtifact = z.infer<typeof GateSchema>;
export type ApprovalArtifact = z.infer<typeof ApprovalSchema>;

export interface RunArtifacts {
  runDir: string;
  manifest: RunManifest;
  caseManifest: CaseManifest;
  evidence: EvidenceEvent[];
  decision: DecisionPackage;
  gate: GateArtifact;
  beforeTree: TreeSnapshot;
  afterTree: TreeSnapshot;
  diff: TreeDiff;
  approval: ApprovalArtifact;
}

async function requiredText(runDir: string, relativePath: string): Promise<string> {
  const path = join(runDir, relativePath);
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Missing required artifact ${path}`);
    }
    throw error;
  }
}

async function requiredJson<T>(
  runDir: string,
  relativePath: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const text = await requiredText(runDir, relativePath);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in required artifact ${join(runDir, relativePath)}`, {
      cause: error,
    });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid required artifact ${join(runDir, relativePath)}: ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

async function requiredJsonLines<T>(
  runDir: string,
  relativePath: string,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const text = await requiredText(runDir, relativePath);
  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines.map((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `Invalid JSONL in required artifact ${join(runDir, relativePath)} line ${index + 1}`,
        { cause: error },
      );
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `Invalid required artifact ${join(runDir, relativePath)} line ${index + 1}: ${z.prettifyError(parsed.error)}`,
      );
    }
    return parsed.data;
  });
}

async function optionalJsonLines<T>(
  runDir: string,
  relativePath: string,
  schema: z.ZodType<T>,
): Promise<T[]> {
  try {
    return await requiredJsonLines(runDir, relativePath, schema);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === `Missing required artifact ${join(runDir, relativePath)}`
    ) {
      return [];
    }
    throw error;
  }
}

export async function loadRunArtifacts(runDir: string): Promise<RunArtifacts> {
  const manifest = await requiredJson(runDir, "manifest.json", RunManifestSchema);
  const [caseManifest, evidence, decision, gate, beforeTree, afterTree, approval] =
    await Promise.all([
      requiredJson(runDir, "workspace/case.json", CaseManifestSchema),
      manifest.arm === "advanced"
        ? requiredJsonLines(runDir, "evidence.jsonl", EvidenceEventSchema)
        : optionalJsonLines(runDir, "evidence.jsonl", EvidenceEventSchema),
      requiredJson(runDir, "final-decision.json", DecisionPackageSchema),
      requiredJson(runDir, "gate.json", GateSchema),
      requiredJson(runDir, "before-tree.json", TreeSnapshotSchema),
      requiredJson(runDir, "after-tree.json", TreeSnapshotSchema),
      requiredJson(runDir, "approval.json", ApprovalSchema),
    ]);
  if (
    manifest.caseId !== caseManifest.id ||
    manifest.caseId !== decision.caseId ||
    manifest.caseId !== approval.caseId
  ) {
    throw new Error(`Run artifact case IDs do not agree in ${runDir}`);
  }
  const diff = diffTrees(beforeTree, afterTree);
  if (JSON.stringify(diff) !== JSON.stringify(gate.diff)) {
    throw new Error(`Gate diff does not match the before/after snapshots in ${runDir}`);
  }

  return {
    runDir,
    manifest,
    caseManifest,
    evidence: [...evidence].sort((left, right) => left.seq - right.seq),
    decision,
    gate,
    beforeTree,
    afterTree,
    diff,
    approval,
  };
}

export type { CheckResult };
