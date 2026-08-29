import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("engine verification fails when generated schemas drift", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };
  const command = packageJson.scripts?.["engine:verify"] ?? "";
  assert.match(command, /npm run schemas/);
  assert.match(command, /git diff --exit-code -- schemas/);
  assert.ok(
    command.indexOf("npm run schemas") < command.indexOf("git diff --exit-code -- schemas"),
    "schema drift must be checked after generation",
  );
});
