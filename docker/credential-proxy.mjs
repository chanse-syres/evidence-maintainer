import { randomUUID } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import {
  extractResponseUsage,
  extractUpstreamErrorDiagnostic,
  fingerprintRequest,
  validateIncomingRequest,
} from "./credential-proxy-core.mjs";

const authPath = process.env.CODEX_PROXY_AUTH_PATH ?? "/run/secrets/codex-auth.json";
const upstreamUrl = process.env.CODEX_PROXY_UPSTREAM ?? "https://chatgpt.com/backend-api/codex/responses";
const requestedPort = Number.parseInt(process.env.CODEX_PROXY_PORT ?? "8080", 10);
const maxRequests = Number.parseInt(process.env.CODEX_PROXY_MAX_REQUESTS ?? "12", 10);
const allowedModel = process.env.CODEX_PROXY_ALLOWED_MODEL;
const ledgerPath = process.env.CODEX_PROXY_LEDGER_PATH;
const maxBodyBytes = 24 * 1024 * 1024;
let requestCount = 0;
let sequence = 0;

if (!allowedModel) throw new Error("CODEX_PROXY_ALLOWED_MODEL is required");
if (!ledgerPath) throw new Error("CODEX_PROXY_LEDGER_PATH is required");

async function writeReceipt(receipt) {
  sequence += 1;
  await appendFile(ledgerPath, `${JSON.stringify({
    schemaVersion: 1,
    sequence,
    recordedAt: new Date().toISOString(),
    ...receipt,
  })}\n`, "utf8");
}

await writeReceipt({ type: "proxy_started", allowedModel, maxRequests });

async function loadAuthorization() {
  const parsed = JSON.parse(await readFile(authPath, "utf8"));
  const accessToken = parsed?.tokens?.access_token;
  const accountId = parsed?.tokens?.account_id;
  if (typeof accessToken !== "string" || !accessToken || typeof accountId !== "string" || !accountId) {
    throw new Error("Codex login file does not contain an access token and account ID");
  }
  return { accessToken, accountId };
}

function copyRequestHeaders(headers) {
  const output = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (!value || ["authorization", "cookie", "host", "content-length", "content-encoding"].includes(name.toLowerCase())) {
      continue;
    }
    output.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return output;
}

function plainResponse(response, status, message) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(`${message}\n`);
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    plainResponse(response, 200, "ok");
    return;
  }
  const requestId = randomUUID();
  if (request.method !== "POST" || request.url !== "/backend-api/codex/responses") {
    await writeReceipt({ type: "request_rejected", requestId, reason: "route_rejected" });
    plainResponse(response, 403, "Forbidden");
    return;
  }
  try {
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of request) {
      totalBytes += chunk.length;
      if (totalBytes > maxBodyBytes) throw new Error("Request body exceeds the proxy limit");
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const validation = validateIncomingRequest({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body,
      allowedModel,
    });
    if (!validation.ok) {
      await writeReceipt({
        type: "request_rejected",
        requestId,
        reason: validation.reason,
        requestSha256: fingerprintRequest(body),
      });
      plainResponse(response, validation.status, validation.reason);
      return;
    }
    requestCount += 1;
    if (requestCount > maxRequests) {
      await writeReceipt({
        type: "request_rejected",
        requestId,
        reason: "budget_exhausted",
        model: allowedModel,
        requestSha256: fingerprintRequest(body),
      });
      plainResponse(response, 429, "Per-session request limit exceeded");
      return;
    }
    const { accessToken, accountId } = await loadAuthorization();
    const headers = copyRequestHeaders(request.headers);
    headers.set("authorization", `Bearer ${accessToken}`);
    headers.set("chatgpt-account-id", accountId);
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers,
      body,
      redirect: "error",
    });
    const responseHeaders = {};
    for (const [name, value] of upstream.headers.entries()) {
      if (!["connection", "content-encoding", "content-length", "transfer-encoding"].includes(name.toLowerCase())) {
        responseHeaders[name] = value;
      }
    }
    response.writeHead(upstream.status, responseHeaders);
    const responseChunks = [];
    if (upstream.body) {
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        responseChunks.push(chunk);
        response.write(chunk);
      }
    }
    const responseBody = Buffer.concat(responseChunks);
    const usage = extractResponseUsage(responseBody, upstream.headers.get("content-type") ?? "");
    const upstreamError = upstream.ok
      ? null
      : extractUpstreamErrorDiagnostic(responseBody, upstream.headers.get("content-type") ?? "");
    await writeReceipt({
      type: "upstream_response",
      requestId,
      model: allowedModel,
      requestSha256: fingerprintRequest(body),
      upstreamStatus: upstream.status,
      responseSha256: fingerprintRequest(responseBody),
      usage,
      usageCaptured: usage !== null,
      upstreamError,
    });
    response.end();
  } catch (error) {
    await writeReceipt({
      type: "proxy_failure",
      requestId,
      reason: "gateway_or_upstream_failure",
    }).catch(() => undefined);
    if (!response.headersSent) {
      response.writeHead(502, { "content-type": "application/json" });
    }
    response.end(JSON.stringify({
      error: "credential_proxy_failure",
      message: error instanceof Error ? error.message : String(error),
    }));
  }
});

server.listen(requestedPort, "0.0.0.0", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : requestedPort;
  process.stdout.write(`READY ${port}\n`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
