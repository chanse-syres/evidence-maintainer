import { readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const PUBLIC_ROOT_FILES = ["README.md", "AGENTS.md"] as const;
const PUBLIC_DIRECTORIES = ["docs", "prompts"] as const;
const TEXT_EXTENSIONS = new Set([".md", ".txt"]);
const LOCAL_PATH = /(?:(?<![A-Za-z])[A-Za-z]:[\\/]|\/(?:Users|home)\/)/i;
const CREDENTIAL_CONTENT = /(?:sk_[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/;

function normalizedRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function isTextFile(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && TEXT_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

async function collectTextFiles(path: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) files.push(...await collectTextFiles(child));
    else if (entry.isFile() && isTextFile(child)) files.push(child);
  }
  return files;
}

export async function verifyPublicTree(root: string): Promise<{
  scannedTextFiles: number;
  forbiddenInternalFiles: string[];
}> {
  const files: string[] = [];
  for (const name of PUBLIC_ROOT_FILES) {
    const path = resolve(root, name);
    try {
      await readFile(path, "utf8");
      files.push(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  for (const directory of PUBLIC_DIRECTORIES) {
    files.push(...await collectTextFiles(resolve(root, directory)));
  }

  const uniqueFiles = [...new Set(files)].sort();
  const forbiddenInternalFiles = uniqueFiles
    .map((path) => normalizedRelative(root, path))
    .filter((path) => path.startsWith("docs/superpowers/"));
  if (forbiddenInternalFiles.length > 0) {
    throw new Error(`Forbidden internal release file: ${forbiddenInternalFiles[0]}`);
  }

  for (const path of uniqueFiles) {
    const text = await readFile(path, "utf8");
    const displayPath = normalizedRelative(root, path);
    if (LOCAL_PATH.test(text)) {
      throw new Error(`Public text contains a machine-local path: ${displayPath}`);
    }
    if (CREDENTIAL_CONTENT.test(text)) {
      throw new Error(`Public text contains credential-like content: ${displayPath}`);
    }
  }

  return {
    scannedTextFiles: uniqueFiles.length,
    forbiddenInternalFiles,
  };
}
