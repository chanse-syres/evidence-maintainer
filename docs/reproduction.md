# Reproduction Guide

This guide reproduces the credential-free demo and explains how to run a new live comparison when Codex access is available. All actions remain inside copied case workspaces.

## Requirements

- Node.js 24 or newer
- npm
- Git, for the final clean-tree integrity check
- optional: Docker
- optional for a fresh live evaluation: authenticated Codex CLI compatible with the configured model

The frozen live evidence used Node.js 24, Codex CLI `0.150.0-alpha.8`, model `gpt-5.6-terra`, one trial per case, and a 1,200,000 ms per-agent timeout.

## Install and verify

The commands are the same in PowerShell, Command Prompt, bash, and zsh:

```bash
npm ci
npm run schemas
npm test
npm run lint
npm run demo
npm run build
```

Expected outcomes:

- tests report 49 or more passing tests and zero failures;
- lint exits without an error;
- the demo says it generated 15 recorded reports;
- the Next.js production build completes successfully.

After committing any generated artifacts, run the release integrity proof from a clean tree:

```bash
npm run submission:verify
```

For an extracted source archive without a `.git` directory, use:

```bash
node --experimental-strip-types scripts/verify-submission.ts --skip-git
```

## Inspect the application

```bash
npm run dev
```

Open `http://localhost:3000`. The overview compares baseline and advanced outcomes. Each case page exposes the decision, evidence, changed-file surface, gate checks, simulated approval, and artifact links. The default demo is explicitly labeled `recorded`.

## Reproduce the deterministic recorded comparison

This command requires no model credentials and writes a separate output directory:

```bash
npm run evaluate -- --cases all --trials 1 --mode recorded --model recorded-fixture --timeout-ms 30000 --out artifacts/evaluation/reproduction-recorded
```

The expected case-set hash is:

```text
39588ff6ceb708f76a84e65b0f6d9310138f02dda54f306220f8155c3e73af50
```

Recorded output proves deterministic case loading, schemas, mutation isolation, scoring, manifests, trajectories, aggregation, and reporting. It is not a new model result.

## Run one case

Recorded baseline:

```bash
npm run case -- --case cases/noop-filtered-removal --arm baseline --mode recorded --model recorded-fixture --timeout-ms 30000 --out artifacts/runs/noop-filtered-removal-baseline
```

Recorded advanced workflow:

```bash
npm run case -- --case cases/noop-filtered-removal --arm advanced --mode recorded --model recorded-fixture --timeout-ms 30000 --out artifacts/runs/noop-filtered-removal-advanced
```

## Run a fresh live comparison

Authenticate the Codex CLI according to your environment, confirm that `gpt-5.6-terra` is available, and run:

```bash
npm run evaluate -- --cases all --trials 1 --mode live --model gpt-5.6-terra --timeout-ms 1200000 --out artifacts/evaluation/reproduction-live
```

This executes 15 baseline sessions, 15 Maintainer sessions, and 15 Challenger sessions. Runtime and usage depend on service conditions. The frozen final run took approximately 8 minutes 37 seconds end to end and used 893,150 total tokens across both arms. Do not overwrite `artifacts/evaluation/final-v3`; choose a new output directory.

For a stronger follow-up experiment, use at least three trials per frozen case without changing prompts, schemas, model, timeout, or case bytes.

## Docker

Build the image:

```bash
docker build -t evidence-maintainer .
```

Run the credential-free recorded demo:

```bash
docker run --rm evidence-maintainer
```

The image installs pinned dependencies, regenerates schemas, runs tests, builds the application, switches to the non-root `node` user, and executes only the recorded demo. Live evaluation and credentials are intentionally excluded.

## Artifact locations

- frozen live summary: [final-v3/summary.json](../artifacts/evaluation/final-v3/summary.json)
- frozen live rows: [final-v3/rows.jsonl](../artifacts/evaluation/final-v3/rows.jsonl)
- frozen live runs: [final-v3/runs](../artifacts/evaluation/final-v3/runs)
- deterministic comparison: [recorded-all](../artifacts/evaluation/recorded-all)
- generated demo reports: [demo/reports](../artifacts/demo/reports)
- selected raw trajectories: [trajectory-index.md](trajectory-index.md)

## Troubleshooting

- If Node rejects type-stripping flags, upgrade to Node 24 or newer.
- If a case fails provenance loading, do not edit its hashes by hand; regenerate the case through the checked-in case generator and review the resulting diff.
- If live mode reports an authentication or model error, recorded mode still verifies the entire offline harness. Do not relabel recorded output as live.
- If `submission:verify` reports a dirty tree, inspect and commit or intentionally remove generated changes before rerunning it.
- If a Markdown link or artifact hash fails, treat it as a packaging defect; do not bypass the verifier.
