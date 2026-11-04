# POSIX generalisation is a rename-only move - equivalence receipt

Tasks 2.1, 2.2, 2.3. Provenance: Windows host, repo worktree
`OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle`, branch
`wip/ecp-shared-bounded-loop-lifecycle-resume`. Baseline commit for the darwin
source: `b3edf5bc9254499f28ef4d81dbe0c93426c45219`.

## Why a diff and not a reading

design.md D2 requires the moved module to be "behaviour byte-for-byte
equivalent". A human reading of two 500-line files does not establish that, and
"the tests still pass" only establishes that the tests still pass. The receipt
below is mechanical: apply exactly the four agreed rename substitutions to the
OLD file as stored in the commit, then diff the result against the NEW file. Any
behavioural edit - a changed bound, a flipped condition, a dropped branch -
appears as a hunk.

## The substitution set (the entire permitted delta)

| From | To |
| --- | --- |
| `DARWIN_BEST_EFFORT_DECLARATION` | `POSIX_BEST_EFFORT_DECLARATION` |
| `DarwinBestEffortProcessScopeOptions` | `PosixBestEffortProcessScopeOptions` |
| `createDarwinBestEffortProcessScope` | `createPosixBestEffortProcessScope` |
| `macOS best-effort scope` (error-message prefix, 6 sites) | `POSIX best-effort scope` |

## Command

```sh
git show b3edf5bc:src/core/session-host/process-capsule/darwin-best-effort-scope.ts | sed \
  -e 's/DARWIN_BEST_EFFORT_DECLARATION/POSIX_BEST_EFFORT_DECLARATION/g' \
  -e 's/DarwinBestEffortProcessScopeOptions/PosixBestEffortProcessScopeOptions/g' \
  -e 's/createDarwinBestEffortProcessScope/createPosixBestEffortProcessScope/g' \
  -e 's/macOS best-effort scope/POSIX best-effort scope/g' \
  > renamed-darwin.ts
diff -u renamed-darwin.ts src/core/session-host/process-capsule/posix-best-effort-scope.ts
```

## Output (complete, unedited)

```
--- renamed-darwin.ts
+++ src/core/session-host/process-capsule/posix-best-effort-scope.ts
@@ -21,6 +21,14 @@
   type TerminationReceipt,
 } from '../process-scope.js';

+/**
+ * Declared best-effort process scope for POSIX hosted sessions - one
+ * implementation shared by darwin and linux. Every mechanism here is
+ * POSIX-generic: a detached spawn creates a new session (and therefore a new
+ * process group whose id equals the leader pid), cancel addresses the whole
+ * group, and escalation is keyed on whole-group emptiness.
+ */
+
 const DEFAULT_POLL_INTERVAL_MS = 25;
 const DEFAULT_FINAL_OBSERVATION_MS = 2_000;
 const DEFAULT_CONTROL_TIMEOUT_MS = 10_000;
```

One hunk, additive, comment-only. The cancel protocol, the three bound constants,
the whole-group emptiness poll, the escalation condition, the frozen declaration,
every receipt shape, and both terminal paths are textually identical after the
renames. Task 2.2's "no code path can widen either flag" therefore holds by
construction: the constant and its `Object.freeze` sit inside the unchanged
region.

## No shim (task 2.1)

```
$ grep -rn "darwin-best-effort-scope\|createDarwinBestEffortProcessScope\|DARWIN_BEST_EFFORT_DECLARATION" src/ test/ --include=*.ts
(none)

$ git log --oneline --diff-filter=D -- src/core/session-host/process-capsule/darwin-best-effort-scope.ts
88ffc08b wip(ecp7): preserve interrupted cutover + skipIf work -- NOT receipted
```

The old module is deleted, not re-exported. This is the point of D2: the two
source-scan guards read the module file's source text, and a two-line re-export
shim would satisfy both guards while asserting nothing about the real
implementation.

## Source-scan guards repointed (task 2.3)

```
$ grep -n "posix-best-effort-scope.ts" test/core/session-host/darwin-best-effort-scope.test.ts
401:      path.join(repoRoot, 'src/core/session-host/process-capsule/posix-best-effort-scope.ts'),
493:      path.join(repoRoot, 'src/core/session-host/process-capsule/posix-best-effort-scope.ts'),
```

Line 401 is the "no `state: 'closed'`, no `'scope-empty'`, no proven emptiness"
guard; line 493 is the "no reattach or identity revalidation" guard. Both now
read the moved module. Receipt (e) in `mutation-receipts.md` proves the repointed
guard still fails against a real proven-emptiness emission - without that, a
repointed guard reading a file it no longer understands would be indistinguishable
from a guard that passes vacuously.

## Test-filename decision

The three exercising files keep their `darwin-*.test.ts` names (D2) so the macOS
change's evidence trail keeps resolving. A header comment in
`darwin-best-effort-scope.test.ts` records that the module under test is now the
shared POSIX one.

## Regression run

```
$ npx tsc --noEmit
(no output, exit 0)

$ npx vitest run test/core/session-host/darwin-best-effort-scope.test.ts \
    test/core/session-host/darwin-declaration-gated-release.test.ts \
    test/core/session-host/darwin-live-close-terminal.test.ts
 ✓ test/core/session-host/darwin-best-effort-scope.test.ts (17 tests) 97ms
 ✓ test/core/session-host/darwin-live-close-terminal.test.ts (5 tests) 961ms
 ✓ test/core/session-host/darwin-declaration-gated-release.test.ts (8 tests) 1917ms

 Test Files  3 passed (3)
      Tests  30 passed (30)
```

`dist/cli/index.js` was confirmed present before the vitest invocation (the
setup file rebuilds - and `rmSync`s - `dist/` when it is missing).
