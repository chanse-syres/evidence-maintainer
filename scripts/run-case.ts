import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CodexRunner } from "../src/agents/codex-runner.ts";
import { RecordedRunner } from "../src/agents/recorded-runner.ts";
import { runBaseline } from "../src/workflows/baseline.ts";

interface CliOptions {
  caseId: string;
  arm: "baseline" | "advanced";
  mode: "recorded" | "live";
  model: string;
  timeoutMs: number;
  approve: boolean;
  out: string;
}

export function parseRunCaseArgs(args: string[]): CliOptions {
  const values: Record<string, string> = {};
  let approve = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--approve") {
      approve = true;
      continue;
    }
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    if (!["case", "arm", "mode", "model", "timeout-ms", "out"].includes(name)) {
      throw new Error(`Unknown argument: ${token}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    values[name] = value;
    index += 1;
  }
  const caseId = values.case;
  const arm = values.arm;
  const mode = values.mode;
  const out = values.out;
  if (!caseId || !out || !["baseline", "advanced"].includes(arm) || !["recorded", "live"].includes(mode)) {
    throw new Error("Required: --case, --arm baseline|advanced, --mode recorded|live, and --out");
  }
  if (mode === "live" && !values.model) throw new Error("Live mode requires --model");
  const timeoutMs = Number(values["timeout-ms"] ?? "300000");
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error("--timeout-ms must be a positive integer");
  return {
    caseId,
    arm: arm as CliOptions["arm"],
    mode: mode as CliOptions["mode"],
    model: values.model ?? "recorded-fixture",
    timeoutMs,
    approve,
    out,
  };
}

export async function runCaseCli(args: string[]): Promise<void> {
  const options = parseRunCaseArgs(args);
  if (options.arm === "advanced") {
    throw new Error("Advanced arm is added in the next implementation task");
  }
  const runner = options.mode === "recorded"
    ? new RecordedRunner(resolve("artifacts", "recorded", "runner-fixtures.json"))
    : new CodexRunner();
  const manifest = await runBaseline({
    caseDir: resolve("cases", options.caseId),
    runRoot: resolve(options.out),
    runner,
    model: options.model,
    timeoutMs: options.timeoutMs,
    approve: options.approve,
  });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await runCaseCli(process.argv.slice(2));
}
