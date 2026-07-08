# Ship Log: fork-phase1-chrome-use-core

**Date:** 2026-07-08
**Mode:** local
**Branch:** dev-harness
**Commit:** e6aa9853641463d9e7c4af2fa9f15a259c2d2433
**Tree:** b406d39c24d190628c2292b8ca34cf5388ffda42
**Status:** Committed (delivery deferred to portfolio/parent level)

> Note: the Commit/Tree above identify the content commit for this change.
> A ship log cannot embed the hash of the commit that contains it, so this log
> was finalized into the delivered `dev-harness` HEAD by a follow-up `--amend`;
> the exact delivered HEAD hash is reported to the portfolio LEAD. The recorded
> **Tree** is the content-addressed fingerprint for the test-evidence gate.

> Portfolio CHILD of the `fork-phase1` parent (A-chain foundation). Per the
> portfolio delivery policy, a child ships in LOCAL mode (commit only) — no push,
> no PR, no tag. The portfolio delivers ONCE at the parent level after ALL
> children complete.

## Pre-Flight Results
- Verification: **pass** — `review-report.md` present; verdict **APPROVE** with
  **0 Blocker / 0 Major** (2 Minor + 3 Trivial/observation, all design-accepted
  or low-impact known caveats — chiefly: the four new proxy endpoints
  (`/snapshot` `/perf` `/viewport` `/responsive`) have no automated test and live
  CDP smoke was blocked in this environment because the *unmodified baseline*
  `/new`/`/targets` hang identically on the discovered debug port, i.e. the
  blocker is upstream of the new code; endpoints are `node --check`-clean and
  follow the working `/resources`/`/screenshot` CDP precedents exactly).
- Tasks: **all complete** — every task across the 5 sections of `tasks.md`
  marked `[x]`, including the sidecar-filter fix, faithful vendoring, the four
  endpoints, expert-skill registration, and install-path verification.

## Test Gate
- Tests: **skipped — green at `review-report.md` (reviewer-a1 independent
  verification on this exact A1 working tree).**
  - Recorded passing evidence for the delivered A1 delta:
    `npx vitest run test/core/shared/skill-generation.test.ts` → **38 passed**
    (covers the `isSidecarFile` `.mjs`/`.js` admission + `SKILL.md`/`.tmpl`
    exclusion added by task 1.3); `npx tsc --noEmit` → **exit 0** (chrome-use.ts
    compiles; all 42 templates construct); `node --check` clean on the vendored
    `.mjs` scripts; byte-diff vendoring audit; `openspec validate
    fork-phase1-chrome-use-core` → green.
  - Re-run deliberately NOT performed: the LEAD authorized citing this evidence,
    and a re-run now would (a) test unchanged A1 source and (b) risk touching the
    working tree while sibling B2 is concurrently editing `src/telemetry/` +
    `package.json` (explicitly excluded from this commit). The A1 test surface
    (`skill-generation.test.ts`) is isolated from B2's files, so the recorded
    green remains valid for the delivered content.

## What Shipped
Foundation of the A-chain (browse → chrome-use). New + modified files:
- **`src/core/shared/skill-generation.ts`** — `isSidecarFile` extended to admit
  `.mjs`/`.js` executable sidecars (keeping `SKILL.md`/`.tmpl` guards); chrome-use
  registered in `getSkillTemplates` `expertSkills` (`dirName`
  `openspec-chrome-use`, `workflowId` `chrome-use`).
- **`src/core/templates/experts/chrome-use.ts`** (new) — self-contained
  `getChromeUseSkillTemplate()` (`openspec:chrome-use`) inlining its own SETUP +
  curl endpoint reference; does NOT import browse `_shared.ts`.
- **`src/core/templates/experts/index.ts`**, **`skill-templates.ts`** — export /
  re-export wiring for the new template.
- **`skills/experts/chrome-use/`** (new tree) — vendored `scripts/cdp-proxy.mjs`
  (with the four new endpoints `/snapshot` `/perf` `/viewport` `/responsive`
  added to the handler chain + 404 help), `scripts/check-deps.mjs`,
  `scripts/match-site.mjs`, `references/cdp-api.md`. `references/site-patterns/`
  intentionally NOT vendored (personal browsing data).
- **`test/core/shared/skill-generation.test.ts`** — sidecar-admission assertions
  for `.mjs`/`.js` (task 1.3).
- **Change artifacts** — proposal, design, tasks, review-report, 1 delta spec
  (`chrome-use-integration`), and this ship log. (`auto-run.json` is git-ignored
  run-state — `.gitignore:163` — intentionally NOT committed.)

## Scope Hygiene
Staged EXPLICITLY and ONLY A1's file set. Left UNSTAGED (belonging to concurrent
sibling work or pre-existing): `src/telemetry/**` and `package.json` /
`pnpm-lock.yaml` (sibling B2, actively editing), `_orchestration.ts`
(pre-existing), the other `openspec/changes/fork-phase1*` child dirs,
`openspec/handoff/`, and `openspec/office-hours/`.

## Deployment
N/A — local mode. Delivery (push / tag / release) is deferred to the
`fork-phase1` portfolio parent once ALL children complete. Archive is run
separately as a follow-up commit.
