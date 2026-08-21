# Dogfood receipts — temp store/project pair, both directions

Fixture: a throwaway store `temp-containment` + one project repo, both under
`C:\Users\Sayo\AppData\Local\Temp\rasen-contain-4f4L\`, with the machine store/project
registries redirected via `XDG_DATA_HOME`/`XDG_CONFIG_HOME` into the same temp tree —
the persistent `issue-registry` store and the real machine registries were never read or
written. Every command ran `node bin/rasen.js` from the worktree after `pnpm build`, so
the receipts exercise the fixed `plan.ts` through the real CLI, not the test harness.

The fixture reproduces the exact input shape of the Phase 3 refusal
(`../archive/2026-08-20-issue-cross-project-execution/evidence/close-workspace-pair-refusal.json`):
`--execution-worktree <the project repository's main checkout>`.

## Direction 1 — the previously-refused shape is now applicable

`store workspace plan --store temp-containment --project b91319d7-... --target-line
line-0.2 --change containment-demo --execution-worktree <project main checkout> --json`
→ exit 0. `temp-pair-main-checkout-plan.json`: `applicable: true`, a token, and all nine
preconditions satisfied, including:

- `execution-is-linked-worktree` (satisfied) — the sibling blessing, unchanged.
- `execution-root-outside-repository` (satisfied) —
  "`...project` is the execution repository's main checkout, which a pair may
  legitimately use for execution."

The same input produced exactly one failed precondition (`execution-root-outside-repository`,
code `workspace_destination_exists`) before this change, per the Phase 3 receipt.

## Direction 2 — a genuinely nested destination is still refused

Same fixture, `--execution-worktree <project>/nested-exec` (directory created so the CLI
resolves the execution repository from it) → exit 1. `temp-pair-nested-refusal.json`:
`applicable: false`; `execution-root-outside-repository` blocker, code
`workspace_destination_exists`, nesting rationale byte-identical to the archived veto
text ("...A worktree nested in its repository shows up there as untracked content...").
Totality also reports the occupied non-worktree destination
(`execution-destination-available`) — expected, the directory exists and is not a worktree.

## Apply round-trip — the main checkout receives only its binding document

`store workspace apply --apply-plan f608435c...` → exit 0
(`temp-pair-apply.json`): `created: [<store>--containment-demo]`,
`reused: [<project main checkout>]`, `bindingState: prepared`.
`temp-pair-apply-main-checkout-state.txt` pins pre/post state around the apply:

- HEAD and symbolic ref unchanged (`98188e4e...` / `refs/heads/main`).
- `git status --porcelain` gained exactly one line: `?? .rasen/` (the pre-existing
  `?? .rasen-store/` was fixture state written by `store add-project` before the apply).
- `.rasen/planning-binding.json` present with the correct binding fact; no other new path.
- `git worktree list` still reports exactly 1 worktree in the project repository —
  no worktree created there, no ref or HEAD moved.

## Encounter recorded (pre-existing, NOT this change): claimant-alias keying

`store workspace show` for the pair failed with `workspace_project_unresolved`: the temp
fixture's project registry keys the project by its path-derived id (`project`) while the
store partition id is the minted uuid, so `resolveProjectRepositoryRoot(<uuid>)` finds no
checkout. This is follow-up candidate #5 (claimant-alias keying) from the portfolio
planning context, met here from a second angle; the plan/apply receipts above are
unaffected (an existing `--execution-worktree` resolves the repository from Git directly).
No fix attempted in this child.

## Teardown (recorded here, not as a tracked task)

The pair was torn down OUTSIDE `workspace cleanup`, per the accepted design consequence:
cleanup is all-or-nothing and never removes a main checkout, so a main-checkout-bound pair
is not cleanup-eligible (portfolio follow-up candidate, g-002/g-003 ledger). Steps:
`git worktree remove --force <store>--containment-demo` (force only because the planning
marker is untracked run state in a scratch fixture), `git branch -D change/line-0.2/
b91319d7-.../containment-demo`, then `rm -rf` of the whole temp tree. Registries, store,
project, worktree, and branch are gone; nothing persisted outside the temp root.
