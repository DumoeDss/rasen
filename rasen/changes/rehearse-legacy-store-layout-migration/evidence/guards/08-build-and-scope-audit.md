# Build, validate, and diff-scope audit (tasks.md 5.3)

## Compile

- `npx tsc --noEmit -p tsconfig.json` — **clean** on the repo tree, run after
  every edit in this change.
- `node build.js` — **clean**, twice, in `<temp>/pinned-fixed` (a `git archive
  HEAD` extract carrying this change's five src files and nothing else). That is
  a full `tsc` + ProcessCapsule build of exactly this change's code, and the
  resulting CLI is what produced `evidence/rehearsal/04-postfix/`.
- A repo-level `pnpm run build` is **deliberately not run**: `build.js:17-20`
  deletes the shared `dist/` before compiling, and the LEAD granted a sibling an
  exclusive build window. Deferred to ship time on a quiet tree, alongside the
  full-suite obligation in `07-what-was-run-and-what-was-not.md`. The two pinned
  builds above are the same compiler over the same source, so nothing about this
  change's compilability is unverified.

## Validate

`rasen validate rehearse-legacy-store-layout-migration` → `Change
'rehearse-legacy-store-layout-migration' is valid`, re-run after the last spec
delta edit.

## Diff scope

This change touches exactly six tracked files plus one new test file and its own
change directory:

```
src/commands/store-migrate-layout.ts        preview/apply rendering + refusal path
src/commands/store-migration.ts             O5: three human-path rethrows -> emitFailure
src/core/store/layout-migration/plan.ts     the seam fix, plus O8/O9 refusal texts
src/core/store/layout-migration/types.ts    'store-metadata' kind, two blocked reasons
src/core/store/layout-migration/index.ts    export planGateError
vitest.config.ts                            CI partition weight for the new suite
test/core/store/layout-migration-empty-store.test.ts    (new)
```

## Sibling-owned files

`git diff` reports `src/core/store-planning/internal/{resolver,dependencies}.ts`,
`src/core/store-planning/testing.ts`, `src/core/store/identity.ts`, and
`src/core/store/workspace/{plan,apply}.ts` as modified. **None of that is this
change's work** — the repo working tree is shared with two in-flight sibling
changes that own those seams.

`git diff` cannot attribute authorship in a shared tree, so the proof is
constructive rather than textual: `<temp>/pinned-fixed` was built from `git
archive HEAD` plus **only the six files listed above**, and in that tree the
complete guard suite passes 19/19 and all ten pre-existing `layout-migration-*`
suites pass. A change that needed anything from a sibling-owned file could not
build, let alone pass, in a tree where those files are at their committed state.

## The real store

Untouched, verified before the first step and after teardown:
`git status --porcelain` unchanged, HEAD unchanged, both file digests unchanged,
the machine store registry digest unchanged, and all seven files under the
machine coordination root byte-identical. See
`evidence/rehearsal/00-harness/06-teardown.txt`.
