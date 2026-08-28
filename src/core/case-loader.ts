import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  CaseManifestSchema,
  CaseOracleSchema,
  PolicySchema,
  SourceObservationSchema,
  type CaseManifest,
  type CaseOracle,
  type Policy,
  type SourceObservation,
} from "./schemas.ts";
import { sha256Json, sha256Text } from "./canonical-json.ts";

export interface WorkspaceFile {
  path: string;
  sha256: string;
  bytes: number;
}

export interface LoadedPublicCase {
  caseDir: string;
  manifest: CaseManifest;
  canonical: unknown;
  observations: SourceObservation[];
  policy: Policy;
  workspaceFiles: WorkspaceFile[];
  workspaceHash: string;
}

function normalizeRelativePath(value: string): string {
  if (isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.includes("\\")) {
    throw new Error(`Unsafe absolute or non-normalized path: ${value}`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Unsafe relative path: ${value}`);
  }
  return segments.join("/");
}

async function resolveContained(root: string, relativePath: string): Promise<string> {
  const normalized = normalizeRelativePath(relativePath);
  const rootReal = await realpath(root);
  const target = resolve(rootReal, ...normalized.split("/"));
  const targetReal = await realpath(target);
  const inside = targetReal === rootReal || targetReal.startsWith(`${rootReal}${sep}`);
  if (!inside) {
    throw new Error(`Path escapes case directory: ${relativePath}`);
  }
  const stat = await lstat(target);
  if (stat.isSymbolicLink()) {
    throw new Error(`Symlink is not allowed: ${relativePath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`Expected regular file: ${relativePath}`);
  }
  return targetReal;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function loadPublicCase(caseDir: string): Promise<LoadedPublicCase> {
  const root = await realpath(caseDir);
  const caseJsonPath = await resolveContained(root, "case.json");
  const manifest = CaseManifestSchema.parse(await readJson(caseJsonPath));
  const visible = new Set(manifest.agentVisibleFiles);
  const provenanceByPath = new Map(manifest.provenance.map((entry) => [entry.path, entry]));
  if (provenanceByPath.size !== manifest.provenance.length) {
    throw new Error("Each provenance path must be unique");
  }
  for (const path of visible) {
    if (!provenanceByPath.has(path)) {
      throw new Error(`Missing provenance for ${path}`);
    }
  }
  for (const path of provenanceByPath.keys()) {
    if (!visible.has(path)) {
      throw new Error(`Provenance references non-visible file ${path}`);
    }
  }

  const workspaceFiles: WorkspaceFile[] = [];
  for (const relativePath of [...visible].sort()) {
    if (!relativePath.startsWith("workspace/")) {
      throw new Error(`Agent-visible file must be under workspace/: ${relativePath}`);
    }
    const fullPath = await resolveContained(root, relativePath);
    const bytes = await readFile(fullPath);
    const actualHash = sha256Text(bytes);
    const expectedHash = provenanceByPath.get(relativePath)?.sha256;
    if (actualHash !== expectedHash) {
      throw new Error(`Provenance hash mismatch for ${relativePath}`);
    }
    workspaceFiles.push({ path: relativePath.slice("workspace/".length), sha256: actualHash, bytes: bytes.length });
  }

  const canonicalPath = await resolveContained(root, "workspace/input/canonical.json");
  const observationsPath = await resolveContained(root, "workspace/input/observations.json");
  const policyPath = await resolveContained(root, "workspace/input/policy.json");
  const canonical = await readJson(canonicalPath);
  const observations = SourceObservationSchema.array().parse(await readJson(observationsPath));
  const policy = PolicySchema.parse(await readJson(policyPath));

  return {
    caseDir: root,
    manifest,
    canonical,
    observations,
    policy,
    workspaceFiles,
    workspaceHash: sha256Json(workspaceFiles),
  };
}

export async function loadOracle(caseDir: string): Promise<CaseOracle> {
  const root = await realpath(caseDir);
  const oraclePath = await resolveContained(root, "oracle.json");
  return CaseOracleSchema.parse(await readJson(oraclePath));
}

export async function copyCaseWorkspace(caseDir: string, runDir: string): Promise<string> {
  const loaded = await loadPublicCase(caseDir);
  await mkdir(runDir, { recursive: true });
  await copyFile(resolve(loaded.caseDir, "case.json"), resolve(runDir, "case.json"));
  for (const file of loaded.workspaceFiles) {
    const source = await resolveContained(loaded.caseDir, `workspace/${file.path}`);
    const destination = resolve(runDir, ...file.path.split("/"));
    const destinationRelative = relative(resolve(runDir), destination);
    if (destinationRelative.startsWith("..") || isAbsolute(destinationRelative)) {
      throw new Error(`Destination path escapes run directory: ${file.path}`);
    }
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  return resolve(runDir);
}
