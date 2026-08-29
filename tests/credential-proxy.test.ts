import assert from "node:assert/strict";
import test from "node:test";
import {
  extractResponseUsage,
  extractUpstreamErrorDiagnostic,
  fingerprintRequest,
  validateIncomingRequest,
} from "../docker/credential-proxy-core.mjs";

const endpoint = "/backend-api/codex/responses";
const allowedModel = "gpt-5.6-terra";

function rejectionReason(result: ReturnType<typeof validateIncomingRequest>): string {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("Expected proxy request rejection");
  return result.reason;
}

test("credential proxy accepts only the exact route, encoding, JSON shape, and frozen model", () => {
  const validBody = Buffer.from(JSON.stringify({ model: allowedModel, input: "private prompt" }));
  assert.deepEqual(validateIncomingRequest({
    method: "POST",
    url: endpoint,
    headers: { "content-type": "application/json" },
    body: validBody,
    allowedModel,
  }), { ok: true, body: { model: allowedModel, input: "private prompt" } });

  assert.equal(rejectionReason(validateIncomingRequest({
    method: "GET", url: endpoint, headers: {}, body: Buffer.alloc(0), allowedModel,
  })), "route_rejected");
  assert.equal(rejectionReason(validateIncomingRequest({
    method: "POST", url: endpoint, headers: { "content-encoding": "gzip" }, body: validBody, allowedModel,
  })), "encoded_body_rejected");
  assert.equal(rejectionReason(validateIncomingRequest({
    method: "POST", url: endpoint, headers: {}, body: Buffer.from("not json"), allowedModel,
  })), "malformed_json");
  assert.equal(rejectionReason(validateIncomingRequest({
    method: "POST", url: endpoint, headers: {}, body: Buffer.from("[]"), allowedModel,
  })), "non_object_body");
  assert.equal(rejectionReason(validateIncomingRequest({
    method: "POST",
    url: endpoint,
    headers: {},
    body: Buffer.from(JSON.stringify({ model: "different-model" })),
    allowedModel,
  })), "model_rejected");
});

test("request fingerprints and receipts need not retain prompt bytes", () => {
  const body = Buffer.from(JSON.stringify({ model: allowedModel, input: "do-not-store-this" }));
  const fingerprint = fingerprintRequest(body);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(fingerprint, /do-not-store-this/);
});

test("proxy extracts complete usage from streamed response events", () => {
  const response = Buffer.from([
    'data: {"type":"response.created","response":{"id":"r1"}}',
    'data: {"type":"response.completed","response":{"usage":{"input_tokens":120,"input_tokens_details":{"cached_tokens":20},"output_tokens":30}}}',
    "data: [DONE]",
    "",
  ].join("\n"));
  assert.deepEqual(extractResponseUsage(response, "text/event-stream"), {
    input: 120,
    cachedInput: 20,
    output: 30,
  });
  assert.equal(extractResponseUsage(Buffer.from("not-json"), "text/plain"), null);
});

test("proxy extracts usage from Codex newline-delimited JSON", () => {
  const response = Buffer.from([
    JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
    JSON.stringify({ type: "turn.started" }),
    JSON.stringify({
      type: "turn.completed",
      usage: {
        input_tokens: 12_738,
        cached_input_tokens: 0,
        cache_write_input_tokens: 0,
        output_tokens: 330,
        reasoning_output_tokens: 116,
      },
    }),
    "",
  ].join("\n"));

  assert.deepEqual(extractResponseUsage(response, "application/x-ndjson"), {
    input: 12_738,
    cachedInput: 0,
    output: 330,
  });
});

test("upstream error diagnostics retain codes but not server messages", () => {
  const diagnostic = extractUpstreamErrorDiagnostic(Buffer.from(JSON.stringify({
    error: {
      type: "invalid_request_error",
      code: "unsupported_parameter",
      param: "reasoning.effort",
      message: "sensitive server message",
    },
  })), "application/json");
  assert.deepEqual(diagnostic, {
    type: "invalid_request_error",
    code: "unsupported_parameter",
    param: "reasoning.effort",
  });
  assert.equal(JSON.stringify(diagnostic).includes("sensitive"), false);
});
