import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createDockerCommandArgs,
  createHiddenProbeDockerArgs,
  parseRequiredCommand,
  runHiddenProbeIsolated,
  validateNodeTestResult,
} from "../src/core/isolated-command-runner.ts";

test("required commands are parsed from a narrow allowlist", () => {
  assert.deepEqual(
    parseRequiredCommand("node --experimental-strip-types --test adapter.test.ts"),
    ["node", "--experimental-strip-types", "--test", "adapter.test.ts"],
  );
  assert.throws(() => parseRequiredCommand("node adapter.test.ts && curl https://example.com"));
  assert.throws(() => parseRequiredCommand("powershell -File adapter.test.ts"));
});

test("Docker command execution has no network, secrets, host repo, or writable workspace", () => {
  const args = createDockerCommandArgs(
    "C:\\isolated\\case-workspace",
    "node --experimental-strip-types --test adapter.test.ts",
    "evidence-maintainer-test-123",
  );
  assert.ok(args.includes("none"));
  assert.ok(args.includes("--read-only"));
  assert.ok(args.includes("ALL"));
  assert.ok(args.includes("no-new-privileges"));
  assert.ok(args.includes("type=bind,source=C:\\isolated\\case-workspace,target=/workspace,readonly"));
  assert.equal(args.some((value) => value === "--env" || value === "-e"), false);
  assert.equal(args.some((value) => /oracle|artifacts|docker\.sock/i.test(value)), false);
});

test("hidden probes never mount verifier bytes into the candidate container", () => {
  const args = createHiddenProbeDockerArgs(
    "C:\\isolated\\case-workspace",
    "evidence-maintainer-hidden-123",
    "normalizeClosures",
  );
  assert.ok(args.includes("type=bind,source=C:\\isolated\\case-workspace,target=/workspace,readonly"));
  assert.equal(args.some((value) => /verifier|hidden-probes\.json/i.test(value)), false);
});

test("trusted hidden-probe expectations stay outside the candidate filesystem", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-hidden-probe-"));
  const workspace = join(root, "workspace");
  const privateDir = join(root, "private");
  await mkdir(workspace);
  await mkdir(privateDir);
  await writeFile(join(workspace, "adapter.ts"), `
import { existsSync } from "node:fs";
export function inspectProbe(value: string) {
  return { value, verifierVisible: existsSync("/verifier/hidden-probes.json") };
}
`, "utf8");
  const probePath = join(privateDir, "hidden-probes.json");
  await writeFile(probePath, JSON.stringify({
    schemaVersion: 1,
    exportName: "inspectProbe",
    cases: [{ id: "unseen-1", args: ["unseen-value"], expected: { value: "unseen-value", verifierVisible: false } }],
  }), "utf8");
  const result = await runHiddenProbeIsolated(workspace, probePath);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /pass 1/i);
});

test("a zero exit code still needs explicit passing Node test evidence", () => {
  assert.equal(validateNodeTestResult({ exitCode: 0, stdout: "# pass 2\n# fail 0\n", stderr: "" }).exitCode, 0);
  const empty = validateNodeTestResult({ exitCode: 0, stdout: "looks good\n", stderr: "" });
  assert.equal(empty.exitCode, 1);
  assert.match(empty.stderr, /missing trusted TAP completion evidence/i);
});
