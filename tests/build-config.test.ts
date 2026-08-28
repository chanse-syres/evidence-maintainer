import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("generated run artifacts are excluded from application type checking", async () => {
  const config = JSON.parse(await readFile("tsconfig.json", "utf8")) as {
    exclude?: string[];
  };

  assert.ok(
    config.exclude?.includes("artifacts"),
    "tsconfig must exclude immutable evaluation artifacts, including intentionally failing baseline workspaces",
  );
});
