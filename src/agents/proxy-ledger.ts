import { readFile } from "node:fs/promises";
import { z } from "zod";

const UsageSchema = z.object({
  input: z.number().int().nonnegative(),
  cachedInput: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
}).strict();

const ReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  sequence: z.number().int().positive(),
  type: z.enum(["proxy_started", "request_rejected", "upstream_response", "proxy_failure"]),
  reason: z.string().optional(),
  upstreamStatus: z.number().int().optional(),
  usageCaptured: z.boolean().optional(),
  usage: UsageSchema.nullable().optional(),
}).passthrough();

export interface ProxyLedgerSummary {
  usage: { input: number; cachedInput: number; output: number } | null;
  accountedUsage: { input: number; cachedInput: number; output: number } | null;
  coverage: { requestCount: number; accountedRequestCount: number; complete: boolean };
  budgetExhausted: boolean;
  proxyFailure: boolean;
  upstreamFailure: boolean;
}

export async function readProxyLedger(path: string): Promise<ProxyLedgerSummary> {
  const rows = (await readFile(path, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ReceiptSchema.parse(JSON.parse(line)));
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].sequence !== index + 1) throw new Error("Proxy ledger sequence is not contiguous");
  }
  const successful = rows.filter((row) => (
    row.type === "upstream_response" &&
    row.upstreamStatus !== undefined &&
    row.upstreamStatus >= 200 && row.upstreamStatus < 300
  ));
  const accounted = successful.filter((row) => row.usageCaptured === true && row.usage);
  const complete = successful.length > 0 && accounted.length === successful.length;
  const accountedUsage = accounted.length > 0
    ? {
        input: accounted.reduce((sum, row) => sum + row.usage!.input, 0),
        cachedInput: accounted.reduce((sum, row) => sum + row.usage!.cachedInput, 0),
        output: accounted.reduce((sum, row) => sum + row.usage!.output, 0),
      }
    : null;
  const usage = complete ? accountedUsage : null;
  return {
    usage,
    accountedUsage,
    coverage: {
      requestCount: successful.length,
      accountedRequestCount: accounted.length,
      complete,
    },
    budgetExhausted: rows.some((row) => row.type === "request_rejected" && row.reason === "budget_exhausted"),
    proxyFailure: rows.some((row) => row.type === "proxy_failure"),
    upstreamFailure: rows.some((row) => (
      row.type === "upstream_response" &&
      (row.upstreamStatus === undefined || row.upstreamStatus < 200 || row.upstreamStatus >= 300)
    )),
  };
}
