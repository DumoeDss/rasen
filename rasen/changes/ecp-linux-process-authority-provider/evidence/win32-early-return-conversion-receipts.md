# win32 early-return conversion receipts

Implements the fix shape proposed by `win32-early-return-triage.md` (commit e4893286): all ten
in-body platform early-returns converted to explicit vitest skip gates so skipped work reports as
SKIPPED, never as passed. The triage document itself is historical and unchanged; its "no test file
was edited" statement was true at triage time.

Execution note: the converting session was interrupted by a session limit after the edits landed;
the four files were preservation-committed unverified in `88ffc08b` ("NOT receipted"). This
document is the receipt set for that work, taken after re-verifying every site in the preserved
files. Site-by-site re-check result: all ten conversions complete and intact (11 gate lines - ten
sites plus the S1 split's second test - and 11 decision-13 comments found; zero in-body platform
early-returns remain in the four files). Nothing was left unconverted; no site refused the
mechanical conversion.

## What changed (per site, matching the triage table)

- S1 `package-ci` (was :259): SPLIT. `it.runIf(process.platform === 'win32')('refuses
  authoritative assembly on win32', ...)` keeps the POSIX-refusal throw assertion live on this
  host; `it.skipIf(process.platform === 'win32')` on the original assembly test (name unchanged)
  makes the assembly surface report skipped on win32.
- S2-S6 `package-ci` (were :459/:487/:530/:565/:674): `it.skipIf(process.platform === 'win32')`,
  guard line removed.
- S7-S8 `artifact-resolver` (were :153/:171): `it.skipIf(process.platform !== 'linux')`, guard
  line removed (skips on both win32 and darwin, as the old return did).
- S9 `provider` (was :309), S10 `publication-ledger` (was :332):
  `it.skipIf(process.platform === 'win32')`, guard line removed.
- Every converted site carries a one-line comment citing locked decision 13 (parked-provider
  subject; skipped, not passed). `package-ci:414` untouched (triage excluded it); the
  `describe.skip` files untouched.

## BEFORE / AFTER on this Windows host

Command (both runs): `pnpm exec vitest run` on exactly the four files; `dist/cli/index.js`
existence confirmed immediately before every invocation (the dist-wipe hazard gate). vitest 3.2.6.

BEFORE (measured 2026-08-07 on this host at the pre-conversion worktree, immediately before the
edits; matches the triage-era behaviour recorded at commit e4893286):

| File | Tests | Passed | Skipped |
| --- | --- | --- | --- |
| linux-process-authority-package-ci.test.ts | 10 | 10 | 0 |
| linux-process-authority-artifact-resolver.test.ts | 22 | 22 | 0 |
| linux-process-authority-provider.test.ts | 15 | 15 | 0 |
| linux-process-authority-publication-ledger.test.ts | 13 | 13 | 0 |
| Total | 60 | 60 | 0 |

AFTER (2026-08-08, this host, preserved conversion):

| File | Tests | Passed | Skipped |
| --- | --- | --- | --- |
| linux-process-authority-package-ci.test.ts | 11 | 5 | 6 |
| linux-process-authority-artifact-resolver.test.ts | 22 | 20 | 2 |
| linux-process-authority-provider.test.ts | 15 | 14 | 1 |
| linux-process-authority-publication-ledger.test.ts | 13 | 12 | 1 |
| Total | 61 | 51 | 10 |

Exactly the ten triaged sites moved from "passed (asserting nothing)" to "skipped"; the one new
test is the S1 split's win32 refusal test, which PASSES on this host. Dedicated S1 receipt:
`vitest run linux-process-authority-package-ci.test.ts -t "refuses authoritative assembly on
win32"` -> 1 passed | 10 skipped (11), with the product refusal line printed ("authoritative
assembly requires a POSIX filesystem that preserves exact 0755 mode").

## Typecheck

`pnpm exec tsc --noEmit` -> exit 0.

## Byte-pin re-verification (before and after editing)

Grepped `test/`, `src/`, `scripts/`, and `.gitattributes` for the four filenames: zero references
outside the files themselves. The guard constants checked: `FROZEN_COMMON_INPUTS` and
`LEGACY_PROCESS_CAPSULE_INPUTS` in `linux-process-authority-boundary-guards.test.ts`, and
`LEGACY_PROCESS_CAPSULE_INPUTS` in `windows-process-authority-package-ci.test.ts` - none lists any
of the four converted files, so the conversion trips no freeze guard and no rebaseline occurred.

## Whitespace gate

`git diff 2961848b 88ffc08b --check` scoped to the four test files: clean. This receipts file
verified LF-only, no trailing whitespace, single final newline.
