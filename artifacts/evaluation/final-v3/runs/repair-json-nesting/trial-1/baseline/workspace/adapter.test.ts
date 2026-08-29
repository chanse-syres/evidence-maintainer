import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { extractPlayers } from "./adapter.ts";
const load = (name: string) => JSON.parse(readFileSync(name, "utf8"));
test("old top-level payload remains supported", () => assert.deepEqual(extractPlayers(load("fixtures/old.json")), [{ id: "p-1", name: "Alex North" }]));
test("new semantic envelope is supported", () => assert.deepEqual(extractPlayers(load("fixtures/new.json")), [{ id: "p-2", name: "Sam West" }]));
