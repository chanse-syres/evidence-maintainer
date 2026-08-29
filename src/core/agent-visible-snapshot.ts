import { readFile } from "node:fs/promises";
import { join } from "node:path";

function toWorkspaceRelativePath(declaredPath: string): string {
  const normalized = declaredPath.replaceAll("\\", "/");
  if (!normalized.startsWith("workspace/")) {
    throw new Error(`Agent-visible path must start with workspace/: ${declaredPath}`);
  }
  const relativePath = normalized.slice("workspace/".length);
  const segments = relativePath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`Invalid agent-visible path: ${declaredPath}`);
  }
  return relativePath;
}

export async function readAgentVisibleSnapshot(
  workspace: string,
  declaredPaths: readonly string[],
): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const declaredPath of [...declaredPaths].sort()) {
    const relativePath = toWorkspaceRelativePath(declaredPath);
    snapshot[relativePath] = await readFile(
      join(workspace, ...relativePath.split("/")),
      "utf8",
    );
  }
  return snapshot;
}
