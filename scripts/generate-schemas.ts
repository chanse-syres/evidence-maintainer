import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  BaselineResultSchema,
  ChallengerVerdictSchema,
  MaintainerProposalSchema,
} from "../src/core/schemas.ts";
import { sha256Text } from "../src/core/canonical-json.ts";

const PUBLIC_SCHEMAS = {
  "baseline-result.schema.json": BaselineResultSchema,
  "maintainer-proposal.schema.json": MaintainerProposalSchema,
  "challenger-verdict.schema.json": ChallengerVerdictSchema,
} as const;

function codexCompatibleSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(codexCompatibleSchema);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "propertyNames")
      .map(([key, entry]) => [key === "oneOf" ? "anyOf" : key, codexCompatibleSchema(entry)]),
  );
}

export async function writeSchemas(directory = resolve("schemas")): Promise<Record<string, string>> {
  await mkdir(directory, { recursive: true });
  const hashes: Record<string, string> = {};
  for (const [name, schema] of Object.entries(PUBLIC_SCHEMAS)) {
    const generated = codexCompatibleSchema(
      z.toJSONSchema(schema, { target: "draft-2020-12" }),
    ) as Record<string, unknown>;
    const document = {
      ...generated,
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: name.replace(".schema.json", ""),
    };
    const serialized = `${JSON.stringify(document, null, 2)}\n`;
    await writeFile(resolve(directory, name), serialized, "utf8");
    hashes[name] = sha256Text(serialized);
  }
  return hashes;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const hashes = await writeSchemas();
  for (const [name, hash] of Object.entries(hashes)) {
    process.stdout.write(`${name} ${hash}\n`);
  }
}
