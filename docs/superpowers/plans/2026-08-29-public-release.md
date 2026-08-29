# Evidence Maintainer Public Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the public repository around the audited v4 result, remove stale promotional and AI-slop patterns, ship only reproducible canonical evidence, and verify the exact public commit from a clean clone before push.

**Architecture:** The public head contains source, frozen v4 contracts/cases, canonical summary rows, audit/invalidation records, concise documentation, and a restrained evidence browser. Full trajectories and raw run bundles are checksummed release assets rather than tracked source. A release verifier proves claims, paths, artifacts, secrets, build, and clean-clone reproducibility.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Node.js 24.18.0, Docker, GitHub Actions, static JSON/JSONL evidence, HyperFrames video source in `C:\Work\evidence-maintainer-hyperframes`.

**Spec:** `docs/superpowers/specs/2026-08-29-v4-symmetric-evaluation-design.md`

## Global Constraints

- Start only after the v4 campaign completion gate and nonpass audit are complete.
- Report the result that occurred. A null, negative, or invalidated comparison is a valid release outcome.
- Do not use giant delta typography, glow-heavy gradients, “hot take,” “flagship,” “proof-first,” simulated signatures, invented precision, or unqualified safety claims.
- Do not expose internal agent instructions, implementation plans, rubric-gaming notes, credentials, local absolute paths, or raw auth/proxy data.
- Preserve invalidation disclosures. Removing a failed campaign from the landing page must not erase its canonical invalidation record.
- Keep complete raw evidence outside Git and attach it as a checksummed release asset.
- Never package the working directory directly. Package from the exact verified commit and the separately verified raw-artifact root.
- Stage only named files. Any deletion of tracked artifacts must use an explicit generated inventory reviewed before `git rm`.

---

## Task 1: Define and Test the Public Release Contract

**Files:**
- Create: `release/public-files.json`
- Create: `release/claims.json`
- Create: `src/release/claims.ts`
- Create: `tests/release-contract.test.ts`
- Modify: `.gitignore`

- [ ] Define the public-head allowlist by directory and file class:
  - application/source: `app`, `src`, `scripts`, `prompts`, `schemas`, `docker`;
  - experiment: `holdout/v4/cases`, both v4 locks, preaudit, control receipts;
  - results: `artifacts/evaluation/holdout-v4/{summary.json,summary.raw.json,rows.jsonl,audit.json,RAW_BUNDLE.json}`;
  - disclosures: `holdout/INVALIDATION-v1.json` through `holdout/INVALIDATION-v3.json`;
  - docs: README, architecture, evaluation, reproduction, limitations, changelog, release manifest;
  - project: license, package files, Node pin, Docker files, CI.
- [ ] Explicitly deny from public head: `AGENTS.md`, `docs/superpowers`, `docs/product-spec.md`, `docs/spec-self-review.md`, legacy case sets, recorded fixture campaigns, smoke artifacts, internal plans, trajectory bundles, auth files, and local logs.
- [ ] Extend `.gitignore` with:

```gitignore
auth.json
.codex/
artifacts/smoke/
artifacts/evaluation/*/runs/
release/assets/*.mp4
release/assets/*.tar.gz
release/assets/*.zip
```

- [ ] Define every quantitative public claim as a JSON pointer into one canonical artifact:

```json
{
  "schemaVersion": 1,
  "claims": [
    { "id": "retained-workflow-count", "artifact": "artifacts/evaluation/holdout-v4/summary.json", "pointer": "/retainedWorkflowRunCount" },
    { "id": "baseline-odi", "artifact": "artifacts/evaluation/holdout-v4/summary.json", "pointer": "/arms/baseline/odi" },
    { "id": "advanced-odi", "artifact": "artifacts/evaluation/holdout-v4/summary.json", "pointer": "/arms/advanced/odi" },
    { "id": "odi-difference", "artifact": "artifacts/evaluation/holdout-v4/summary.json", "pointer": "/absoluteOdiChange" }
  ]
}
```

- [ ] Test that each claim resolves, rejects excessive decimal precision, and is absent from public prose if its source case was invalidated without symmetric denominator adjustment.
- [ ] Test that denied files and key-shaped strings (`sk_`, `ghp_`, `xoxb-`, PEM headers) fail the release contract. Scan content, file names, and symlink targets.
- [ ] Run `npm test -- tests/release-contract.test.ts`.
- [ ] Commit:

```powershell
git add -- release/public-files.json release/claims.json src/release/claims.ts tests/release-contract.test.ts .gitignore
git commit -m "define public release contract"
```

## Task 2: Remove Legacy Bulk and Internal Control Material From Public HEAD

**Files:**
- Create: `scripts/plan-public-cleanup.ts`
- Create: `release/cleanup-inventory.json`
- Delete according to the reviewed inventory: legacy tracked artifacts, legacy case trees, generated reports, internal control docs, and stale plans
- Modify: `tests/release-contract.test.ts`

- [ ] Generate `cleanup-inventory.json` from `git ls-files`, classifying every tracked path as `KEEP`, `RELEASE_ASSET`, or `REMOVE`. Include byte size and reason; sort by path.
- [ ] Verify the inventory keeps all v4 source/contracts/cases/results/disclosures and removes no current code dependency.
- [ ] Review the exact `REMOVE` list before deletion. Reject the inventory if it contains `.git`, the repository root, or a path outside `C:\Work\micro1-grounded-maintainer`.
- [ ] Before removing the active spec/plans from public HEAD, copy those exact files to `C:\Work\evidence-maintainer-internal-archive\2026-08-29` and verify their SHA-256 hashes against a local archive manifest. This private execution copy is not added to Git or a release asset.
- [ ] Use `git rm -f --pathspec-from-file` against the reviewed explicit list. Do not use globs, recursive filesystem deletion, `git reset --hard`, or `git checkout --`.
- [ ] Remove at minimum the tracked `artifacts/evaluation/recorded-all` bulk tree, legacy generated public reports, `AGENTS.md`, old product/spec review docs, and old superpowers plans/specs from the public branch.
- [ ] Keep v1-v3 invalidation JSON and one concise `docs/history.md` explaining why those campaigns are not comparative evidence.
- [ ] Run `npm test -- tests/release-contract.test.ts`, `npm run lint`, and `npm run build`. If code depended on removed fixtures, update it to load canonical v4 evidence; do not restore legacy bulk.
- [ ] Commit the explicit cleanup:

```powershell
git add -- scripts/plan-public-cleanup.ts release/cleanup-inventory.json tests/release-contract.test.ts docs/history.md
git commit -m "remove legacy public artifact bulk"
```

## Task 3: Rewrite the Documentation as a Research Artifact

**Files:**
- Rewrite: `README.md`
- Rewrite: `docs/architecture.md`
- Rewrite: `docs/evaluation.md`
- Rewrite: `docs/reproduction.md`
- Create: `docs/limitations.md`
- Rewrite: `docs/improvement-changelog.md`
- Delete: `docs/trajectory-index.md`
- Rewrite after results: `docs/video-script.md`
- Modify: `tests/release-contract.test.ts`

- [ ] Use this README order:
  1. one-sentence research question;
  2. one plain-language result sentence sourced from `summary.json`;
  3. compact workflow comparison;
  4. shared final contract and ODI definition;
  5. experiment size and freeze protocol;
  6. result table with counts and interval, not promotional deltas;
  7. invalidations and limitations;
  8. reproducibility commands;
  9. repository map;
  10. raw release-asset verification.
- [ ] Describe the advanced arm exactly as draft → advisory critique → revision → shared evaluator. State explicitly that the critique cannot directly change score.
- [ ] Publish v3's mechanically complete 30-run fact only in history/invalidation context; do not quote its raw 15/15 versus 14/15 as system performance.
- [ ] Use counts beside rates (`x/y`), no more than one decimal place for percentages, and the paired nested-case interval from the canonical summary.
- [ ] State that ten synthetic cases do not establish production safety or broad population generalization.
- [ ] Add a prose-lint test rejecting these unsourced phrases in public docs/UI: `hot take`, `flagship`, `proof-first`, `best-in-class`, `production safe`, `guaranteed`, `revolutionary`, `game-changing`, `signed decision record`, and `measured improvement`.
- [ ] Reject first-person claims of superiority and any number not mapped through `release/claims.json`.
- [ ] Run `npm test -- tests/release-contract.test.ts` and manually read the rendered Markdown once for tone, repetition, and unsupported adjectives.
- [ ] Commit:

```powershell
git add -- README.md docs/architecture.md docs/evaluation.md docs/reproduction.md docs/limitations.md docs/improvement-changelog.md docs/history.md docs/video-script.md tests/release-contract.test.ts
git add -u -- docs/trajectory-index.md
git commit -m "rewrite release narrative around audited evidence"
```

## Task 4: Rebuild the Evidence Browser Without Promotional UI Patterns

**Files:**
- Rewrite: `app/page.tsx`
- Rewrite: `app/cases/[caseId]/page.tsx`
- Rewrite: `app/globals.css`
- Modify: `src/ui/overview-model.ts`
- Modify: `src/ui/case-model.ts`
- Modify: `src/reports/load-artifacts.ts`
- Modify: `tests/ui.test.ts`
- Modify: `tests/report.test.ts`

- [ ] Replace the giant marketing hero with a compact header: title, research question, model/freeze identifier, and result status (`VALID`, `PARTIALLY INVALIDATED`, or `INVALIDATED`).
- [ ] Present the arm comparison as a restrained table with workflow runs, unique cases, ODI count/rate, interval, median latency, and measured tokens. Do not force the advanced arm into a success color.
- [ ] Add a visible invalidation/history panel before detailed cases.
- [ ] Replace “flagship” selection with a neutral, alphabetically stable case list. Each row shows expected action, per-arm three-trial stability, nonpass classification, and link to retained evidence.
- [ ] On the case page, show final decisions for both arms, semantic check outcomes, changed files, command/probe status, and diagnostic annotation alignment. Show draft/critique/revision only under a clearly labeled advanced-process section.
- [ ] Remove approval, simulated signatures, downloadable “signed decision” language, and unsupported “safe” labels.
- [ ] Replace glow gradients, oversized `92px` headings, repeated cards, and decorative badges with a single neutral surface, one accent color, tabular numbers, and accessible status text. Preserve responsive behavior and keyboard focus.
- [ ] Point loaders only at `artifacts/evaluation/holdout-v4`; the application must not require untracked raw run trees for the overview. Selected case details come from a small canonical `case-details.json` generated from audited artifacts.
- [ ] Test negative or zero lift rendering, evaluator-invalid cases, model execution failures, absent token receipts, and long titles at mobile width.
- [ ] Run `npm test -- tests/ui.test.ts tests/report.test.ts`, `npm run lint`, and `npm run build`.
- [ ] Open the local page at desktop and mobile widths and inspect the top, result table, invalidation panel, case table, and one detail page.
- [ ] Commit:

```powershell
git add -- app/page.tsx app/cases/[caseId]/page.tsx app/globals.css src/ui/overview-model.ts src/ui/case-model.ts src/reports/load-artifacts.ts tests/ui.test.ts tests/report.test.ts
git commit -m "rebuild neutral v4 evidence browser"
```

## Task 5: Make a Clean Clone Reproduce the Credential-Free Path

**Files:**
- Create: `.node-version`
- Create: `.github/workflows/verify.yml`
- Create: `scripts/verify-release.ts`
- Rewrite: `scripts/verify-submission.ts`
- Modify: `package.json`
- Modify: `tests/submission.test.ts`
- Modify: `Dockerfile`
- Modify: `.dockerignore`

- [ ] Pin `.node-version` to `24.18.0` and change `package.json` engines to `24.18.x`.
- [ ] Rewrite the submission verifier around v4: exactly ten cases, 60 frozen slots before invalidation, symmetric retained denominators, canonical rows/audit/locks, v4 role sets, artifact hashes, public-file allowlist, secret scan, absolute-path scan, Markdown links, and clean Git.
- [ ] Add `release:verify` that runs schema drift, lint, tests, case/control/preaudit verification, canonical result verification, Next build, and public contract checks without credentials or live model calls. Add a separate `release:verify:docker` command for the Docker build so verification cannot recurse inside the image build.
- [ ] Pin Docker base images by digest in every stage and verify `docker/codex-runner.lock.json` against the locally resolved image.
- [ ] Add GitHub Actions on pull request and push using Node 24.18.0, `npm ci`, `npm run release:verify`, and `npm run release:verify:docker`. Do not run live model evaluation in CI.
- [ ] Test the known clean-clone failure mode by changing a canonical manifest schema version; `release:verify` must fail before Next build.
- [ ] Run `npm ci`, `npm run release:verify`, and `npm run release:verify:docker`.
- [ ] Commit:

```powershell
git add -- .node-version .github/workflows/verify.yml scripts/verify-release.ts scripts/verify-submission.ts package.json package-lock.json tests/submission.test.ts Dockerfile .dockerignore
git commit -m "make public release reproducible"
```

## Task 6: Recut and Verify the Result-Accurate Video

**Files in video project:**
- Modify: `C:\Work\evidence-maintainer-hyperframes\src\**`
- Modify: `C:\Work\evidence-maintainer-hyperframes\assets\audio\voice-clone\**`
- Create: `C:\Work\evidence-maintainer-hyperframes\dist\evidence-maintainer-v4.mp4`

**Files in public repository:**
- Create: `release/video.json`
- Modify: `docs/video-script.md`
- Modify: `tests/release-contract.test.ts`

- [ ] Rewrite the narration from the audited v4 result. The opening 20 seconds must state the research question, compared workflows, and observed result without implying a win.
- [ ] Show the same final `DecisionPackage` and shared evaluator visually before showing the internal advanced critique.
- [ ] Include one evaluator correction/invalidation and one genuine model failure or stability example. Do not show stale v3 delta graphics.
- [ ] Use the user's authorized cloned voice already configured in the video project. Normalize loudness and remove clipped or unnaturally quiet transitions; do not change identity or imply another speaker.
- [ ] Render the final MP4, watch it end-to-end, and verify no stale numbers, clipped text, silent scene, cursor artifact, local path, credential, or unsupported claim appears.
- [ ] Store only measured metadata in Git, constructed directly from the rendered file:

```ts
const videoRecord = {
  schemaVersion: 1,
  fileName: basename(videoPath),
  sha256: await sha256File(videoPath),
  durationSeconds: await probeDurationSeconds(videoPath),
  bytes: (await stat(videoPath)).size,
  distribution: "github-release-asset",
};
await writeFile("release/video.json", `${JSON.stringify(videoRecord, null, 2)}\n`);
```

The test must reject an empty hash, nonpositive duration, or nonpositive byte count.
- [ ] Run the video project's lint/render verification and the repository's `npm test -- tests/release-contract.test.ts`.
- [ ] Commit source/script/metadata changes separately in each repository. Do not commit the MP4 to the source repository.

## Task 7: Produce Canonical Source and Raw-Evidence Archives

**Files:**
- Create: `scripts/package-release.ts`
- Create: `release/release-manifest.json`
- Create outside Git: `release/assets/evidence-maintainer-source-v4.zip`
- Create outside Git: `release/assets/evidence-maintainer-raw-v4.tar.gz`
- Modify: `tests/release-contract.test.ts`

- [ ] Implement a deterministic package script. Source ZIP input is `git archive` at the exact release commit. Raw TAR.GZ input is only `artifacts/evaluation/holdout-v4/runs` plus frozen receipts; entries are sorted, use normalized `/` paths, fixed mode bits, and one fixed mtime from the release commit.
- [ ] Reject symlinks, absolute paths, path traversal, auth files, environment files, and files not named by the raw-bundle manifest.
- [ ] Run the package twice and require identical SHA-256 hashes.
- [ ] Record archive names, byte sizes, hashes, source commit, v4 freeze hashes, video hash, and canonical artifact hashes in `release-manifest.json`.
- [ ] Verify the source archive by extracting to a temporary directory and running `npm ci` plus `npm run release:verify` there.
- [ ] Verify the raw archive by extracting to a separate temporary directory and reconciling all 60 slot receipts and artifact hashes without model credentials.
- [ ] Commit only `scripts/package-release.ts`, `release/release-manifest.json`, and tests; keep archive files ignored for GitHub release upload.

## Task 8: Clean-Clone Audit and Exact Public Push

**Files:**
- No new source files unless the audit exposes a defect.

- [ ] Confirm the destination before any push:

```powershell
git remote -v
git branch --show-current
git rev-parse HEAD
git status --short
```

The expected remote is `https://github.com/chanse-syres/evidence-maintainer.git`; the public branch name must not use an `agent/` prefix.

- [ ] Create a fresh temporary clone with `git clone --no-local`, checkout the exact candidate commit, and run `npm ci`, `npm run release:verify`, and the Docker build there.
- [ ] Start the production build from the clean clone and inspect the overview plus one case page. Confirm all displayed numbers match `release/claims.json` sources.
- [ ] Run a final secret/local-path scan over tracked files and both archives.
- [ ] Confirm `git diff --check`, clean status, exact commit, archive hashes, and video hash.
- [ ] Push the verified branch once. Do not amend or regenerate artifacts after the push.
- [ ] Create the GitHub release from that exact commit and upload the source ZIP, raw TAR.GZ, and MP4. Verify downloaded asset hashes match `release-manifest.json`.
- [ ] Open the public repository and release links from a logged-out browser session.

## Public Release Completion Gate

- [ ] The public head contains no internal agent-control file, internal implementation plan, credential, absolute local path, stale campaign claim, or bulk run tree.
- [ ] README, UI, video, and release manifest describe the same audited v4 outcome.
- [ ] Every quantitative claim resolves to canonical evidence.
- [ ] A clean clone passes `npm ci`, `npm run release:verify`, Next build, and Docker build without credentials.
- [ ] Source, raw evidence, and video assets have verified hashes and are attached to the exact release commit.
- [ ] The public branch and release were pushed only after exact-commit verification.
