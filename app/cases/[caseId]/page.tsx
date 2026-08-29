import Link from "next/link";
import { resolve } from "node:path";
import { loadOverviewModel } from "../../../src/ui/overview-model.ts";
import { loadCaseModel } from "../../../src/ui/case-model.ts";

const evaluationRoot = resolve(process.cwd(), "artifacts/evaluation/recorded-all");

export const dynamicParams = false;

export async function generateStaticParams() {
  const overview = await loadOverviewModel(evaluationRoot);
  return overview.cases.map(({ caseId }) => ({ caseId }));
}

export default async function CasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(caseId)) throw new Error("Invalid case ID");
  const runDir = resolve(evaluationRoot, "runs", caseId, "trial-1", "advanced");
  const detail = await loadCaseModel(runDir);
  const changed = [
    ...detail.diff.added.map((path) => ({ kind: "added", path })),
    ...detail.diff.modified.map((path) => ({ kind: "modified", path })),
    ...detail.diff.removed.map((path) => ({ kind: "removed", path })),
  ];

  return (
    <main className="app-shell detail-shell">
      <header className="topbar">
        <Link className="wordmark" href="/"><span className="wordmark-mark" aria-hidden="true">EM</span><span>Evidence Maintainer</span></Link>
        <div className="topbar-meta"><span className="mode-badge">{detail.modeLabel}</span><span className="model-label">{detail.model}</span></div>
      </header>

      <nav className="breadcrumb" aria-label="Breadcrumb"><Link href="/">Control room</Link><span>/</span><code>{detail.caseId}</code></nav>

      <section className="detail-hero">
        <div><div className="eyebrow">Decision record</div><h1>{detail.title}</h1><p>{detail.description}</p></div>
        <div className="detail-action"><span>Selected action</span><strong className={`tone-text-${detail.actionBadge.tone}`}>{detail.actionBadge.label}</strong><small>{detail.outcome} · {detail.durationMs} ms</small></div>
      </section>

      <section className="detail-grid">
        <article className="evidence-card detail-wide">
          <div className="card-heading"><div><span className="step-number">01</span><h2>Evidence timeline</h2></div><span>{detail.evidence.length} immutable events</span></div>
          <ol className="timeline">
            {detail.evidence.map((event) => <li key={event.id}><div className="timeline-marker" aria-hidden="true"/><div><code>{event.id}</code><b>{event.kind.replaceAll("_", " ")}</b><p>{new Date(event.occurredAt).toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC</p><small>{event.evidenceIds.join(" · ")}</small></div></li>)}
          </ol>
        </article>

        <article className="evidence-card">
          <div className="card-heading"><div><span className="step-number">02</span><h2>Maintainer proposal</h2></div><span className={`action-badge tone-${detail.actionBadge.tone}`}>{detail.actionBadge.label}</span></div>
          <p className="lead-text">{detail.proposal.firstMaterialDivergence}</p>
          <dl className="fact-list"><div><dt>Failure owner</dt><dd>{detail.proposal.failureOwner}</dd></div><div><dt>Evidence used</dt><dd>{detail.proposal.evidenceUsed.join(", ")}</dd></div><div><dt>Preserved invariants</dt><dd>{detail.proposal.preservedInvariants.join(" · ")}</dd></div></dl>
        </article>

        <article className="evidence-card">
          <div className="card-heading"><div><span className="step-number">03</span><h2>Challenger verdict</h2></div><span className={`verdict verdict-${detail.challenger.verdict.toLowerCase()}`}>{detail.challenger.verdict}</span></div>
          <p className="lead-text">{detail.challenger.summary}</p>
          <dl className="fact-list"><div><dt>Evidence checked</dt><dd>{detail.challenger.evidenceIds.join(", ")}</dd></div><div><dt>Residual risk</dt><dd>{detail.residualRisks.length ? detail.residualRisks.join(" · ") : "None identified"}</dd></div></dl>
        </article>

        <article className="evidence-card detail-wide">
          <div className="card-heading"><div><span className="step-number">04</span><h2>Deterministic gate</h2></div><span className={`gate-status gate-${detail.gateStatus.toLowerCase()}`}>{detail.gateStatus}</span></div>
          <div className="check-grid">{detail.checks.map((check) => <div className={`check-card ${check.passed ? "check-pass" : "check-fail"}`} key={check.id}><span>{check.passed ? "✓" : "×"}</span><div><b>{check.id}</b><p>{check.summary}</p></div></div>)}</div>
        </article>

        <article className="evidence-card">
          <div className="card-heading"><div><span className="step-number">05</span><h2>Changed files</h2></div><span>{changed.length} paths</span></div>
          {changed.length ? <ul className="file-list">{changed.map((item) => <li key={`${item.kind}-${item.path}`}><span className={`file-kind kind-${item.kind}`}>{item.kind}</span><code>{item.path}</code></li>)}</ul> : <p className="empty-state">No mutation was proposed or applied.</p>}
        </article>

        <article className="evidence-card approval-card">
          <div className="card-heading"><div><span className="step-number">06</span><h2>Approval</h2></div><span className={`approval approval-${detail.approval.decision.toLowerCase()}`}>{detail.approval.decision}</span></div>
          <p className="lead-text">{detail.approval.reason}</p>
          <a className="primary-action full-action" href={detail.reportPath} download>Download signed decision record <span aria-hidden="true">↓</span></a>
        </article>

        <details className="evidence-card detail-wide hash-panel"><summary>Artifact hashes <span>{detail.artifactHashes.length} bound files</span></summary><div className="hash-list">{detail.artifactHashes.map((artifact) => <div key={artifact.path}><code>{artifact.path}</code><code>{artifact.sha256}</code></div>)}</div></details>
      </section>
    </main>
  );
}
