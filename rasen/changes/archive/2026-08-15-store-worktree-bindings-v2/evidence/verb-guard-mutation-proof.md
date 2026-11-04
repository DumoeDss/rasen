# Task 4.3 — Git verb source guard, mutation-proved

Task 4.2 (`test/core/store/workspace-git-verb-guard.test.ts`) asserts that
`src/core/store/workspace/dependencies.ts` names only the closed verb set
(`GIT_WRITE_VERBS = ['worktree']` plus the fixed read-verb list) anywhere in
the workspace Module. The guard is a source scan, so its own discrimination
is the whole question — a guard never observed to fail is not evidence. This
records the guard actually failing, closed, and passing again.

## Pristine state

`sha256sum src/core/store/workspace/dependencies.ts`:

```
6ad75415bbc0e9718295ebb40e075969ae70c35d7057fc6f8b9fd2b6c0b5ff59
```

Baseline solo run, `test/core/store/workspace-git-verb-guard.test.ts`:
12 passed (12), 0 failed.

## Mutation

Inserted a forbidden verb (`reset`) into the adapter, as dead code guarded by
a runtime-false condition so it can never actually spawn `git reset` even if
something imported it — the point is to prove the SOURCE guard sees the
literal, not to exercise a real reset:

```ts
function nonEmptyLines(stdout: string): string[] {
```
became
```ts
/** MUTATION-PROOF (task 4.3): forbidden verb, never called, must be reverted. */
async function __mutationProofForbiddenVerb(cwd: string): Promise<void> {
  if (Date.now() < 0) {
    await spawnGit(cwd, ['reset', '--hard']);
  }
}

function nonEmptyLines(stdout: string): string[] {
```

## RED

Same command, same file, mutated:

```
FAIL test/core/store/workspace-git-verb-guard.test.ts > workspace Git verb source guard > permits only the closed verb set anywhere under the workspace Module
AssertionError: forbidden Git verbs found:
src/core/store/workspace/dependencies.ts: 'reset': expected [ Array(1) ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "src/core/store/workspace/dependencies.ts: 'reset'",
+ ]
```

The guard named both the file and the verb, exactly as the task text
requires. One collateral failure also fired, expected and not a defect:
`fails when a sibling Git-spawning module is imported, in the shape a
maintainer would write` re-scans every real workspace source file (including
the now-mutated `dependencies.ts`) as part of its own fixture, so it picked
up the same offender:

```
FAIL test/core/store/workspace-git-verb-guard.test.ts > workspace Git verb source guard > fails when a sibling Git-spawning module is imported, in the shape a maintainer would write
AssertionError: expected [ Array(1) ] to deeply equal []
+ [
+   "src/core/store/workspace/dependencies.ts: 'reset'",
+ ]
```

Result: 2 failed, 10 passed (12).

## Revert

Reverted via `Edit` (not `git checkout --`, which under this repo's
`core.autocrlf=true` would rewrite the file to CRLF rather than restore it
byte-exactly).

`sha256sum src/core/store/workspace/dependencies.ts` after revert:

```
6ad75415bbc0e9718295ebb40e075969ae70c35d7057fc6f8b9fd2b6c0b5ff59
```

Matches the pristine hash exactly.

## GREEN

Same command, same file, reverted:

```
Test Files  1 passed (1)
     Tests  12 passed (12)
```

## Conclusion

The guard fires precisely when a forbidden verb literal is present anywhere
in the workspace Module's source, names the offending file and verb, and is
silent once the source is clean again. Observed RED, byte-exact revert
confirmed by hash, observed GREEN — both directions of the guard are now on
the record, not merely inferred from reading the guard's own code.
