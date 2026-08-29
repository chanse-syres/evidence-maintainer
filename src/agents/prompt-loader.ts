import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const PROMPT_NAMES = new Set(["baseline", "maintainer", "challenger", "revision"]);

export async function loadPrompt(name: string, variables: Record<string, string>): Promise<string> {
  if (!PROMPT_NAMES.has(name)) {
    throw new Error(`Unknown prompt: ${name}`);
  }
  let content = await readFile(resolve("prompts", `${name}.md`), "utf8");
  content = content.replace(/\{\{([A-Z_]+)\}\}/g, (match, key: string) =>
    Object.hasOwn(variables, key) ? variables[key] : match,
  );
  const unresolved = [...content.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((match) => match[1]);
  if (unresolved.length > 0) {
    throw new Error(`Unresolved prompt variable(s): ${[...new Set(unresolved)].join(", ")}`);
  }
  return content;
}
