# Ship Log: fork-phase1-browse-removal

**Date:** 2026-07-08
**Mode:** local
**Branch:** dev-harness
**Commit:** 52af8e208d14c657923745eaf11b8df3ed31b0d1
**Tree:** e4327b178f99cb0aa7525f9c3943257041bae16f
**Status:** Committed (delivery deferred to portfolio/parent level)

> Note: the Commit/Tree above identify the content commit for this change.
> A ship log cannot embed the hash of the commit that contains it, so this log
> was finalized into the delivered `dev-harness` HEAD by a follow-up `--amend`;
> the exact delivered HEAD hash is reported to the portfolio LEAD. The recorded
> **Tree** is the content-addressed fingerprint for the test-evidence gate.

> Portfolio CHILD of the `fork-phase1` parent (A-chain, final A step). Depends on
> `fork-phase1-expert-templates` (A2, which froze browse.ts for clean removal).
> Per the portfolio delivery policy, a child ships in LOCAL mode (commit only) —
> no push, no PR, no tag. The portfolio delivers ONCE at the parent level after
> ALL children complete.

## Pre-Flight Results
- Verification: **pass** — `review-report.md` present; verdict **APPROVE — clean
  removal, all gates green, ZERO findings** (0 Blocker / 0 Major / 0 Minor). The
  reviewer confirmed the chrome-use expert is still fully registered across all 4
  hops, the parity-file diff is browse-row deletions only (5 `-` lines, zero `+`
  — no other expert hash re-pinned), and the expert count dropped 20 → 19.
- Tasks: **19/19 complete** — every task in `tasks.md` marked `[x]`.

## Test Gate
- Tests: **skipped — green at `review-report.md` (reviewer-a3 full independent
  gate on this exact tree).**
  - Recorded passing evidence: `pnpm build` green; the vitest trio
    (`skill-generation.test.ts` + `skill-templates-parity.test.ts` +
    `skill-sidecar-install.test.ts`) **44/44** with expert count now **19**
    (asserts 22 workflow + 19 expert = 41 total); `pnpm install
    --frozen-lockfile` consistent with **playwright fully absent**; `openspec
    validate` valid.
  - Re-run deliberately NOT performed: the LEAD authorized citing this evidence.
    A3's diff (browse deletion + count decrements) IS the only uncommitted content
    now, so this commit's tree matches the tree reviewer-a3 verified.

## What Shipped
Retire the vendored `browse` tool now that chrome-use (A1) is the browser-driving
expert and the experts were repointed (A2) with browse.ts frozen.
- **`browse/` (entire tree deleted)** — SKILL.md(.tmpl), bin/, scripts/, src/,
  test/ + fixtures. The bun-compiled binary source and its Playwright-backed
  server are gone.
- **`skills/experts/browse/` (entire tree deleted)** — the vendored browse skill
  sidecars.
- **`src/core/templates/experts/browse.ts` (deleted)** — the frozen browse expert
  template.
- **`src/core/templates/experts/index.ts`, `skill-templates.ts`,
  `src/core/shared/skill-generation.ts`** — browse import / re-export /
  registration removed (chrome-use registration untouched; expert count 20 → 19).
- **`package.json`** — Playwright dropped from `optionalDependencies` (only the
  removed browse tool used it).
- **Tests** — `skill-generation.test.ts` (count decrements + removed the moot
  `copySkillSidecars('browse')` skip test), `skill-templates-parity.test.ts`
  (browse rows deleted), `skill-sidecar-install.test.ts`.
- **`docs/grill-gstack-absorption.md` + `docs/zh/` mirror** — updated to reflect
  browse removal.
- **Change artifacts** — proposal, design, tasks, review-report,
  `handoff/implementer-a2-retired.md`, 1 REMOVED delta spec (browse-integration),
  and this ship log. (`auto-run.json` is git-ignored run-state — `.gitignore:163`
  — intentionally NOT committed.)

## Scope Hygiene
Staged EXPLICITLY and ONLY A3's file set (browse/ + skills/experts/browse/ +
browse.ts deletions, the 3 registration sources, package.json, the 3 test files,
the 2 docs files, and the change dir). Left UNSTAGED (untracked siblings /
pre-existing): `openspec/changes/fork-phase1/`,
`openspec/changes/fork-phase1-release-prep/`, `openspec/handoff/`, and
`openspec/office-hours/`.
- Note: `pnpm-lock.yaml` shows NO diff in the working tree — Playwright's removal
  from `optionalDependencies` did not alter the lockfile content here — so there
  is nothing to stage for it (the reviewer's `--frozen-lockfile` check already
  confirmed the lockfile is consistent with playwright absent).

## Deployment
N/A — local mode. Delivery (push / tag / release) is deferred to the
`fork-phase1` portfolio parent once ALL children complete. Archive is run
separately as a follow-up commit (it retires the browse-integration capability
via a REMOVED delta → the main-spec directory is deleted).
