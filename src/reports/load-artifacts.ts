import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  CaseManifestSchema,
  ChallengerVerdictSchema,
  CheckResultSchema,
  EvidenceEventSchema,
  MaintainerProposalSchema,
  RunManifestSchema,
  type CaseManifest,
  type ChallengerVerdict,
  type CheckResult,
  type EvidenceEvent,
  type MaintainerProposal,
  type RunManifest,
} from "../core/schemas.ts";

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
  proposal: MaintainerProposal;
  challenger: ChallengerVerdict;
  gate: GateArtifact;
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

export async function loadRunArtifacts(runDir: string): Promise<RunArtifacts> {
  const [manifest, caseManifest, evidence, proposal, challenger, gate, diff, approval] =
    await Promise.all([
      requiredJson(runDir, "manifest.json", RunManifestSchema),
      requiredJson(runDir, "workspace/case.json", CaseManifestSchema),
      requiredJsonLines(runDir, "evidence.jsonl", EvidenceEventSchema),
      requiredJson(runDir, "maintainer-proposal.json", MaintainerProposalSchema),
      requiredJson(runDir, "challenger-verdict.json", ChallengerVerdictSchema),
      requiredJson(runDir, "gate.json", GateSchema),
      requiredJson(runDir, "candidate-diff.json", TreeDiffSchema),
      requiredJson(runDir, "approval.json", ApprovalSchema),
    ]);

  return {
    runDir,
    manifest,
    caseManifest,
    evidence: [...evidence].sort((left, right) => left.seq - right.seq),
    proposal,
    challenger,
    gate,
    diff,
    approval,
  };
}

export type { CheckResult };
