import { createHash } from "node:crypto";

function normalize(value: unknown, active: WeakSet<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON rejects non-finite numbers");
    }
    return value;
  }
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    throw new TypeError(`Canonical JSON rejects ${typeof value}`);
  }
  if (typeof value !== "object") {
    throw new TypeError("Unsupported canonical JSON value");
  }
  if (active.has(value)) {
    throw new TypeError("Canonical JSON rejects cyclic values");
  }
  active.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => normalize(entry, active));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON accepts only arrays and plain objects");
    }
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      output[key] = normalize(source[key], active);
    }
    return output;
  } finally {
    active.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, new WeakSet<object>()));
}

export function sha256Text(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Json(value: unknown): string {
  return sha256Text(Buffer.from(canonicalJson(value), "utf8"));
}
