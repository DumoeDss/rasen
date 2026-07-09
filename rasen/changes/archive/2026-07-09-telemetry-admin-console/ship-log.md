# Ship Log: telemetry-admin-console

**Date:** 2026-07-09
**Mode:** local
**Branch:** dev-harness
**Commit:** <filled post-commit>
**Tree:** <filled post-commit>
**Status:** Committed (delivery deferred / operator backfill pending)

> Note: the Commit/Tree above identify the content commit for this change.
> A ship log cannot embed the hash of the commit that contains it, so this log
> was finalized into the delivered `dev-harness` HEAD by a follow-up `--amend`;
> the exact delivered HEAD hash is reported to the LEAD. The recorded **Tree** is
> the content-addressed fingerprint for the test-evidence gate.

> LOCAL mode (commit only) — no push, no tag, no GitHub Release. This adds a
> private maintainer admin console to the existing telemetry Worker.

## Pre-Flight Results
- Verification: **pass** — `review-report.md` present; verdict **APPROVE** with
  **0 Blocker / 0 Major** (1 Minor — a stale RUNBOOK step, self-healed per LEAD —
  plus a few Trivial test-coverage notes, all accepted-known). All 5 ADDED
  requirements + the 1 MODIFIED telemetry-backend requirement implemented
  correctly; the fail-closed Access gate verified airtight by code reading,
  unit tests, and live adversarial probing.
- Tasks: **24/24 complete** — every task in `tasks.md` marked `[x]`.

## Test Gate
- Tests: **skipped — green at `review-report.md` (reviewer-b1 independent gate on
  this exact tree).**
  - Recorded passing evidence: **13/13** vitest green in `telemetry-backend/test/`
    with **real RS256 mint/verify** signatures; live matrix clean on BOTH hosts —
    `workers.dev`: `GET /admin → 403`, `GET /admin/index.html → 403`,
    `GET /api/admin/overview → 403`, `POST / → 202`, `GET / → 405`;
    `telemetry.rasen.io`: identical incl. `POST / → 202`; leak-proofs
    (`GET /index.html → 405`, `GET /admin/../index.html → 405`, `POST /admin → 403`
    [gate runs before method handling], `/api/adminx → 405`).
  - Re-run deliberately NOT performed: telemetry-backend/ is a standalone
    Cloudflare Worker with its own test suite, NOT part of the CLI build/test
    run, and it imports nothing from `src/`. It is therefore fully isolated from
    the concurrent session's in-progress openspec→rasen CLI rename that occupies
    the rest of the working tree (which this commit does NOT touch). The
    reviewer's evidence covers exactly the telemetry-backend files delivered here.

## What Shipped
A private maintainer admin console served by the SAME telemetry Worker (routing
in `src/index.ts` splits three surfaces; not a second service):
- **`telemetry-backend/src/index.ts`** — three-surface routing: `POST /` public
  ingest (unchanged 202/400/405); `/api/admin/*` and `/admin`,`/admin/*` gated by
  a fail-closed Cloudflare Access JWT check; `run_worker_first` so the Worker
  gate runs before any static asset is served.
- **`telemetry-backend/src/access.ts`** (new) — in-Worker RS256 JWT verification
  (audience `ACCESS_AUD`, issuer `https://<ACCESS_TEAM_DOMAIN>`, JWKS from the
  team domain's `/cdn-cgi/access/certs`); fail-closed 403 on missing/invalid JWT
  or unset `ACCESS_*` config, on EVERY host including `*.workers.dev` (which does
  not pass through edge Access).
- **`telemetry-backend/src/stats.ts`** (new) — read-only aggregate stats JSON via
  the CF SQL API (`TELEMETRY_SQL_TOKEN`).
- **`telemetry-backend/admin/index.html`** (new) — single-file maintainer panel,
  served only after the JWT gate passes.
- **`telemetry-backend/wrangler.toml`** — `[assets]` `run_worker_first = true`,
  Access/SQL env wiring.
- **`telemetry-backend/README.md` + `RUNBOOK.md`** (RUNBOOK new) — admin console
  routing/auth model + operator setup steps.
- **`telemetry-backend/package.json` + `package-lock.json`** — deps for the new
  surfaces.
- **`telemetry-backend/test/`** (new) — 13 unit tests incl. real RS256 mint/verify.
- **Change artifacts** — proposal, design, tasks, notes, planning-context,
  review-report, 2 delta specs (telemetry-admin-console ADD + telemetry-backend
  MODIFIED), and this ship log. (`auto-run.json` is git-ignored run-state.)

## Operator Backfill Required (console inert until done)
The custom domain `telemetry.rasen.io` is live. The admin console is intentionally
**inert until an operator backfills** `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and
`TELEMETRY_SQL_TOKEN` per `telemetry-backend/RUNBOOK.md`. Until then every admin
path fail-closes to 403 by design — safe default.

## Scope Hygiene (EXTREME care — concurrent session active)
The working tree simultaneously holds a CONCURRENT session's in-progress phase-2
openspec→rasen rename (a `bin/openspec.js → bin/rasen.js` rename + ~100 modified
`src/**` files + root `package.json`, `scripts/pack-version-check.mjs`,
`test/commands/**`, and `openspec/changes/phase2-rasen-*/`). NONE of that is
part of this change.
- Before staging I **unstaged** the already-staged `bin/openspec.js → bin/rasen.js`
  rename (`git restore --staged`) so it cannot ride along in this commit; verified
  the index was empty afterward.
- Staged EXPLICITLY and ONLY `telemetry-backend/` (tracked mods + new files;
  `node_modules` is git-ignored) and `openspec/changes/telemetry-admin-console/`.
- Verified via `git diff --cached --stat` that EVERY staged path is under those
  two roots before committing.
- Left untouched: the entire rename working set, `openspec/handoff/`, and
  `openspec/office-hours/`.

## Deployment
N/A — local mode; no push/tag/Release. Worker code is committed; live activation
of the admin console awaits the operator env backfill (above).

## Ship-commit pollution note (shared-index race — LEAD ruling: leave as-is)
The ship commit **4b37644** contains **8 foreign files** that do NOT belong to
this change: `openspec/changes/archive/2026-07-09-phase2-rasen-readme/*` (7
files) + `openspec/specs/project-readme/spec.md`. These were slurped by a
shared-git-index race with the concurrent phase-2 (`rasen`) session, which staged
its `phase2-rasen-readme` archive into the same index between this shipper's
`git diff --cached` verification (clean, 21 files) and `git commit`. The
concurrent session then committed **1842258 "archive phase2-rasen-readme"** on
top of 4b37644 on the same `dev-harness` branch.

Content is intact, not lost — phase2-rasen-readme's archive is split across
4b37644 + 1842258. The LEAD ruled to **LEAVE 4b37644 AS-IS** (no rebase/reset/
amend/revert): rewriting it would require rebasing the concurrent session's child
commit and clobbering its in-flight work, and the branch is local/unpushed so the
mixed commit is cosmetic. Root cause: two shippers on one working tree + index +
branch — `git add`/`git commit` are not atomic against a concurrent `git add`.
Mitigation adopted for this archive commit and all subsequent commits while the
concurrent session is alive: **commit with an explicit pathspec**
(`git commit -- <paths>`), which includes only the named paths regardless of
index state.
