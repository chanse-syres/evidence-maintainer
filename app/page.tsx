import Link from "next/link";
import { loadOverviewModel } from "../src/ui/overview-model.ts";
import { loadPublicComparisonSelection } from "../src/ui/public-comparison.ts";

function percent(value: number): string {
  return `${(value * 100).toFixed(value === 1 ? 0 : 1)}%`;
}

function duration(value: number): string {
  return value < 1000 ? `${value.toFixed(1)} ms` : `${(value / 1000).toFixed(1)} s`;
}

function signedPercentagePoints(value: number): string {
  const points = value * 100;
  return `${points > 0 ? "+" : ""}${points.toFixed(1)}`;
}

function PendingEvaluation({ selectionRule }: { selectionRule: string }) {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="wordmark"><span className="wordmark-mark" aria-hidden="true">EM</span><span>Evidence Maintainer</span></div>
        <div className="topbar-meta"><span className="mode-badge">Pending V4 evidence</span></div>
      </header>

      <section className="overview-hero" aria-labelledby="project-title">
        <div>
          <div className="eyebrow">Evaluation status</div>
          <h1 id="project-title">No public system comparison is selected.</h1>
          <p className="hero-copy">
            Earlier campaigns remain preserved as invalidated evidence. Metrics will appear here only
            after a symmetric V4 campaign is completed and explicitly selected for publication.
          </p>
        </div>
        <aside className="hero-proof" aria-label="Public comparison status">
          <div className="proof-label">Public comparison</div>
          <div className="proof-number">—</div>
          <div className="proof-unit">awaiting valid V4 evidence</div>
          <div className="proof-comparison"><span>{selectionRule}</span></div>
        </aside>
      </section>

      <section className="metric-grid" aria-label="V4 evaluation contract">
        <article className="metric-card"><div className="metric-label">Final contract</div><div className="metric-value">1</div><div className="metric-foot">shared decision package for both workflows</div></article>
        <article className="metric-card"><div className="metric-label">Evaluation boundary</div><div className="metric-value">1</div><div className="metric-foot">shared semantic evaluator and finalizer</div></article>
        <article className="metric-card"><div className="metric-label">Published comparisons</div><div className="metric-value">0</div><div className="metric-foot">until a valid V4 campaign is selected</div></article>
      </section>

      <section className="pipeline-panel" aria-labelledby="pipeline-title">
        <div className="section-heading"><div><div className="eyebrow">Symmetric architecture</div><h2 id="pipeline-title">Two workflows. One final contract.</h2></div><p>The direct and assisted workflows are measured at the same decision boundary.</p></div>
        <ol className="pipeline">
          <li><span>01</span><b>Direct</b><p>One model emits a final decision package from public case evidence.</p></li>
          <li><span>02</span><b>Propose · critique · revise</b><p>Three sessions produce one revised final package; critique remains advisory evidence.</p></li>
          <li><span>03</span><b>Shared finalizer</b><p>Only declared operations reach a fresh sandbox and the same command boundary.</p></li>
          <li><span>04</span><b>ODI</b><p>One semantic evaluator measures action, artifact, mutation, command, source, and contradiction integrity.</p></li>
        </ol>
      </section>

      <footer className="site-footer"><span>Evidence Maintainer · micro1 Frontier Engineering Challenge 2026</span><span>Comparison withheld pending valid evidence</span></footer>
    </main>
  );
}

export default async function Home() {
  const selection = await loadPublicComparisonSelection();
  if (selection.state === "pending") {
    return <PendingEvaluation selectionRule={selection.selectionRule} />;
  }
  const overview = await loadOverviewModel(selection.evaluationRoot);
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
            Direct and propose-critique-revise workflows emit the same final decision
            package. One shared finalizer and semantic evaluator measure both systems.
          </p>
          {overview.flagshipHref && overview.flagshipCaseId ? (
            <div className="hero-actions">
              <Link className="primary-action" href={overview.flagshipHref}>
                Inspect flagship decision <span aria-hidden="true">→</span>
              </Link>
              <a className="secondary-action" href={`/reports/${overview.flagshipCaseId}.html`} download>
                Download decision record
              </a>
            </div>
          ) : null}
        </div>
        <aside className="hero-proof" aria-label="Measured ODI difference">
          <div className="proof-label">Operational Decision Integrity</div>
          <div className="proof-number">{signedPercentagePoints(overview.absoluteOdiChange)}</div>
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
          <div className="metric-label">Propose · critique · revise</div>
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
          <div><div className="eyebrow">Decision architecture</div><h2 id="pipeline-title">Two workflows. One final contract.</h2></div>
          <p>Both systems meet at the same execution and scoring boundary.</p>
        </div>
        <ol className="pipeline">
          <li><span>01</span><b>Direct</b><p>One model emits a final decision package from public case evidence.</p></li>
          <li><span>02</span><b>Propose · critique · revise</b><p>Three sessions produce one revised package; critique remains advisory process evidence.</p></li>
          <li><span>03</span><b>Shared finalizer</b><p>Applies only declared operations to a fresh sandbox and runs one command boundary.</p></li>
          <li><span>04</span><b>Semantic evaluator</b><p>Measures the same six blocking ODI components for both final packages.</p></li>
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
          {overview.cases.map((item) => {
            const content = (
              <>
                <div className="case-title"><b>{item.title}</b><code>{item.caseId}</code></div>
                <span className={`action-badge tone-${item.actionBadge.tone}`}>{item.actionBadge.label}</span>
                <div className="arm-result"><span>Direct</span><b className={item.baseline.odi === 1 ? "is-safe" : "is-failed"}>{percent(item.baseline.odi)}</b></div>
                <div className="arm-result"><span>Assisted</span><b className={item.advanced.odi === 1 ? "is-safe" : "is-failed"}>{percent(item.advanced.odi)}</b></div>
                <span className="row-arrow" aria-hidden="true">{item.detailHref ? "↗" : "—"}</span>
              </>
            );
            return item.detailHref ? (
              <Link className={`case-row ${item.harmfulChange ? "has-risk" : ""}`} href={item.detailHref} key={item.caseId}>{content}</Link>
            ) : (
              <div className={`case-row ${item.harmfulChange ? "has-risk" : ""}`} key={item.caseId} aria-label={`${item.title}: no decision artifact available`}>{content}</div>
            );
          })}
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
