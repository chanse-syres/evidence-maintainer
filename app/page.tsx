import { PROJECT_TITLE } from "../src/core/project.ts";

export default function Home() {
  return (
    <main className="shell">
      <section className="hero" aria-labelledby="project-title">
        <div className="eyebrow">Agentic reliability benchmark</div>
        <h1 id="project-title">{PROJECT_TITLE}</h1>
        <p>Safe autonomous maintenance for live public-data products.</p>
        <span className="status">Recorded demo</span>
      </section>
    </main>
  );
}
