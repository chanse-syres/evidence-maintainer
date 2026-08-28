import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  MutationOperationSchema,
  type MutationOperation,
} from "./schemas.ts";

function containedPath(workspace: string, requested: string): string {
  if (isAbsolute(requested) || requested.includes("\\") || /^[A-Za-z]:/.test(requested)) {
    throw new Error(`Unsafe normalized relative path: ${requested}`);
  }
  const segments = requested.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Unsafe relative path: ${requested}`);
  }
  const root = resolve(workspace);
  const target = resolve(root, ...segments);
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path escapes workspace: ${requested}`);
  }
  return target;
}

async function assertRegularFile(path: string): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Mutation target is not a regular file: ${path}`);
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = resolve(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

function countOccurrences(content: string, needle: string): number {
  let count = 0;
  let cursor = 0;
  while (true) {
    const index = content.indexOf(needle, cursor);
    if (index < 0) {
      return count;
    }
    count += 1;
    cursor = index + needle.length;
  }
}

export async function applyOperations(workspace: string, operations: readonly MutationOperation[]): Promise<void> {
  for (const rawOperation of operations) {
    const operation = MutationOperationSchema.parse(rawOperation);
    if (operation.kind === "NO_MUTATION") {
      continue;
    }
    const path = containedPath(workspace, operation.file);
    await assertRegularFile(path);

    if (operation.kind === "REPLACE_TEXT") {
      const original = await readFile(path, "utf8");
      const actualCount = countOccurrences(original, operation.find);
      if (actualCount !== operation.expectedCount) {
        throw new Error(
          `Expected ${operation.expectedCount} replacement target(s) in ${operation.file}, found ${actualCount}`,
        );
      }
      await atomicWrite(path, original.split(operation.find).join(operation.replace));
      continue;
    }

    if (Object.hasOwn(operation.fields, "id")) {
      throw new Error("Stable record identity cannot be mutated");
    }
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(parsed)) {
      throw new Error(`SET_RECORD_FIELDS requires an array JSON root: ${operation.file}`);
    }
    const matches = parsed.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null && !Array.isArray(entry) && entry.id === operation.recordId,
    );
    if (matches.length > 1) {
      throw new Error(`Duplicate record ID ${operation.recordId} in ${operation.file}`);
    }
    if (matches.length === 0) {
      throw new Error(`Record ${operation.recordId} not found in ${operation.file}`);
    }
    Object.assign(matches[0], operation.fields);
    await atomicWrite(path, `${JSON.stringify(parsed, null, 2)}\n`);
  }
}
