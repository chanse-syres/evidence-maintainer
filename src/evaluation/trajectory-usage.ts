import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface TrajectoryUsage {
  input: number;
  cachedInput: number;
  output: number;
}

function usageFromEvent(value: unknown): TrajectoryUsage | null {
  if (!value || typeof value !== "object") return null;
  const usage = (value as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return null;
  const raw = usage as Record<string, unknown>;
  const input = raw.input_tokens;
  const cachedInput = raw.cached_input_tokens;
  const output = raw.output_tokens;
  if (
    typeof input !== "number" || !Number.isInteger(input) || input < 0 ||
    typeof cachedInput !== "number" || !Number.isInteger(cachedInput) || cachedInput < 0 ||
    typeof output !== "number" || !Number.isInteger(output) || output < 0 ||
    cachedInput > input
  ) return null;
  return { input, cachedInput, output };
}

export async function readTrajectoryUsage(path: string): Promise<TrajectoryUsage | null> {
  const lines = (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean);
  let latest: TrajectoryUsage | null = null;
  for (const line of lines) {
    try {
      latest = usageFromEvent(JSON.parse(line)) ?? latest;
    } catch {
      // Diagnostic text cannot contribute trusted usage.
    }
  }
  return latest;
}

export async function reconstructUsage(
  runPath: string,
  trajectoryPaths: readonly string[],
): Promise<TrajectoryUsage | null> {
  const usages: TrajectoryUsage[] = [];
  for (const trajectoryPath of trajectoryPaths) {
    const usage = await readTrajectoryUsage(join(runPath, ...trajectoryPath.split("/")));
    if (usage) usages.push(usage);
  }
  if (usages.length !== trajectoryPaths.length) return null;
  return {
    input: usages.reduce((sum, usage) => sum + usage.input, 0),
    cachedInput: usages.reduce((sum, usage) => sum + usage.cachedInput, 0),
    output: usages.reduce((sum, usage) => sum + usage.output, 0),
  };
}

export async function reconstructAvailableUsage(runPath: string): Promise<TrajectoryUsage | null> {
  const { readdir } = await import("node:fs/promises");
  const trajectoryDir = join(runPath, "trajectories");
  let entries;
  try {
    entries = await readdir(trajectoryDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const usages: TrajectoryUsage[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const usage = await readTrajectoryUsage(join(trajectoryDir, entry.name));
    if (usage) usages.push(usage);
  }
  if (usages.length === 0) return null;
  return {
    input: usages.reduce((sum, usage) => sum + usage.input, 0),
    cachedInput: usages.reduce((sum, usage) => sum + usage.cachedInput, 0),
    output: usages.reduce((sum, usage) => sum + usage.output, 0),
  };
}
