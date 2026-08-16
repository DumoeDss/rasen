# Task 5.2 gate record — canvas-multi-selection

Run 2026-08-17 in the `canvas-ir-compiler` worktree (branch
`feat/canvas-gesture-ir-compiler`, base `74568906`, no local commits — apply
stage owns no commits, so the frozen-path check is against the working tree).

## IR frozen

- `git status --porcelain -- src/core/pipeline-registry/` → **empty**
  (no working-tree modifications under the frozen path).
- `git diff 74568906 -- src/core/pipeline-registry/ --stat` → **empty**
  (no committed divergence from the portfolio base either — the worktree
  branch carries no commits touching it).

## `V2_BODY_PALETTE_KINDS` unchanged

- `packages/ui/src/canvas/draft.ts:704`:
  `export const V2_BODY_PALETTE_KINDS: readonly V2EditableNodeKind[] = ['AtomicStage'];`
  — still exactly `['AtomicStage']`; this change did not touch it.

## No `legacyRuntimeOwner` stamps

- `grep -rn legacyRuntimeOwner packages/ui/src/canvas/ packages/ui/test/canvas/draft.test.ts`
  hits only the PRE-EXISTING doc comment on `spliceConditionOntoConnection`
  (`draft.ts:1471`, "ONE deliberate omission: `legacyRuntimeOwner` is never
  written"). No code path writes the field; this change synthesizes no nodes
  at all (selection + deletion only).
- No new test asserts that `legacyRuntimeOwner` stamps were added — the
  round-one `not.toHaveProperty('legacyRuntimeOwner')` guards remain in
  `pipeline-canvas-page.test.tsx` and stayed green in the full-suite run
  (67 files / 764 tests).

## Suite citation (task 4.3, recorded here for completeness)

- `pnpm --dir packages/ui exec vitest run` → **67 files / 765 tests, all
  passed** vs the 67 files / 743 tests baseline (+22 new: 12 model in
  `draft.test.ts`, 10 component in `pipeline-canvas-page.test.tsx`; zero
  regressions). The count moved from 764 to 765 when the task 5.1
  real-browser check exposed a member+pair deletion order artifact and a
  pairs-first regression test was added to `removeV2Nodes`.
- Invocation note: the handoff's `pnpm exec vitest run --config
  packages/ui/vitest.config.ts` (from repo root) resolves the config's
  `test/**` include against the REPO root on this machine and runs the root
  suite instead (verified: it was executing `store membership provider`
  tests). The CI-canonical `pnpm --dir packages/ui` form
  (`.github/workflows/ci.yml:156`, `release.yml:93`) is what produces the
  real UI-suite count and is what was used.
