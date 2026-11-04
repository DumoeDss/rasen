# Tasks: issue-workspace-containment-fix

## 1. Plan-side containment exemption

- [x] 1.1 In `src/core/store/workspace/plan.ts`, the `${side}-root-outside-repository` precondition
  loop: exempt the blessed case — execution side, `executionSide.facts.linked === false` (the
  side-planner's main-checkout finding, the same fact `execution-is-linked-worktree` keys on), and
  `samePath(root, repositoryRoot, flavor)` — from the veto; the satisfied precondition for that
  case carries the blessing sentence ("…the execution repository's main checkout, which a pair may
  legitimately use for execution."), and the strictly-inside/outside details stay byte-identical
  to today (design D1–D4). Do NOT touch `isContainedIn` in `identity.ts`.
- [x] 1.2 Extend the loop's comment to state the discrimination: equality with the repository
  root on the blessed execution side is the designed main-checkout reuse, not nesting; the veto's
  rationale (untracked content inside the checkout; cleanup reaching inside it) holds only for a
  strictly-inside path; the planning side keeps the equality veto (design D3).

## 2. Tests

- [x] 2.1 Strengthen `test/core/store/workspace-plan.test.ts` "permits the project main checkout
  as the execution side": assert `plan.applicable === true`, `plan.blockers` empty, and
  `execution-root-outside-repository` satisfied with the blessed detail — closing the blind spot
  that let the contradiction ship (the old test asserted only the sibling precondition).
- [x] 2.2 Cover the alias spelling: a win32-flavored (or windows-paths suite) plan naming the main
  checkout through a case-alias / trailing-separator spelling still hits the exemption — per the
  delta scenario's Windows clause.
- [x] 2.3 No-regression guards, unchanged: the nested-refusal test
  (`nested-planning` / `nested-execution` inside their repository checkouts) passes as-is, and the
  equal-inputs pinned-token tests stay green — proving normal-case plan bytes (and the plan id)
  are unchanged (design D5).
- [x] 2.4 Apply round-trip per the delta scenario "A main-checkout execution root receives only
  its binding document": with the main checkout as the reused execution root, apply writes ONLY
  `<root>/.rasen/planning-binding.json` there — no worktree created, no ref or HEAD moved.

## 3. Dogfood receipts (temp fixture, both directions)

- [x] 3.1 On a TEMP store + project pair (temp directories only; the persistent `issue-registry`
  store stays read-only), run `store workspace plan --execution-worktree <project main checkout>`
  and capture the JSON receipt into the change's `evidence/`: `applicable: true`, every
  precondition satisfied, containment finding naming the main-checkout blessing.
- [x] 3.2 Same fixture, `--execution-worktree <path strictly inside the project checkout>`:
  capture the refusal receipt (`execution-root-outside-repository` blocker, code
  `workspace_destination_exists`, nesting rationale) into `evidence/`.
- [x] 3.3 Apply the applicable plan on the temp fixture; capture that the only write inside the
  main checkout is the execution association document; then remove the temp fixture (record the
  teardown in the receipt note, not as a tracked task).

## 4. Validation

- [x] 4.1 Focused suites green locally (`workspace-plan`, workspace apply/cleanup suites,
  `workspace-windows-paths`, `workspace-cli`), then the full local suite with honest failure
  reporting (enumerate every failure; CI remains the authoritative gate, including the Windows
  leg — this change is path-sensitive).
  <!-- LEAD bookkeeping 2026-08-21: named workspace set 106/106 exit 0 (plan 24/cleanup 26/apply 19/windows-paths 23/cli 14) + trio+locale 68/68 exit 0 + fences 0 bytes (implementer interim, real codes); store-family leg delegated to the verify reviewer's independent re-run. -->
- [x] 4.2 `rasen validate` the change, and confirm by eye that both delta requirement headers
  match `rasen/specs/store-planning-worktree-bindings/spec.md` titles exactly and existing
  scenario titles are unchanged (validate does not apply deltas; the archive-time sync is the
  closure proof).
