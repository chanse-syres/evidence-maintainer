import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  ChallengerCritiqueSchema,
  DecisionPackageOutputContractSchema,
} from "../src/core/schemas.ts";
import { sha256Text } from "../src/core/canonical-json.ts";

const PUBLIC_SCHEMAS = {
  "decision-package.schema.json": DecisionPackageOutputContractSchema,
  "challenger-critique.schema.json": ChallengerCritiqueSchema,
} as const;

function codexCompatibleSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(codexCompatibleSchema);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (
    record.type === "array" &&
    Array.isArray(record.prefixItems) &&
    record.prefixItems.length === 0 &&
    record.maxItems === 0
  ) {
    return Object.fromEntries(
      Object.entries({ ...record, items: { type: "string" } })
        .filter(([key]) => key !== "prefixItems" && key !== "propertyNames")
        .map(([key, entry]) => [key === "oneOf" ? "anyOf" : key, codexCompatibleSchema(entry)]),
    );
  }
  return Object.fromEntries(
    Object.entries(record)
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
