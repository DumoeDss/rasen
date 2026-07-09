# Review Report: ship-delivery-modes

**Reviewer:** independent verifier (author ≠ verifier)
**Date:** 2026-07-07
**Scope reviewed:** change artifacts (proposal / design / tasks / 4 delta specs) + working-tree implementation diff (`ship.ts`, `auto.ts`, `_orchestration.ts`, `review-cycle.ts`)
**Independent checks run:** `pnpm build` (clean) · `npx vitest run` on skill-templates-parity / auto / review-cycle / handoff (**57/57 green**) · `openspec validate ship-delivery-modes --strict` (valid)

---

## Findings

### F1 — Minor — No test pins the new load-bearing invariants — ✅ FIXED (verifier-confirmed 2026-07-07)
**Files:** `test/commands/ship.test.ts` (new), `test/commands/auto.test.ts`, `test/commands/review-cycle.test.ts`

**Resolution (re-reviewed, non-author):** new `ship.test.ts` + additions to `auto.test.ts` / `review-cycle.test.ts` pin every load-bearing invariant F1 listed — three-mode resolution + full precedence (explicit/PR/convention/ask), `NEVER resolve an integration base by falling back to the repository's default branch` **plus** `not.toContain` guards on the deleted blind chain (`defaultBranchRef`, `` fall back to `main` ``), commit-with-hooks (`NEVER bypass with --no-verify`), pr-only merge, the evidence gate (`skips on proof, never on hope` + surviving `Fresh-verification gate`), per-mode delivery (`deferred to the portfolio/parent level`, mode-aware ship log, `Land and Deploy (pr mode only)`), and the portfolio invariants in auto/orchestration (`**local** delivery mode`, `Single portfolio-level delivery`, `never push a half-delivered portfolio`, `evidence-based test gate`, `HEAD + working-tree dirty or clean`). Verified independently: every asserted string matches the template runtime text exactly (bold/backtick escaping included); no assertion pins volatile phrasing — all target contract-level wording whose change *should* break the test; the `not.toContain` guards are a strong regression fence against the original default-branch bug. Independent run: **43/43 green** across the three files.

*Original finding (retained for record):*

The four edited templates are **not** in the parity hash whitelist (confirmed: `EXPECTED_FUNCTION_HASHES` covers only explore/new/continue/apply/ff/sync/onboard/archive/bulk-archive/verify/propose/feedback), and there is no `ship.test.ts` at all. No assertion anywhere pins this change's new invariants: three-mode resolution, "NEVER default to the repository's default branch", the evidence-based test gate, `local` child delivery, or `_orchestration.ts` point 5 "Single portfolio-level delivery". A future edit that silently drops any of these phrases would pass CI green.

This repo has an **established norm** for exactly this situation — see the parity test's "teaches changeRoot blackboard resolution and store-scoped resume in the generated opsx:auto skill" case, which pins otherwise-unpinned auto teachings precisely because auto is not in the golden-master map.

**Recommendation:** add `toContain` pins for the load-bearing phrases (e.g. ship: `local`, `NEVER resolve an integration base by falling back to the repository's default branch`, `evidence`; orchestration: `Single portfolio-level delivery`; auto guardrail: `local delivery mode`). Non-blocking — may be a follow-up, but recommended before archive given tasks.md 3.4's regression-safety intent.

### F2 — Minor — Evidence "code unchanged" relies on inference, not a verifiable fingerprint
**Files:** `ship.ts` step (d) point 2; `review-cycle.ts` cycle-report line; `auto.ts` §5

Recorded evidence is "HEAD + working-tree dirty/clean status". The design's key claim — ship's own commit (step b) "moves HEAD but does not change code content, so it does not invalidate evidence" — cannot be confirmed from those two fields alone: a recorded `(HEAD=X, dirty)` state becoming `(HEAD=Y, clean)` after ship commits the dirty tree is indistinguishable, by HEAD+dirty-flag comparison, from a real code change. The determination therefore rests on agent narrative reasoning, not a checkable artifact.

**Mitigation already present:** the gate is explicitly conservative — "the gate skips on proof, never on hope … Missing evidence means RUN". So the ambiguous case degrades to a redundant test run (safe), not an unsafe skip. This keeps it Minor rather than a correctness defect.

**Recommendation (enhancement):** have the recorders also capture a content fingerprint (`git rev-parse HEAD^{tree}`, or `git stash create` for a dirty tree) so ship can compare tree content directly. Follow-up, not required for this change.

### F3 — Trivial — Navigator one-liner is not mode-aware
**Files:** `skills/gstack/navigator/SKILL.md:109` + `SKILL.md.tmpl:24`

Still reads "`/opsx:ship` — test, push, open the PR from the proposal." Not wrong for the common `pr` case, but no longer the whole story. Not listed in the change's Impact and it's high-level tour copy, so out of scope here. Optional touch-up.

---

## Verified clean (no defect)

- **Delta discipline (the flagged risk):** every MODIFIED requirement carries **all** original scenarios.
  - `opsx-ship-command` / Pre-Flight: verification + task + all-pass kept; "Clean git status check" intentionally transformed into "Working tree state check" (still covers detached-HEAD warning).
  - `opsx-ship-command` / Ship Execution: all 5 originals represented (merge→"merge only in pr mode", run-tests→"evidence-based test gate", fresh-verification kept, push+PR→"deliver per mode", documentation-sync kept verbatim) plus 2 added.
  - `opsx-ship-command` / Ship Log: both originals kept ("written after delivery in any mode", "updated after deployment").
  - `opsx-auto-command` / Bug Fix Pipeline: both originals kept + 1 added ("Unit-test gate evidence recorded").
  - No requirement-name collisions for the ADDED requirements in orchestration / review-cycle.
- **ship.ts internal cross-references self-consistent:** step letters a–g renumber correctly; "step 3b" (pre-flight→commit), "Step (c) merged" (d.1), "commit in (b)" (d.2), "review fixes in step (e) or lint fixes in step (b)" (f) all point at the right relettered steps. No dangling reference to the old review-diff step (d) or old push/create-PR steps (f/g).
- **Step G renumber:** grep confirms no stale `G.5`/`G.6` references. `design.md`'s "Step G.4" (shared working tree) is still accurate — point 4 is unchanged and does cover the shared-working-tree rule.
- **Four-way decompose-local consistency:** `ship.ts` local mode, `auto.ts` guardrail, `_orchestration.ts` point 5, and `opsx-orchestration` delta all agree: children commit-only, exactly one portfolio-level delivery after all complete, partial failure keeps commits local and escalates, never push a half-delivered portfolio.
- **Land-and-Deploy scoping:** correctly annotated "pr mode only" and coordinated with the ship-log Deployment section; PR Body and Land-and-Deploy requirements left untouched, matching the proposal/design (both are pr-path-only, semantics unchanged).
- **Parity:** no generated `SKILL.md` exists for ship/auto/review-cycle/orchestration; the four templates are outside the hash whitelist; `STORE_SELECTION_GUIDANCE` still present in `ship.ts`. The "store selection in every deployed skill/command" iterating tests still pass.
- **Test assertions not hollowed:** the auto/review-cycle diffs are purely additive (appended sentences + one guardrail bullet); no phrase that an existing `toContain` depends on was removed. 57/57 green independently confirmed.
- **Scope exclusions correct:** `verify-change.ts` untouched (hash-locked, static analysis, not an evidence source); `verify-enhanced.ts` / `retro.ts` carry no stale ship-contract references; `schema.yaml` change in the working tree belongs to a different change (reconcile-fusion-seams), not this one; mode resolution as an NL contract (no schema field) is a defensible design call.

---

## Verdict

**APPROVE** — 0 Blocker, 0 Major, 0 unresolved recommendation. The change is correct, internally consistent, delta-disciplined, and green on build/tests/validate; it satisfies tasks.md 3.4. **F1 is now fixed and verifier-confirmed** (43/43 green, all pins exact, no fragile assertions). F2 (evidence fingerprint) and F3 (navigator one-liner) remain intentional non-blocking follow-ups. Clear to ship.
