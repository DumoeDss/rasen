# Ship Log: fork-phase1-telemetry-backend

**Date:** 2026-07-08
**Mode:** local
**Branch:** dev-harness
**Commit:** d02bf7660999c9e6f6f3361a1d3fd245f7af94bb
**Tree:** dc0341f375d2d764e451f08631fb03b669d33b03
**Status:** Committed (delivery deferred to portfolio/parent level)

> Note: the values above identify the content commit for this change. Because a
> ship log cannot embed the hash of the commit that contains it, this log was
> finalized into the delivered `dev-harness` HEAD by a follow-up `--amend`; the
> exact delivered HEAD hash is reported to the portfolio LEAD. The recorded
> **Tree** is the content-addressed fingerprint used for the test-evidence gate.

> Portfolio CHILD of the `fork-phase1` parent. Per the portfolio delivery
> policy, a child ships in LOCAL mode (commit only) — no push, no PR, no tag.
> The portfolio delivers ONCE at the parent level after ALL children complete.

## Pre-Flight Results
- Verification: **pass** — `review-report.md` present; verdict **APPROVE** with
  **0 Blocker / 0 Major** (2 Minor doc/robustness notes + 1 Trivial; none block
  the change or the B2 handoff). Live behavior on the deployed Worker matches the
  documented contract.
- Tasks: **18/18 complete** — every task across the 5 sections in `tasks.md`
  marked `[x]`, including deploy + smoke tests and `openspec validate`.

## Test Gate
- Tests: **skipped — no CLI test rerun required for this diff.**
  - The delivered code is entirely under `telemetry-backend/` (a standalone
    Cloudflare Worker), which is NOT part of the CLI build or the CLI test
    suite — it is excluded from `npm pack` by the package.json `files`
    whitelist (task 1.3) and imports nothing from `src/`.
  - Behavioral evidence is live-verified, not unit-test-derived: the deployed
    Worker (`https://openspec-telemetry.ws11579.workers.dev`, Version ID
    `2076d5e9-4342-4060-817a-d47b16f0c5bb`) was smoke-tested end-to-end —
    POST valid event → **202**, GET → **405**, POST missing `distinctId` → **400**,
    malformed JSON → **400** (see `notes.md` / `tasks.md` §3).
  - `openspec validate fork-phase1-telemetry-backend` → **valid**.
  - Task 5.2 confirmed this change touches NO `src/telemetry/` or CLI
    `package.json` dependencies (the client rewrite + `posthog-node` removal are
    sibling change B2), so the CLI tree fingerprint is unchanged by this diff.

## What Shipped
New standalone Worker project + change artifacts:
- **`telemetry-backend/package.json`** — `openspec-telemetry`, private,
  `wrangler` devDep; `deploy`/`dev`/`tail` scripts.
- **`telemetry-backend/wrangler.toml`** — Worker name, `main`, account id,
  compatibility date, and the `[[analytics_engine_datasets]]` binding
  (`TELEMETRY` → `openspec_telemetry`).
- **`telemetry-backend/src/index.ts`** — `fetch` handler: POST-only (else 405),
  requires `command`/`version`/`distinctId` non-empty (else 400), optional
  `os`/`node_version`; `writeDataPoint({ blobs: [...], indexes: [distinctId] })`
  → 202; error-wrapped so ingestion never hangs the caller; never echoes payload,
  never persists IP/paths/args.
- **`telemetry-backend/README.md`** — deploy steps, payload contract, privacy
  contract, Analytics Engine blob/index mapping, and CF SQL-API read queries
  (incl. the LEAD's post-review sampling note).
- **Change artifacts** — proposal, design, tasks, notes, review-report,
  1 delta spec, and this ship log. (`auto-run.json` is git-ignored run-state
  — `.gitignore:163` `openspec/changes/**/auto-run.json` — so it is
  intentionally NOT committed, consistent with every other change in the repo.)

## Scope Hygiene
Staged EXPLICITLY and ONLY `telemetry-backend/` and
`openspec/changes/fork-phase1-telemetry-backend/`. Left unstaged (correctly),
belonging to concurrently-worked sibling changes or pre-existing work:
`src/core/**` edits, `skills/experts/chrome-use/`,
`src/core/templates/experts/chrome-use.ts`, `src/core/templates/workflows/_orchestration.ts`,
the other `openspec/changes/fork-phase1*` child dirs,
`openspec/handoff/`, and `openspec/office-hours/`.

## Handoff to B2
Sibling change `fork-phase1-telemetry-client` MUST point the rewritten
`src/telemetry/index.ts` at the live endpoint
`https://openspec-telemetry.ws11579.workers.dev` and match the field names
`command` / `version` / `distinctId` / `os` / `node_version` exactly (see
`notes.md`).

## Deployment
N/A — local mode. Delivery (push / tag / release) is deferred to the
`fork-phase1` portfolio parent once ALL children complete. Archive is NOT run
here — the LEAD triggers it separately (a sibling still reads this change's
`notes.md`).
