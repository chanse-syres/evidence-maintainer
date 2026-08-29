export function fingerprintRequest(body: Buffer): string;

export function validateIncomingRequest(input: {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  body: Buffer;
  allowedModel: string;
}):
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; reason: string };

export function extractResponseUsage(
  body: Buffer,
  contentType?: string,
): { input: number; cachedInput: number; output: number } | null;

export function extractUpstreamErrorDiagnostic(
  body: Buffer,
  contentType?: string,
): Record<string, string>;
