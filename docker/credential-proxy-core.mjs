import { createHash } from "node:crypto";

const route = "/backend-api/codex/responses";

function headerValue(headers, name) {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() !== target) continue;
    return Array.isArray(value) ? value.join(", ") : value;
  }
  return undefined;
}

export function fingerprintRequest(body) {
  return createHash("sha256").update(body).digest("hex");
}

export function validateIncomingRequest(input) {
  if (input.method !== "POST" || input.url !== route) {
    return { ok: false, status: 403, reason: "route_rejected" };
  }
  const contentEncoding = headerValue(input.headers, "content-encoding");
  if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
    return { ok: false, status: 415, reason: "encoded_body_rejected" };
  }
  let body;
  try {
    body = JSON.parse(input.body.toString("utf8"));
  } catch {
    return { ok: false, status: 400, reason: "malformed_json" };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, reason: "non_object_body" };
  }
  if (body.model !== input.allowedModel) {
    return { ok: false, status: 403, reason: "model_rejected" };
  }
  return { ok: true, body };
}

function normalizeUsage(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value.input_tokens ?? value.input;
  const cachedInput = value.cached_input_tokens ??
    value.cachedInput ??
    value.input_tokens_details?.cached_tokens ??
    0;
  const output = value.output_tokens ?? value.output;
  if (
    typeof input !== "number" || !Number.isFinite(input) || input < 0 ||
    typeof cachedInput !== "number" || !Number.isFinite(cachedInput) || cachedInput < 0 || cachedInput > input ||
    typeof output !== "number" || !Number.isFinite(output) || output < 0
  ) return null;
  return { input, cachedInput, output };
}

function collectUsage(value, output, seen = new Set()) {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  if (!Array.isArray(value) && Object.hasOwn(value, "usage")) {
    const normalized = normalizeUsage(value.usage);
    if (normalized) output.push(normalized);
  }
  for (const nested of Array.isArray(value) ? value : Object.values(value)) {
    collectUsage(nested, output, seen);
  }
}

export function extractResponseUsage(body, contentType = "") {
  const values = [];
  const text = body.toString("utf8");
  const normalizedContentType = contentType.toLowerCase();
  if (normalizedContentType.includes("text/event-stream")) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        values.push(JSON.parse(payload));
      } catch {
        continue;
      }
    }
  } else if (normalizedContentType.includes("ndjson") || normalizedContentType.includes("jsonl")) {
    for (const line of text.split(/\r?\n/)) {
      const payload = line.trim();
      if (!payload) continue;
      try {
        values.push(JSON.parse(payload));
      } catch {
        continue;
      }
    }
  } else {
    try {
      values.push(JSON.parse(text));
    } catch {
      return null;
    }
  }
  const usages = [];
  for (const value of values) collectUsage(value, usages);
  return usages.at(-1) ?? null;
}

export function extractUpstreamErrorDiagnostic(body, contentType = "") {
  if (!contentType.toLowerCase().includes("json")) return { type: "non_json_error" };
  try {
    const parsed = JSON.parse(body.toString("utf8"));
    const error = typeof parsed?.error === "object" && parsed.error !== null ? parsed.error : parsed;
    const diagnostic = {};
    for (const field of ["type", "code", "param"]) {
      if (typeof error?.[field] === "string" && error[field].length <= 120) {
        diagnostic[field] = error[field];
      }
    }
    return Object.keys(diagnostic).length > 0 ? diagnostic : { type: "unclassified_json_error" };
  } catch {
    return { type: "malformed_json_error" };
  }
}
