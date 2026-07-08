# Ship Log: fork-phase1-expert-templates

**Date:** 2026-07-08
**Mode:** local
**Branch:** dev-harness
**Commit:** 0f136d5b973eed4a3be5ac90cedb56d3a09c03b0
**Tree:** a9f386deaa95d47531cf06209cb3055237d76f13
**Status:** Committed (delivery deferred to portfolio/parent level)

> Note: the Commit/Tree above identify the content commit for this change.
> A ship log cannot embed the hash of the commit that contains it, so this log
> was finalized into the delivered `dev-harness` HEAD by a follow-up `--amend`;
> the exact delivered HEAD hash is reported to the portfolio LEAD. The recorded
> **Tree** is the content-addressed fingerprint for the test-evidence gate.

> Portfolio CHILD of the `fork-phase1` parent (A-chain). Depends on the already
> shipped+archived `fork-phase1-chrome-use-core` (A1). Per the portfolio delivery
> policy, a child ships in LOCAL mode (commit only) — no push, no PR, no tag. The
> portfolio delivers ONCE at the parent level after ALL children complete.

## Pre-Flight Results
- Verification: **pass** — `review-report.md` present; verdict **APPROVE** with
  **0 Blocker / 0 Major** (1 Minor + 2 Trivial, all in LLM-guidance prose that is
  self-correcting in use — the Minor is the QA "detect running app" port-probe
  using `document.readyState==complete`, which the agent self-corrects when it
  sees the error page). Reviewer explicitly confirmed `verify-enhanced.ts`
  untouched (no-op per task 3.3) and browse.ts frozen byte-identical.
- Tasks: **17/17 complete** — every task in `tasks.md` marked `[x]`.

## Test Gate
- Tests: **skipped — green at `review-report.md` (reviewer-a2 independent run on
  this exact tree).**
  - Recorded passing evidence for the delivered A2 delta: `pnpm build` green;
    `skill-templates-parity.test.ts` (6 tests) green with **exactly 7 regenerated
    parity hashes** (benchmark, design-consultation, design-review, navigator,
    office-hours, qa, qa-only) in BOTH maps — browse and verify-enhanced hashes
    unchanged; `skill-generation.test.ts` (38 tests, expert count still 20) green;
    `openspec validate fork-phase1-expert-templates` → valid.
  - Re-run deliberately NOT performed: the LEAD authorized citing this evidence,
    and re-running now would risk touching the working tree while sibling B2 is
    concurrently editing `src/telemetry/`, `package.json`, `pnpm-lock.yaml`, and
    telemetry tests (all explicitly excluded from this commit). The A2 test
    surface (template parity + skill-generation) is isolated from B2's files, so
    the recorded green remains valid for the delivered content — and the reviewer
    explicitly ran against this same tree while ignoring the B2 noise.

## What Shipped
The A-chain expert-template rewrite: de-brand `_shared.ts` and repoint the
browser-driving experts from browse to the chrome-use proxy (A1's foundation),
while freezing browse itself for independent removal by A3.
- **`src/core/templates/experts/_shared.ts`** — de-browsed shared constants;
  browse-specific `BROWSE_SETUP`/`SNAPSHOT_FLAGS`/`COMMAND_REFERENCE` removed
  from the shared module.
- **`src/core/templates/experts/browse.ts`** — FROZEN: inlines its own copy of
  the former shared browse constants byte-identically, so `openspec-browse` /
  `getBrowseSkillTemplate` parity hashes are unchanged (browse untouched behavior,
  ready for A3 to delete).
- **`qa.ts`, `qa-only.ts`, `design-review.ts`, `design-consultation.ts`,
  `benchmark.ts`, `office-hours.ts`, `navigator.ts`** — repointed to the
  chrome-use proxy / de-branded guidance (the 7 regenerated parity hashes).
- **`test/core/templates/skill-templates-parity.test.ts`** — parity hashes
  regenerated for exactly those 7 skills.
- **Change artifacts** — proposal, design, tasks, review-report, 1 delta spec
  (`chrome-use-expert-methodology`), and this ship log. (`auto-run.json` is
  git-ignored run-state — `.gitignore:163` — intentionally NOT committed.)

## Scope Hygiene
Staged EXPLICITLY and ONLY A2's file set (9 expert `.ts` + 1 parity test + the
change dir). Left UNSTAGED (concurrent sibling B2 or pre-existing):
`src/telemetry/index.ts`, `package.json`, `pnpm-lock.yaml`,
`test/telemetry/index.test.ts` (B2 — in review, ships separately), the other
`openspec/changes/fork-phase1*` child dirs, `openspec/handoff/`, and
`openspec/office-hours/`.

## Deployment
N/A — local mode. Delivery (push / tag / release) is deferred to the
`fork-phase1` portfolio parent once ALL children complete. Archive is run
separately as a follow-up commit.
