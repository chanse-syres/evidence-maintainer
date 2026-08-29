import { loadRunArtifacts } from "./load-artifacts.ts";

export interface DecisionReportOptions {
  titleOverride?: string;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pretty(value: unknown): string {
  return escapeHtml(JSON.stringify(value, null, 2));
}

function list(items: string[], empty: string): string {
  if (items.length === 0) return `<p class="empty">${escapeHtml(empty)}</p>`;
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

export async function renderDecisionReport(
  runDir: string,
  options: DecisionReportOptions = {},
): Promise<string> {
  const artifacts = await loadRunArtifacts(runDir);
  const modeLabel = artifacts.manifest.mode === "live"
    ? "Live agent evidence"
    : "Recorded evidence";
  const title = options.titleOverride ?? artifacts.caseManifest.title;
  const changedFiles = [
    ...artifacts.diff.added.map((path) => `Added: ${path}`),
    ...artifacts.diff.modified.map((path) => `Modified: ${path}`),
    ...artifacts.diff.removed.map((path) => `Removed: ${path}`),
  ];
  const hashes = Object.entries(artifacts.manifest.artifactSha256)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, hash]) => `<tr><th>${escapeHtml(path)}</th><td><code>${escapeHtml(hash)}</code></td></tr>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Evidence Maintainer</title>
<style>
:root{color-scheme:dark;--bg:#071018;--panel:#0d1822;--panel2:#111f2b;--ink:#f4f7fb;--muted:#91a2b4;--line:#263747;--cyan:#4cd7f6;--green:#54d19a;--orange:#ff8a2a;--red:#ff6b72}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{width:min(1120px,calc(100% - 32px));margin:0 auto;padding:48px 0 80px}.top{border-bottom:1px solid var(--line);padding-bottom:28px}.kicker{color:var(--cyan);font:700 12px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.12em;text-transform:uppercase}.mode{display:inline-flex;margin-top:18px;padding:7px 10px;border:1px solid #28576a;border-radius:999px;color:#bcefff;background:#0d2833;font:700 11px/1 ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase}h1{max-width:760px;margin:14px 0 8px;font-size:clamp(38px,7vw,72px);line-height:.98;letter-spacing:-.055em}h2{margin:0 0 18px;font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:#b9c7d4}p{margin:0;color:var(--muted)}.decision{margin:28px 0;padding:24px;border:1px solid #345266;border-left:4px solid var(--green);background:linear-gradient(90deg,#10242b,var(--panel));border-radius:10px}.decision strong{display:block;margin-top:6px;font-size:30px;letter-spacing:-.03em}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:16px}.card{min-width:0;padding:22px;border:1px solid var(--line);border-radius:10px;background:var(--panel)}.wide{grid-column:1/-1}.event{display:grid;grid-template-columns:80px 1fr;gap:16px;padding:14px 0;border-top:1px solid var(--line)}.event:first-of-type{border-top:0}.event code,.hashes code{overflow-wrap:anywhere;color:#bcefff}ul{margin:0;padding-left:20px;color:#d6e0e9}li+li{margin-top:6px}.checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.check{padding:12px;border:1px solid var(--line);border-radius:7px;background:var(--panel2)}.pass{border-color:#265b4a}.fail{border-color:#73343a}.check b{color:var(--green)}.fail b{color:var(--red)}pre{margin:0;overflow:auto;padding:16px;border:1px solid var(--line);border-radius:8px;background:#071119;color:#cad5df;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}.hashes{width:100%;border-collapse:collapse}.hashes th,.hashes td{text-align:left;vertical-align:top;padding:10px 0;border-top:1px solid var(--line)}.hashes th{width:36%;padding-right:18px;color:#c6d1db}.empty{color:#718397}.footer{margin-top:20px;color:#718397;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}@media(max-width:760px){.wrap{width:min(100% - 20px,1120px);padding-top:28px}.grid,.checks{grid-template-columns:1fr}.wide{grid-column:auto}.event{grid-template-columns:1fr;gap:5px}.hashes th,.hashes td{display:block;width:100%;border:0}.hashes tr{display:block;padding:10px 0;border-top:1px solid var(--line)}}
</style>
</head>
<body><main class="wrap">
<header class="top"><div class="kicker">Evidence Maintainer · Decision record</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(artifacts.caseManifest.description)}</p><span class="mode">${modeLabel}</span></header>
<section class="decision"><h2>Selected action</h2><strong>${escapeHtml(artifacts.proposal.action)}</strong><p>${escapeHtml(artifacts.proposal.summary)}</p></section>
<div class="grid">
<section class="card wide"><h2>Evidence timeline</h2>${artifacts.evidence.map((event) => `<article class="event"><code>${escapeHtml(event.id)} · ${escapeHtml(event.kind)}</code><div><p>${escapeHtml(event.occurredAt)}</p><p>Evidence: ${escapeHtml(event.evidenceIds.join(", "))}</p></div></article>`).join("")}</section>
<section class="card"><h2>Maintainer proposal</h2><pre>${pretty(artifacts.proposal)}</pre></section>
<section class="card"><h2>Challenger verdict</h2><p><strong>${escapeHtml(artifacts.challenger.verdict)}</strong></p><p>${escapeHtml(artifacts.challenger.summary)}</p><div style="margin-top:14px">${list(artifacts.challenger.violations, "No violations identified.")}</div></section>
<section class="card wide"><h2>Deterministic checks</h2><div class="checks">${artifacts.gate.checks.map((check) => `<div class="check ${check.passed ? "pass" : "fail"}"><b>${check.passed ? "PASS" : "FAIL"}</b> · ${escapeHtml(check.id)}<p>${escapeHtml(check.summary)}</p></div>`).join("")}</div></section>
<section class="card"><h2>Changed files</h2>${list(changedFiles, "No files changed.")}</section>
<section class="card"><h2>Residual risk</h2>${list(artifacts.challenger.residualRisks, "No residual risk identified by the Challenger.")}</section>
<section class="card"><h2>Approval decision</h2><p><strong>${escapeHtml(artifacts.approval.decision)}</strong></p><p>${escapeHtml(artifacts.approval.reason)}</p></section>
<section class="card"><h2>Recorded evidence</h2><p>Mode: ${escapeHtml(artifacts.manifest.mode)}</p><p>Model: ${escapeHtml(artifacts.manifest.model)}</p><p>Run: ${escapeHtml(artifacts.manifest.runId)}</p></section>
<section class="card wide"><h2>Artifact hashes</h2><table class="hashes">${hashes}</table></section>
</div>
<p class="footer">Self-contained UTF-8 decision report · ${escapeHtml(artifacts.manifest.finishedAt)}</p>
</main></body></html>`;
}
