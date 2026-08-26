# Verification scope (tasks.md 5.2) — what ran, what did not, and why

## What did NOT run: the full 693-file suite

Deferred by LEAD decision, not by omission, and recorded here as an **open
obligation for ship time on a quiet tree**. Three properties of this machine made
a full run structurally unattributable today, all of them measured rather than
assumed:

1. **`dist/` is shared and `build.js:17-20` deletes it before compiling.**
   `test/helpers/run-cli.ts:171-178` runs `pnpm run build` on first use, so any
   agent's build during a run makes every `runCLI` suite fail on module
   resolution rather than on behavior. This was observed directly during this
   change: `node bin/rasen.js` died with
   `ERR_MODULE_NOT_FOUND dist/cli/index.js` mid-rehearsal.
2. **`%TEMP%` held 1332 leftover `rasen-*` fixture directories** from concurrent
   agents, which produces EPERM/EBUSY on cleanup across unrelated files. (None of
   the 1332 were from this change's suite; its fixtures tear down in `afterEach`.)
3. Several suites spawn subprocesses on the 30s default timeout, which passes
   solo and fails under parallel load — where a timeout then reads as a broken
   assertion rather than as a timeout.

An honest stated limitation is worth more than a green produced under those
conditions.

## What DID run

All of it against **`<temp>/pinned-fixed`**: a `git archive HEAD` extract of
commit `9f9f68cf` plus **only this change's five src files**, with its own
`dist/` and `node_modules` junctioned. Nothing any sibling builds or edits can
reach that tree, which is what makes these numbers attributable at all.

### One parallel invocation, 14 files, default worker count

The new guard suite alongside ten heavyweight real-git neighbours plus three
non-sibling store suites — so task 4.3's "green alongside heavyweight neighbours,
not just solo" is measured rather than claimed:

```
test/core/store/layout-migration-empty-store.test.ts      (this change)
test/core/store/layout-migration-apply-recovery.test.ts
test/core/store/layout-migration-catalog-receipt.test.ts
test/core/store/layout-migration-doctor.test.ts
test/core/store/layout-migration-inventory.test.ts
test/core/store/layout-migration-mapping.test.ts
test/core/store/layout-migration-module.test.ts
test/core/store/layout-migration-plan-gates.test.ts
test/core/store/layout-migration-provenance.test.ts
test/core/store/layout-migration-scene-bridge-e2e.test.ts
test/core/store/layout-migration-windows-paths.test.ts
test/core/store/store-query-lock-free.test.ts
test/core/store/bootstrap-obtain.test.ts
test/commands/store-aggregate-cli.test.ts
```

Result: **2 failed | 242 passed | 1 skipped (245)** across 14 files in 449.83s.
Both failures were a defect in this change's own test, described in
`05-stale-text-sweep.md` and fixed; every pre-existing suite passed.

### Suites deliberately excluded

`src/core/store-planning/*` and `store/identity*` (sibling A's seam) and
`src/core/store/workspace/*` (sibling B's). Both siblings had uncommitted work in
those files throughout; a failure there would have told this change nothing.

## Attribution of failures seen outside that set

An earlier full-suite attempt, before the LEAD's decision, surfaced
`test/commands/store-issue-status-cli.test.ts`. Rather than guess, it was re-run
against `<temp>/pinned` — the committed tree with **no** uncommitted work of any
kind — where `degrades to a labelled visibility-none answer from an unrelated
directory` still fails. Pre-existing, not attributable to this change. Recorded
in `06-committed-tree-baseline.txt`.
