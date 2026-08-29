import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { extractAthletes } from "./adapter.ts";

test("old fixture remains supported", () => assert.deepEqual(extractAthletes(readFileSync("fixtures/old.html", "utf8")), [{ id: "p-1", name: "Alex North" }]));
test("new fixture uses the stable semantic athlete ID", () => assert.deepEqual(extractAthletes(readFileSync("fixtures/new.html", "utf8")), [{ id: "p-2", name: "Sam West" }]));
