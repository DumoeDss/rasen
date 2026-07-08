# Ship Log: fork-phase1-release-prep

**Date:** 2026-07-08
**Mode:** local
**Branch:** dev-harness
**Commit:** f4c287bcf9a7616c3f1030fdf8d436f07a6a0285
**Tree:** fbbb01bd540f0d5496c6fdb5b00ab151e96414fc
**Status:** Committed (delivery deferred to portfolio/parent level)

> Note: the Commit/Tree above identify the content commit for this change.
> A ship log cannot embed the hash of the commit that contains it, so this log
> was finalized into the delivered `dev-harness` HEAD by a follow-up `--amend`;
> the exact delivered HEAD hash is reported to the portfolio LEAD. The recorded
> **Tree** is the content-addressed fingerprint for the test-evidence gate.

> Portfolio CHILD of the `fork-phase1` parent — the FINAL child (cohort "final").
> Depends on A3 (browse-removal) and B2 (telemetry-client), both shipped+archived.
> Per the portfolio delivery policy, a child ships in LOCAL mode (commit only) —
> no push, no PR, **no tag, no GitHub Release**. Actual release delivery is
> explicitly ESCALATED to a human (see the "Release Delivery Is Escalated, Not
> Automated" requirement in this change's spec), and the portfolio wrap-up
> happens at the parent level after this commit.

## Pre-Flight Results
- Verification: **pass** — `review-report.md` present; verdict **PASS / APPROVE**
  with **0 findings / 0 blocking issues** (3 informational notes only, incl. the
  pnpm-9 lockstep note recorded accepted-known). Confirmed: `package.json`
  version `1.5.0`→`0.1.0` only (no other field touched); dual-copyright LICENSE;
  README fork declaration + tgz install guide with no browse/Playwright refs;
  CHANGELOG `0.1.0` entry above retained `1.5.0`; tag-triggered `release.yml`
  (no bun/build:browse/Playwright, not upstream-gated, legacy `release-prepare.yml`
  left inert).
- Tasks: **15/15 complete** — every task in `tasks.md` marked `[x]`.

## Test Gate
- Tests: **skipped — green at `review-report.md` (reviewer-c independent gate on
  this exact tree).**
  - Recorded passing evidence: `pnpm build` green; `bin --version` = **0.1.0**;
    **zero `1.5.0` hits** in src/test; `npm pack --dry-run` reproduced the
    **443-file** inventory exactly with **zero browse/Playwright/telemetry-backend
    residue**; `openspec validate --strict` valid.
  - Re-run deliberately NOT performed: the LEAD authorized citing this evidence.
    C's diff (version bump + docs + release workflow) is the only uncommitted
    tracked content now, so this commit's tree matches the tree reviewer-c
    verified. C's edits are metadata/docs/CI only — no runtime `src/` logic
    changed — so the vitest suites are unaffected.

## What Shipped
Fork release preparation — reset to an independent `0.1.0` baseline and provide a
fork-runnable release pipeline, WITHOUT creating the tag or Release.
- **`package.json`** — `version` `1.5.0` → `0.1.0` (fork semver baseline; `name`
  and `bin` unchanged).
- **`LICENSE`** — MIT terms retained; dual copyright (upstream OpenSpec
  Contributors 2024 + fork maintainer DumoeDss 2026).
- **`README.md`** — fork declaration (independently maintained, not affiliated
  with Fission-AI), tgz install guide (`engines.node >= 20.19.0`, chrome-use
  prerequisites, uninstall-upstream-first bin-conflict warning, upstream-v1.5.0
  alignment note); no browse/Playwright references.
- **`CHANGELOG.md`** — `0.1.0` fork-baseline entry above the retained upstream
  `1.5.0` history; truthfully documents the three batches and the `node:https`
  transport + `HTTP(S)_PROXY` limitation.
- **`.github/workflows/release.yml`** (new) — on `v*` tag push: checkout → pnpm →
  node → `pnpm install --frozen-lockfile` → `pnpm build` → `npm pack` → upload
  tgz to a GitHub Release; not gated to the upstream repo; no bun/build:browse/
  Playwright. Legacy `release-prepare.yml` untouched (stays inert via its
  upstream-repo guard).
- **Change artifacts** — proposal, design, tasks, notes (443-file pack
  inventory), review-report, 1 ADDED delta spec (fork-release-preparation), and
  this ship log. (`auto-run.json` is git-ignored run-state — `.gitignore:163` —
  intentionally NOT committed.)

## Delivery Constraint (explicit)
NO `v0.1.0` tag created or pushed; NO `git push`; NO GitHub Release published.
These are escalated for human-initiated delivery — both by the portfolio's
local-mode policy AND by this change's own spec requirement.

## Scope Hygiene
Staged EXPLICITLY and ONLY: `package.json`, `LICENSE`, `README.md`,
`CHANGELOG.md`, `.github/workflows/release.yml`, and the change dir. Left
UNSTAGED (parent bookkeeping / pre-existing): `openspec/changes/fork-phase1/`
(parent portfolio container — stays until the run-end wrap-up),
`openspec/handoff/`, and `openspec/office-hours/`.

## Deployment
N/A — local mode. Release delivery (tag / push / GitHub Release) is deferred and
escalated to the user. Archive is run separately as a follow-up commit.
