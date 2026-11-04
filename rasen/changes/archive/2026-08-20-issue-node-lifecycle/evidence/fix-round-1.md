# Fix round 1 — issue-node-lifecycle (review findings R1, R2, I1)

Date: 2026-08-20. Review: `evidence/review-report.md` (PASS, 0 Blocker /
0 Major / 2 Minor / 3 informational; R1+R2+I1 routed here).

## R1 (Minor, bookkeeping) — gate log §A binding-file count

- **Changed**: `evidence/affected-set-gate.log` §A. The line read "35 tests
  (30 prior + 5 new)"; corrected to "29 tests (24 prior + 5 new)" with the
  cause named in place: 35 was the DIRECTORY total (binding 29 + the
  read-only-guard file's 6) misquoted as the file count. Pre-change file had
  24 `it(` rows (reviewer verified against `git show 010dcf70`).
- **Pin**: the corrected line carries the correction note itself, so the log
  stays honest about its own history rather than silently rewriting.
- **Numbers**: no test run affected (all counts green either way; reviewer's
  independent re-run confirms 29).

## R2 (Minor, delta text + pin) — `ready` clause scoped to wanted nodes

- **Changed**:
  `rasen/changes/issue-node-lifecycle/specs/issue-status-projection/spec.md`,
  the MODIFIED "Phase derives from where the execution graph stands"
  requirement prose: "`ready` once a readable plan names at least one Change
  node" → "at least one Change node **whose work the plan still wants
  (`required` or `optional`)**". The scoping word is the whole fix; the code
  already implemented this (design D3) and was unchanged.
- **Scenario added** (title is new, no existing title touched):
  "A plan of intent nodes and only-cancelled nodes stays planning" — intent +
  cancelled-only, nothing started ⇒ `planning`, not `ready`, observation
  still on the node line.
- **Pin** (test): `test/core/issue-status/issue-status-lifecycle.test.ts`
  new row "stays planning for a plan of intent nodes and only-cancelled
  change nodes (R2 pin)" asserts phase `planning`, health `healthy`,
  progress `{0, 0}` (the stated zero-required pair), lifecycle `cancelled`
  and observation `not-started` on the cancelled node's line.
- **Numbers**: `npx vitest run test/core/issue-status/issue-status-lifecycle.test.ts
  test/core/issue-status/issue-status-projection.test.ts` → 2 files,
  **31 tests passed (9 + 22), exit 0**, after `pnpm run build` (exit 0).

## I1 (Informational, delta text) — closed reading recorded in the ADDED requirement

- **Changed**:
  `rasen/changes/issue-node-lifecycle/specs/store-issue-resources/spec.md`,
  the ADDED "Plan nodes carry a closed lifecycle vocabulary" requirement:
  added the sentence "A reason SHALL be recorded only for `cancelled` and
  `superseded` nodes — a reason authored on wanted work (`required` or
  `optional`) is refused rather than stored, because a reason explains only
  work the plan no longer wants." The reviewer graded the implemented
  behavior spec-faithful (report §2); this records that reading in the text
  so the synced truth says so explicitly. No code change; the existing test
  "refuses a reason on wanted work" already pins the behavior.

## Gates (this micro-round)

- `pnpm run build` → exit 0.
- Touched test file + projection suite solo → 31/31, exit 0 (numbers above).
- `node bin/rasen.js validate issue-node-lifecycle` → valid, exit 0.
- Fences: `git diff -- src/core/pipeline-registry/ packages/ui package.json`
  → 0 bytes.
- Scenario-title discipline re-verified by script over all four deltas vs the
  synced specs: 7 MODIFIED requirements compared, every synced title survives
  verbatim, **16 new scenarios** (15 + the R2 addition), 1 ADDED requirement,
  0 renames, 0 drops.

## Not changed (routed elsewhere or accepted)

- I2 (copy-edit-publish `reason: null` paste friction) — accepted as-is per
  design D5; no action this round.
- I3 (lifecycle-suite test 5 title says "failed" but asserts a waiting-human
  escalation) — cosmetic title nuance; the true failed-optional row lives in
  gate-lifecycle test 5. Not routed to this round; left for the reviewer's
  discretion.
