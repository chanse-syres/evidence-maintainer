import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { collectPages, type Page } from "./adapter.ts";
const load = (name: string) => JSON.parse(readFileSync(name, "utf8")) as Record<string, Page>;
test("old numeric fixture remains supported", () => { const pages = load("fixtures/old.json"); assert.deepEqual(collectPages((key) => pages[key], "1"), ["a", "b", "c"]); });
test("new opaque continuation tokens are followed", () => { const pages = load("fixtures/new.json"); assert.deepEqual(collectPages((key) => pages[key], "start"), ["d", "e", "f"]); });
