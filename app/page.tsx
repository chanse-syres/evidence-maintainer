import Link from "next/link";
import { resolve } from "node:path";
import { loadOverviewModel } from "../src/ui/overview-model.ts";

const evaluationRoot = resolve(process.cwd(), "artifacts/evaluation/recorded-all");

function percent(value: number): string {
  return `${(value * 100).toFixed(value === 1 ? 0 : 1)}%`;
}

function duration(value: number): string {
  return value < 1000 ? `${value.toFixed(1)} ms` : `${(value / 1000).toFixed(1)} s`;
}

export default async function Home() {
  const overview = await loadOverviewModel(evaluationRoot);
  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="wordmark" href="/" aria-label="Evidence Maintainer home">
          <span className="wordmark-mark" aria-hidden="true">EM</span>
          <span>Evidence Maintainer</span>
        </Link>
        <div className="topbar-meta">
          <span className="mode-badge">{overview.modeLabel}</span>
          <span className="model-label">{overview.model}</span>
        </div>
      </header>

      <section className="overview-hero" aria-labelledby="project-title">
        <div>
          <div className="eyebrow">Proof-first autonomous operations</div>
          <h1 id="project-title">Safe maintenance is a decision problem.</h1>
          <p className="hero-copy">
            A Maintainer proposes the smallest evidence-backed action. An independent
            Challenger attacks it. A deterministic gate decides whether any change is
            eligible for approval.
          </p>
          <div className="hero-actions">
            <Link className="primary-action" href={overview.flagshipHref}>
              Inspect flagship decision <span aria-hidden="true">→</span>
            </Link>
            <a className="secondary-action" href="/reports/update-official-commitment.html" download>
              Download decision record
            </a>
          </div>
        </div>
        <aside className="hero-proof" aria-label="Measured improvement">
          <div className="proof-label">Operational Decision Integrity</div>
          <div className="proof-number">+{(overview.absoluteOdiChange * 100).toFixed(1)}</div>
          <div className="proof-unit">percentage points</div>
          <div className="proof-comparison">
            <span><b>{percent(overview.baseline.odi)}</b> direct baseline</span>
            <span><b>{percent(overview.advanced.odi)}</b> evidence-first</span>
          </div>
        </aside>
      </section>

      <section className="metric-grid" aria-label="Evaluation summary">
        <article className="metric-card baseline-card">
          <div className="metric-label">Direct agent baseline</div>
          <div className="metric-value">{percent(overview.baseline.odi)}</div>
          <div className="metric-foot">{overview.baseline.operationalDecisions}/{overview.baseline.workflowRunCount} operationally correct decisions</div>
        </article>
        <article className="metric-card advanced-card">
          <div className="metric-label">Evidence-first system</div>
          <div className="metric-value">{percent(overview.advanced.odi)}</div>
          <div className="metric-foot">{overview.advanced.operationalDecisions}/{overview.advanced.workflowRunCount} operationally correct decisions</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">Forbidden-mutation protection</div>
          <div className="paired-stat"><span>{overview.baseline.noForbiddenMutationCount}</span><i>→</i><strong>{overview.advanced.noForbiddenMutationCount}</strong></div>
          <div className="metric-foot">passing runs · baseline → evidence-first</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">Evidence source coverage</div>
          <div className="paired-stat"><span>{overview.baseline.sourceCoverageCount}</span><i>→</i><strong>{overview.advanced.sourceCoverageCount}</strong></div>
          <div className="metric-foot">passing runs · annotation match reported separately</div>
        </article>
      </section>

      <section className="pipeline-panel" aria-labelledby="pipeline-title">
        <div className="section-heading">
          <div><div className="eyebrow">Decision architecture</div><h2 id="pipeline-title">One proposal. Three independent boundaries.</h2></div>
          <p>Each boundary emits a reviewable artifact, so progress is never inferred from a final answer alone.</p>
        </div>
        <ol className="pipeline">
          <li><span>01</span><b>Maintainer</b><p>Builds a source-linked evidence ledger and selects one action.</p></li>
          <li><span>02</span><b>Challenger</b><p>Tries to falsify the proposal, authority, and preserved invariants.</p></li>
          <li><span>03</span><b>Deterministic gate</b><p>Checks the exact artifact, write surface, regressions, and evidence use.</p></li>
          <li><span>04</span><b>Approval</b><p>Applies only eligible sandboxed outcomes; otherwise withholds or escalates.</p></li>
        </ol>
      </section>

      <section className="cases-panel" aria-labelledby="cases-title">
        <div className="section-heading">
          <div><div className="eyebrow">Case ledger</div><h2 id="cases-title">Every decision remains inspectable.</h2></div>
          <div className="compact-stats">
            <span>Median {duration(overview.advanced.medianDurationMs)}</span>
            <span>{overview.advanced.totalTokens.toLocaleString()} recorded tokens</span>
          </div>
        </div>
        <div className="case-list">
          {overview.cases.map((item) => (
            <Link className={`case-row ${item.harmfulChange ? "has-risk" : ""}`} href={item.detailHref} key={item.caseId}>
              <div className="case-title"><b>{item.title}</b><code>{item.caseId}</code></div>
              <span className={`action-badge tone-${item.actionBadge.tone}`}>{item.actionBadge.label}</span>
              <div className="arm-result"><span>Direct</span><b className={item.baseline.odi === 1 ? "is-safe" : "is-failed"}>{percent(item.baseline.odi)}</b></div>
              <div className="arm-result"><span>Evidence-first</span><b className={item.advanced.odi === 1 ? "is-safe" : "is-failed"}>{percent(item.advanced.odi)}</b></div>
              <span className="row-arrow" aria-hidden="true">↗</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="hot-take" aria-label="Project thesis">
        <div className="eyebrow">The hot take</div>
        <blockquote>“The safest autonomous maintainer is not the one that changes the most data. It is the one that can prove when a new observation is not yet a new fact.”</blockquote>
      </section>

      <footer className="site-footer">
        <span>Evidence Maintainer · micro1 Frontier Engineering Challenge 2026</span>
        <span>Case set <code>{overview.caseSetHash.slice(0, 12)}</code></span>
      </footer>
    </main>
  );
}
