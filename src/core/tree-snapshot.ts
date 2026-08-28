import { readdir, readFile, lstat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { sha256Json, sha256Text } from "./canonical-json.ts";

export interface TreeFile {
  path: string;
  sha256: string;
  bytes: number;
}

export interface TreeSnapshot {
  files: TreeFile[];
  sha256: string;
}

export interface TreeDiff {
  added: string[];
  removed: string[];
  modified: string[];
}

const EXCLUDED_DIRECTORIES = new Set([".git", ".next", "node_modules"]);

export async function snapshotTree(root: string): Promise<TreeSnapshot> {
  const absoluteRoot = resolve(root);
  const files: TreeFile[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const fullPath = join(directory, entry.name);
      const stat = await lstat(fullPath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Symlink is not allowed in snapshots: ${fullPath}`);
      }
      if (stat.isDirectory()) {
        await walk(fullPath);
      } else if (stat.isFile()) {
        const content = await readFile(fullPath);
        files.push({
          path: relative(absoluteRoot, fullPath).replaceAll("\\", "/"),
          sha256: sha256Text(content),
          bytes: content.length,
        });
      }
    }
  }

  await walk(absoluteRoot);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { files, sha256: sha256Json(files) };
}

export function diffTrees(before: TreeSnapshot, after: TreeSnapshot): TreeDiff {
  const beforeByPath = new Map(before.files.map((file) => [file.path, file]));
  const afterByPath = new Map(after.files.map((file) => [file.path, file]));
  const added = [...afterByPath.keys()].filter((path) => !beforeByPath.has(path)).sort();
  const removed = [...beforeByPath.keys()].filter((path) => !afterByPath.has(path)).sort();
  const modified = [...beforeByPath.keys()]
    .filter((path) => afterByPath.has(path) && beforeByPath.get(path)?.sha256 !== afterByPath.get(path)?.sha256)
    .sort();
  return { added, removed, modified };
}
