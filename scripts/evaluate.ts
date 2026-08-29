import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveCaseSelection, runEvaluation } from "../src/evaluation/run-evaluation.ts";

interface EvaluateOptions {
  caseRoot: string;
  cases: string;
  trials: number;
  mode: "live" | "recorded";
  model: string;
  timeoutMs: number;
  out: string;
}

export function parseEvaluateArgs(args: string[]): EvaluateOptions {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`Invalid evaluation argument near ${name ?? "end"}`);
    }
    const key = name.slice(2);
    if (!["case-root", "cases", "trials", "mode", "model", "timeout-ms", "out"].includes(key)) {
      throw new Error(`Unknown argument: ${name}`);
    }
    values[key] = value;
  }
  if (!values.cases || !values.out || !["live", "recorded"].includes(values.mode)) {
    throw new Error("Required: --cases, --mode live|recorded, and --out");
  }
  if (values.mode === "live" && !values.model) throw new Error("Live mode requires --model");
  const trials = Number(values.trials ?? "1");
  const timeoutMs = Number(values["timeout-ms"] ?? "300000");
  if (!Number.isInteger(trials) || trials <= 0) throw new Error("--trials must be a positive integer");
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error("--timeout-ms must be a positive integer");
  return {
    caseRoot: values["case-root"] ?? "cases",
    cases: values.cases,
    trials,
    mode: values.mode as EvaluateOptions["mode"],
    model: values.model ?? "recorded-fixture",
    timeoutMs,
    out: values.out,
  };
}

export async function evaluateCli(args: string[]): Promise<void> {
  const options = parseEvaluateArgs(args);
  const summary = await runEvaluation({
    caseIds: await resolveCaseSelection(options.cases, options.caseRoot),
    trials: options.trials,
    mode: options.mode,
    model: options.model,
    timeoutMs: options.timeoutMs,
    outDir: resolve(options.out),
    caseRoot: resolve(options.caseRoot),
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await evaluateCli(process.argv.slice(2));
}
