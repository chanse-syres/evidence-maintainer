export type FactPathResult =
  | { found: true; value: unknown }
  | { found: false };

export function readFactPath(value: unknown, path: string): FactPathResult {
  const segments = path.split(".");
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    return { found: false };
  }

  let current: unknown = value;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") {
      return { found: false };
    }
    if (!Object.hasOwn(current, segment)) {
      return { found: false };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: true, value: current };
}
