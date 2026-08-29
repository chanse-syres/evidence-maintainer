import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { verifyPublicTree } from "../src/release/public-tree.ts";

async function publicTree(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "evidence-public-tree-"));
  await mkdir(resolve(root, "docs"), { recursive: true });
  await mkdir(resolve(root, "prompts"), { recursive: true });
  await writeFile(resolve(root, "README.md"), "# Public project\n", "utf8");
  await writeFile(resolve(root, "docs", "evaluation.md"), "No live result selected.\n", "utf8");
  await writeFile(resolve(root, "prompts", "baseline.md"), "Return a decision package.\n", "utf8");
  return root;
}

test("public tree accepts clean release-facing text", async () => {
  const root = await publicTree();
  assert.deepEqual(await verifyPublicTree(root), {
    scannedTextFiles: 3,
    forbiddenInternalFiles: [],
  });
});

test("public tree rejects internal planning directories", async () => {
  const root = await publicTree();
  const planDir = resolve(root, "docs", "superpowers", "plans");
  await mkdir(planDir, { recursive: true });
  await writeFile(resolve(planDir, "release.md"), "Use C:\\Work\\private before push.\n", "utf8");
  await assert.rejects(verifyPublicTree(root), /Forbidden internal release file/);
});

test("public tree rejects machine-local paths in public documentation", async () => {
  const root = await publicTree();
  await writeFile(resolve(root, "docs", "evaluation.md"), "Read C:\\Users\\person\\secret.json.\n", "utf8");
  await assert.rejects(verifyPublicTree(root), /machine-local path/);
});

test("public tree rejects common live-secret forms", async () => {
  const root = await publicTree();
  await writeFile(resolve(root, "prompts", "baseline.md"), `token sk_${"a".repeat(40)}\n`, "utf8");
  await assert.rejects(verifyPublicTree(root), /credential-like content/);
});
