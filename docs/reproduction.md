# Reproduction Guide

This guide verifies the V4 engine and selected evidence without rerunning the live model campaign.

## Requirements

- Node.js 24 or newer
- npm
- Git for repository-integrity checks
- optional: Docker

No model credential is required for the engine verification path.

## Verify from a clean clone

```bash
npm ci
npm run engine:verify
```

The engine gate:

1. regenerates the public output schemas;
2. fails if generation changes the checked-in schema bytes;
3. runs lint;
4. runs the complete engine test suite;
5. builds the production application.

A passing engine gate proves that the checked-in contracts and deterministic components agree. It does not run a model, estimate ODI, or select a public comparison.

## Inspect the application

```bash
npm run dev
```

Open `http://localhost:3000`. The public comparison state is read from [`config/public-comparison.json`](../config/public-comparison.json), which selects adjudicated V4 attempt 2. The interface should show four included cases, one symmetric evaluator invalidation, 12/12 ODI for each arm, and the exact resource deltas.

Historical recorded fixtures and invalidated campaign artifacts may still be inspected for debugging. They must remain labeled as engineering or invalidation evidence.

## Verify the release package

After committing the intended release files, run the package-integrity proof from a clean tree:

```bash
npm run submission:verify
```

For an extracted source archive without a `.git` directory:

```bash
node --experimental-strip-types scripts/verify-submission.ts --skip-git
```

Treat a provenance mismatch, missing link, unexpected credential-like file, stale public claim, or dirty-tree failure as a release defect. Do not bypass the check.

## Docker

Build the image:

```bash
docker build -t evidence-maintainer .
```

Run its credential-free verification entry point:

```bash
docker run --rm evidence-maintainer
```

The container must not receive live model credentials or network access for candidate execution.

## Historical campaigns

V1, V2, and V3 are not reproducible performance claims. Their frozen bytes and receipts are retained so the invalidations themselves can be audited:

- [V1 invalidation](../holdout/INVALIDATION-v1.json)
- [V2 invalidation](../holdout/INVALIDATION-v2.json)
- [V3 invalidation](../holdout/INVALIDATION-v3.json)
- [Historical trajectory index](trajectory-index.md)

Running an old campaign again would not repair its evaluator or case defects. A correction requires a new version, a new freeze, and a new campaign.

## Validate the selected V4 evidence

The selected campaign was published only after these checks were satisfied:

- the V4 prompts, schemas, evaluator, runtime image, measurement code, and cases are frozen before target-model execution;
- both arms use identical selected case bytes, model, timeout, finalizer, and semantic evaluator;
- every advanced slot has complete Maintainer, Challenger, and Reviser receipts;
- infrastructure failures abort aggregation and receive separate retry receipts;
- invalid evaluator cases are excluded symmetrically from both arms;
- no target-model output is inspected while authoring or freezing the cases;
- `npm run engine:verify` passes at the exact evaluation commit.

The repository retains all 30 raw workflow slots, the evaluator-invalidation receipt, the 24 included rows, 60 session trajectories and proxy ledgers, and the selected report hashes. Run `npm run reports:selected` to regenerate the four public decision reports from the selected evidence, then run `npm run submission:verify` from a clean tree to validate the release.

## Troubleshooting

- If Node rejects type-stripping flags, upgrade to Node 24 or newer.
- If provenance loading fails, do not edit hashes by hand; regenerate the source package and review the diff.
- If a model or infrastructure dependency fails during a future campaign, retain the receipt and follow the typed failure policy in [evaluation.md](evaluation.md).
- If a Markdown link or artifact hash fails, treat it as a packaging defect.
