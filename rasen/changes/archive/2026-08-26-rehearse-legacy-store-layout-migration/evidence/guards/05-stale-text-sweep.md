# Stale refusal/fix texts after the apply-gate fix (tasks.md 4.5)

## Changed

| Text | Was | Now |
|---|---|---|
| `planGateError`, zero-blocker branch (`plan.ts`) | `There is nothing to migrate: no flat planning content was inventoried for this ref.` | **Removed.** With `applicable = blockers.length === 0`, a zero-blocker plan is applicable, so this branch could only ever be reached by a plan that was applicable when stored. `planTokenObstruction` answers the cases that genuinely have no blocker to name (no Store identity, no ref, no commit). |
| `planGateError` fix text | `Resolve every listed item — the mapping file is the only escape hatch; there is no --force and no partial migration.` | Unchanged when every blocker is `unresolved`. When any blocker is `blocked` — the Store-identity block is — it now reads `Follow the repair named for each listed item; ... The mapping file resolves unresolved ownership only, never a blocked item.` The old text sent an operator holding an identity-less Store to the mapping file, which can do nothing for it. |
| `unresolved('unrecordable-identity')` reason text (`plan.ts`) | `the named project id fails the v2 portable identifier contract` | `an id required to address the layout v2 destination fails the portable identifier contract`, plus a detail naming which id — the owner project id, or the item name. |
| `unresolved('non-member-owner')` repair (`plan.ts`) | `Declare changes.<name>.project in the mapping file.` | When the item RECORDS the non-member identity, the repair names making that project a member instead, and says why the mapping file cannot be used. |
| `renderPlan` readiness line (`store-migrate-layout.ts`) | Read from `plan.applicable` alone | Reads `plan.applicable && plan.token !== undefined`. The planner now reports every apply-token precondition as a blocker, so the two agree; the token is read anyway, because announcing readiness a token cannot back is the exact defect this change closed. |
| `--apply` with no token (`store-migrate-layout.ts`) | Reprinted the preview and set exit 1 | Emits `planGateError` through the normal `fail()` path, so the run has a code, a message, and a fix. With every token precondition now a reported blocker, that error always has blockers to enumerate. |
| `runAdopt` / `runRelocate` / `runHomePrune` human path (`store-migration.ts:136`, `:343`, `:397`) | `throw error`, which escaped to `runCli()` (no top-level catch) and reached the user as a raw Node unhandled-rejection dump naming `dist/` paths | `emitFailure(options.json, {}, error, '<code>')`, the same shared failure contract the neighbouring `runEject` already used and documented. Adapter-level only: no global catch was added, no command's behavior or error contract changed. The now-unused local `failJson` helper was removed. |

## Checked and correct as-is, because of the fix

| Text | Why it is now accurate |
|---|---|
| `legacy_flat_store_requires_migration` fix (`layout-write-guard.ts:246`): `Run 'rasen store migrate-layout <id>' to migrate this Store, then retry.` | Before the fix this named a command that refused an empty Store, closing the loop. It now completes. Verified against a real disposable copy of the real store in `evidence/rehearsal/04-postfix/` steps 01 -> 02 -> 04 -> 07. **No edit needed.** |
| `migration_run_missing` fix (`module.ts`): `Run 'rasen store migrate-layout <store-id>' to produce a plan first.` | Same reason. |

## Sweep of tests asserting the changed strings

- `grep -rn "no flat planning content was inventoried" src/ test/` — no hits outside the removed branch.
- `grep -rn "nothing to migrate" src/ test/` — every hit belongs to `work migrate`, an unrelated feature.
- All ten pre-existing `layout-migration-*` suites: 172 passed, 1 skipped, 0 failed (`04-existing-suites-green.txt`).


# Correction to an earlier measurement in this directory

The first pre-fix red run of the invariant table reported 15 failed / 4 passed.
**Two of those 15 were red for a defect in the TEST, not in the code**: the two
member-less shapes (`empty Store`, `empty Store with no permanent identity`)
seeded no member project yet still wrote a mapping declaring a target line for
`elftia`, and `validateMappingAgainstInventory` correctly refuses a target-line
declaration naming a non-member. Those two cases never reached the invariant they
exist to assert, on either side of the fix.

Caught by running the suite alongside heavyweight neighbours rather than solo --
not because parallelism caused it (it is deterministic), but because that run was
the first execution of the corrected suite against the post-fix tree, where a
failure could not be mistaken for the defect being measured.

Fixed by planning the member-less shapes with no mapping file at all. Both sides
were then re-measured with the corrected test, and the replacement numbers are
the ones recorded in `02-prefix-red-run-full-suite.txt` and
`03-postfix-green-run.txt`. The superseded numbers are not cited anywhere else.
