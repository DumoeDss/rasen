# store-planning-worktree-bindings — independent review, round 2

Reviewer: same independent reviewer who wrote `evidence/review-report.md`; wrote
none of the code and none of the fixes. Read-only: no `src/`, `test/`, or other
artifact was modified. Scope is the fix delta, not the whole change.

**Verdict: 12 of 12 findings genuinely closed.** Both partial rejections (6 and
8) are correct and I agree with them. **Two new low-severity items** the fix
delta introduced or left standing are in §D. No fix broke anything that was
previously right.

I did not take §3 of the fix report on trust. Every discrimination claim below
was re-derived here — by reimplementing the guard's helpers and re-running the
sweep myself, by probing the built artifact, or by tracing the exact code path
the revert would change.

---

## A. Discrimination, independently reproduced

### Finding 1 — precondition 7 (the one the lead named)

Verified **behaviourally against the built artifact**, in the exact argument
shape the CLI uses, rather than by reading the diff
(`…/scratchpad/r2-precondition7.mjs`: a scratch machine root with one live
session context and one unparseable one, `RASEN_HOME` pointed at it, then
`sessionReferencedRoots(productionDeps, undefined)` called on
`dist/core/store/workspace/cleanup.js`):

```
getGlobalDataDir() with RASEN_HOME set -> …\scratchpad\p7home   (points at our fixture: true)

--- sessionReferencedRoots(deps, undefined)  [the CLI argument shape] ---
  roots      : ["E:/tmp/store-wt","E:/tmp/store-wt","E:/tmp/code-wt","E:/tmp/code-wt"]
  unreadable : ["…\p7home\sessions\sess_broken\context.json"]

  live session detected with NO machine root threaded : YES (fix live)
  unreadable context counted (fail-closed half)      : YES

--- and with an explicit machine root, which the unit fixture always passes ---
  identical to the undefined case: true
```

In round 1 the same call returned `{roots: [], unreadable: []}` unconditionally.
Both halves are live, including the fail-closed "a context I cannot read
references everything" rule, which was equally inert before.

**The lead's specific question — does the revert turn the NEW test red while the
two machine-root tests stay green? Yes, and it holds by construction.** The
reverted line is `if (globalDataDir === undefined) return {roots:[],unreadable:[]}`,
so `globalDataDir === undefined` is precisely the axis that separates the tests:

| test | how the Module is built | `globalDataDir` at the call | under the revert |
| --- | --- | --- | --- |
| `workspace-cleanup.test.ts:438` refuses a worktree a live session references | `f.workspace()` = `new StoreWorkspace(deps, { globalDataDir })` | **defined** | early return never fires → **green** |
| `workspace-cleanup.test.ts:455` counts an unreadable context as referencing everything | same | **defined** | **green** |
| `workspace-cleanup.test.ts:472` scans sessions under the REAL machine root when no data directory is threaded | `new StoreWorkspace(f.dependencies)`, `planCleanup` with no root, `RASEN_HOME` set | **undefined** | early return fires → no roots → precondition 7 satisfied → `blockerIds` is `[]` not `['planning-7-no-live-session']` → **red** |
| `workspace-cli.test.ts:313` refuses cleanup while a live session references a recorded worktree, with nothing threaded in | real CLI subprocess | **undefined** | **red** |

That is the fixture blindness closed, and closed at two layers rather than one.
The fix is also the right one of the two I offered: defaulting inside
`sessionReferencedRoots` means the next caller that omits the argument inherits
the correct behavior, whereas threading it from the CLI would have left the
fail-open default in place for anyone else.

### Findings 2a and 2b — the verb guard

Reimplemented both the old and the new helpers verbatim and re-ran the sweep
over the real `dependencies.ts` (`…/scratchpad/r2-verb-guard.mjs`). I added
seven bypasses the fixer did not test.

```
=== 2a: strip behaviour, old vs new, on the real dependencies.ts ===
  OLD strip removes 2903 chars
  NEW strip removes 462 chars
  survivor "execFilePromise('git'":              OLD=false NEW=true
  survivor "function nonEmptyLines":             OLD=false NEW=true
  survivor "async worktreeList":                 OLD=false NEW=true
  survivor "async removeWorktree":               OLD=true  NEW=true
  survivor "may never force a worktree removal": OLD=false NEW=true
  declarationLines skipped by the sweep: 19 (test asserts < 30)

=== injection sweep: NEW guard vs OLD guard, every legal statement line ===
label                                    NEW-missed  OLD-missed  (of 494 sites)
a: first-element checkout                        0         68
b: own spawn shape, branch -D                    0        494
c: forced worktree removal                       0          7
d: worktree add --force                          0          7     <- mine
e: reset via own spawn shape                     0        494     <- mine
f: verb built into a variable, via spawnGit    494        494     <- mine
g: verb via variable + own spawn shape           0        493     <- mine
h: exec name split, no 'git' literal             0        493     <- mine
i: forced removal with -f short flag             0          8     <- mine
j: checkout as a later element                   0        494     <- mine

=== permitted neighbours must NOT fire ===
  verbs: []   force: []
```

**2a holds.** The old strip really did remove 2,903 characters and really did
delete the module's only Git spawn, `nonEmptyLines`, `worktreeList`, and the
force-refusal phrase itself. The new strip removes 462 and keeps all five. The
sweep's skipped-line set is 19, well inside the asserted `< 30` — and that
assertion is itself load-bearing, because the broken strip would have pushed it
past 65.

**2b holds exactly as claimed.** The module's own spawn shape was missed at
**all 494** sites by the old guard and at **none** by the new one.

**My seven additions all pass except (f), and (f) is not a hole.** `const v =
'branch'; await spawnGit(repoRoot, [v, '-D', branch])` is invisible to a source
scan by construction — but it goes through `spawnGit`, whose runtime
`ALLOWED_GIT_VERBS` check rejects `'branch'` before Git is spawned. The dangerous
variant, (g), which puts a variable verb through a *direct* `execFilePromise` and
so evades the runtime check, **is** caught — by the new spawn-site check, because
it must name `'git'`. And (h), which splits the executable name to dodge that
check, is caught by the element matcher on `'branch'`. The three checks compose:
you either enter `spawnGit` and meet the runtime allow-list, or you name the
executable and meet the spawn-site check. That is a real closure, not a patch on
one shape.

The fixer's own unnamed finding is also real: the old ±200-character proximity
window around `may never force a worktree removal` waved through a forced
removal at 7 sites (and `-f` at 8). Keying the exemption to the runtime condition
itself removes that.

### Finding 3 — `describe` entry selection

`selectDescribedEntry` (`module.ts:95-117`) is correct: explicit `--change`
wins; zero or one entry behaves as before; with several, only containment of the
caller's `startPath` in a recorded root may decide, and if it decides nothing the
result is `entry: null` plus every candidate. `isContainedIn(root, startPath)` is
the right argument order. Two or more matching roots also yield `null`, so a
nested pair fails closed rather than picking.

The tests discriminate, and the fixture is built to make the old bug visible:
`context-workspace.test.ts:243` prepares `add-billing` and `zebra-fix` in one
scope — `add-billing` sorts first, so `entries[0]` is the *wrong* one — runs from
`zebra-fix`'s execution worktree, and asserts `changeId === 'zebra-fix'`. It then
runs from the *other* pair's planning worktree and asserts `add-billing`, which
also kills a naive "take the last" fix. `:273` runs from the Store integration
checkout, inside neither, and asserts no `changeId`, no `planning`, no
`execution`, and a `workspace_binding_ambiguous` finding naming both changes and
`--change`.

### Finding 4 — the `-z` change (the lead's third question)

Ran both new parsers, copied verbatim, against real Git output for every path
shape I could construct on this host (`…/scratchpad/probe-z-parsers.mjs`):

```
=== untrackedFiles(-z) ===
  OK  " leading-space.txt"     parsedName===realName:true  resolvesOnDisk:true
  OK  "has space.txt"          …
  OK  "plain.txt"              …
  OK  "trailing-space .txt"    …
  OK  "δοκιμή.txt"             …
  OK  "设计文档.md"             …
  parsed 6 records, expected 6;  extra/unexpected: []

=== dirtyEntries(-z) ===
  OK  tracked-modified "tracked with space.txt"
  OK  tracked-modified "tracked-emoji-🚀.txt"     <- astral plane / surrogate pair
  OK  staged           "tracked.txt"
  OK  tracked-modified "tracked.txt"
  OK  tracked-modified "追踪文件.md"
  tracked.txt rows: ["staged","tracked-modified"]   (both, correctly)

=== the OLD line-based parser on the SAME -z output ===
   ["leading-space.txt\u0000has space.txt\u0000plain.txt\u0000…"]   <- one garbage record
```

**Correct for both methods on every shape**, including the two the old code got
wrong for different reasons: non-ASCII (octal-escaped before) and leading/
trailing spaces (`.trim()` destroyed them before). Removing the `.trim()` was
necessary, not cosmetic. The staged-and-modified file still yields both rows, so
the `XY ` prefix indexing survived the switch. `nulSeparatedRecords` filters the
empty tail record, which `-z`'s NUL-*terminated* output requires.

**I checked the one hazard `-z` introduces — rename records — and it is handled,
because `--no-renames` is still passed.** With `-z`, a rename is a *two-record*
entry whose second record is a bare path with no `XY ` prefix, which this parser
would read as a phantom entry. Verified on real Git:

```
--- WITH --no-renames (what the code passes) ---
D   原名.txt \0  A   新名.txt \0          <- two ordinary single records
--- WITHOUT --no-renames ---
R   新名.txt \0  原名.txt \0              <- bare second record, no XY prefix
```

So the parser is correct *because* of `--no-renames`, and that flag is still on
the argument vector (`dependencies.ts:435`). Worth knowing before anyone edits
that array: dropping `--no-renames` would now produce a phantom `staged` entry
whose path is a fragment of the old name. This is not a regression — the old
line-based parser had the identical one-record-per-entry assumption — but `-z`
makes the malformed record harder to spot by eye.

### Findings 5, 7, 8, 9, 10, 11, 12 — spot-checked at the code

- **5.** `lockIsHeld` (`locks.ts:270-284`) now mirrors the acquirer exactly:
  `ENOENT` → not held; any other read error → held (the acquirer waits on those
  too, so the probe must not be more permissive); otherwise
  `!fileLockOwnerIsProvablyDead(content)`. The predicate is *shared* from
  `file-state.ts:275-278`, reusing the existing `parsePidFromLockContent` and the
  ESRCH-only `pidIsAlive` — so there is no second copy of the liveness rules to
  diverge. That is the correct resolution of my finding 5 and it avoids
  re-creating my finding 7 in the process.
- **7.** `completeChangeBinding` calls the shared `assertCarrierAgreesWithScope`,
  which checks `storeUid` via `storeUidsMatch` alongside project and line. The
  divergent two-field comparison is gone.
- **8.** `WorkspaceGitCommandError extends StoreWorkspaceError` with code
  `workspace_git_failed` (`dependencies.ts:230-244`). Both agent-facing surfaces
  are fixed by that one change, including the `instanceof StoreError` half I got
  wrong — see §C.
- **9.** The staleness assertion (`vocabulary-sweep.test.ts:204-208`) mirrors the
  one the first test in the file already carried. **No conflict with child 5:**
  `workspace_pair_unavailable` is in the allow-list *and* present in
  `src/core/store/finalization/`, so it satisfies both directions. `workspace_dirty_tree`
  likewise satisfies staleness, because it is present in `types.ts` as a union
  member even though nothing raises it.
- **10.** `plan.targets.length * 8`, with a separate string for the no-target
  case. Correct.
- **11.** `revalidateBeforeRemoval` (`cleanup.ts:509-562`) runs the fingerprint
  and per-target reachability **before** the removal loop, and skips targets
  whose phase is already past removal. The fingerprint is compared to
  `currentWorkspaceIndexFingerprint` — live state — which is what makes it
  non-vacuous where my finding said it was self-satisfying. Resume still works,
  because that fingerprint excludes the plan's own entry, so `advance()`'s phase
  writes cannot invalidate it. The pre-pass shape is the right one: interleaving
  would have refused only after one side was already gone.
- **12.** `CleanupTarget.mainCheckout` is resolved at plan time while the
  worktree still exists (`cleanup.ts:433`) and is used **only** in the
  already-absent branch (`:623-624`); the normal path still resolves it live
  (`:665`). Freezing it was necessary — a deleted directory cannot answer for its
  own repository — and it is not used to *remove* anything, only to prune, with
  the prune still wrapped in a tolerant `catch`.

---

## B. Ruling on the two partial rejections

### Finding 6 — the containment tautologies: **rejection accepted, finding closed**

I agree with the fixer, and not out of deference. My finding had two halves and
the fixer separated them correctly.

The half that mattered — "the roots themselves are never containment-checked
against anything" — is now closed by three preconditions that compare
*independent* values and can therefore fail:
`planning-root-outside-repository` and `execution-root-outside-repository`
(`isContainedIn(repositoryRoot, root)`) and `pair-roots-disjoint`
(`isContainedIn(planningRoot, executionRoot)` either way). The revert row
("force `inside`/`nested` to `false` → 2 failed") is exactly the evidence my
finding demanded, and the default destination
(`defaultWorktreeDestination` builds a *sibling* of the repository root) does not
trip either check, so they are not vacuously satisfied in the normal case either.

Keeping the two tautologies is defensible. The danger of a tautological guard is
false confidence, and a comment stating in as many words that they cannot fail
today, and naming what does the real work, removes precisely that danger. They
also state an invariant that becomes load-bearing the moment the marker location
stops being a fixed `join(root, '.rasen', …)`. Deleting a precondition the task
text names, to score a review point, would have been the worse trade.

`pair-roots-disjoint` also closes a hole I did not find, and the fixer is right
about why it was reachable: the destination-exists check reads disk before
either side is created, so `--planning-worktree X --execution-worktree X` passed
planning and failed at apply with a raw Git error.

**One caveat for the shipper, not a defect.** `<side>-root-outside-repository` is
a *new refusal* for a configuration Git permits and that previously worked — a
worktree nested inside its own repository checkout. No fixture does this and
nothing in the suite regressed, but it is a behavior tightening of the same class
the proposal already records for the planning-worktree gate, and it is not
currently listed there.

### Finding 8 — `workspace_dirty_tree` left declaration-only: **rejection accepted**

I agree, and the fixer's reasoning is sound: my own round-1 verdict was that the
code is unreachable *by design*, the delta spec forecloses the obvious re-coding
("Any unsatisfied precondition SHALL fail with `workspace_cleanup_unsafe`"), and
removing a member from an enumerated taxonomy in `proposal.md` is an authoring
decision rather than a review fix. Escalating it to the shipper is the right
process call.

**One correction that lowers the stakes further, which I checked and the fix
report did not state:** `workspace_dirty_tree` appears in `proposal.md:17` and
`design.md:160` and in **no delta spec**. So the inconsistency never reaches
`rasen/specs/` at archive; the blast radius is the PR body promising a refusal
code that cannot occur. That is worth one line of editing before ship, not a
blocking item.

The other half is genuinely fixed and the fixer found a real gap I had
mis-stated — see §C.

---

## C. A correction to my round-1 report

I wrote that the `workspace_*_failed` fallbacks in `src/commands/workspace.ts`
"cover only the CLI group", which implied the CLI surface was already fine. It
was not: `fail()` tests `instanceof StoreError`, and a bare
`WorkspaceGitCommandError` was not one, so a Git failure surfaced there as the
generic `workspace_plan_failed` / `workspace_cleanup_failed` bucket too. Making
`WorkspaceGitCommandError extend StoreWorkspaceError` fixes both surfaces at
once. The fixer's catch, correctly.

---

## D. New items in the fix delta

Both low. Neither is a regression of previously-correct behavior; one is a
consequence of finding 3's fix and one is a scope limit the new guard's own claim
makes material.

### 13. LOW — the human `rasen context` output now contradicts itself in the undecided case

`src/core/store/workspace/module.ts:184-215` with `src/commands/context.ts:135,201-203`

Finding 3's fix returns `prepared: false` for the undecided case, and the fixer
reasoned about that choice explicitly ("there is no fifth state … the finding
carries the truth"). What it did not check is what the human printer does with
that flag:

```ts
if (!workspace.prepared) {
  console.log(`  No workspace is prepared for project ${…} on target line ${…}.`);
}
…
for (const finding of workspace.findings) console.log(`  ${finding.severity}: ${finding.message}`);
```

**Failure scenario.** Two prepared pairs in one scope; the user runs `rasen
context` (human form) from the Store integration checkout. The output states
`No workspace is prepared for project app-a on target line line-0.2.` and then,
four lines later, `warning: Project 'app-a' on target line 'line-0.2' has 2
prepared workspaces (add-billing, zebra-fix)…`. The first sentence is false, and
it is the one a reader takes as the answer. The capability requires human and
JSON to carry "the same content", and requires that "a scope with no prepared
workspace SHALL say so explicitly" — a scope with two saying it has none inverts
that clause.

`context-workspace.test.ts:273` asserts the JSON payload only and makes no
`human.stdout` assertion, which is why it passes. The narrow fix is to gate that
sentence on the absence of an ambiguity finding rather than on `prepared`.

### 14. LOW — the guard now claims Git is reachable from exactly one place, and it is not

`test/core/store/workspace-git-verb-guard.test.ts:231-243`

The new spawn-site check is a real improvement and it is what closes bypass (g).
But its stated claim — "spawns Git from exactly one place, so a call the verb
scan misreads still cannot reach Git" — is scoped to `src/core/store/workspace/`
and to two shapes: a `'git'` string literal and a `node:child_process` import.
A sibling module reached by ordinary import satisfies neither.

`src/core/store/git.ts` is such a module, and it spawns exactly the verbs this
capability forbids: `git add --` and `git commit` (`commitStoreFiles`, `:113-132`),
`git rm --cached -r -f`, `git clone` (`:161-163`), `git init` (`:61`).

**Failure scenario.** A maintainer implements the natural next step from
"the command SHALL print the pathspec the user may commit themselves" — actually
committing it — by adding `import { commitStoreFiles } from '../git.js'` to
`src/core/store/workspace/module.ts` and calling it after a target-line write.
All three guard checks pass: no quoted forbidden verb in the workspace file, no
`'git'` literal, no `child_process` import. The capability's
`#### Scenario: No command stages or commits` is then violated with a green CI.

This limit existed in round 1 too; I am raising it now because the rewritten
check is what turns "the guard does not look outside this directory" from an
unstated assumption into a claim the test name makes. An import allow-list for
the workspace directory — the same shape as the token ledger — would close it.

---

## E. Gates

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | **clean**, exit 0, no output |
| `npx eslint src test` | **clean**, no output |
| `node bin/rasen.js validate store-planning-worktree-bindings --strict` | `Change 'store-planning-worktree-bindings' is valid`, EXIT=0 |

Test runs are recorded in §F with every failing file enumerated by name.

The archive-time delta check from round 1 was re-run and is unaffected: child 4's
delta is still 100% ADDED across `session-runtime-context`,
`store-planning-worktree-bindings`, and `store-target-lines`, no sibling delta
touches any of the three, and no ADDED title collides with the effective
baseline.

---

## F. Test results

Run independently, not copied from the fix report. Every failing file is named;
nothing is extrapolated from a truncated tail.

**`test/core/store/**`, `test/core/store-planning/**`, `test/vocabulary-sweep.test.ts`,
`test/core/session-runtime-context.test.ts`** — `…/scratchpad/r2-core.txt`:

```
 Test Files  69 passed (69)
      Tests  1069 passed | 2 skipped (1071)
```

**Failing files: none.** This matches the fix report's figure exactly, including
`vocabulary-sweep.test.ts`, which passes with both finding 9's new staleness
assertion and child 5's `workspace_pair_unavailable` ledger entry in place — the
two do not conflict, because the token is present in `src/` and so satisfies the
staleness direction as well as the allow direction.

**Command-side suites** (`workspace-cli`, `context-workspace`,
`store-target-line-cli`, `legacy-groups-removed`, `store-v2-workspace-journey`,
`store-v2-workspace-concurrency`, `store-v2-planning-scope-journey`,
`pipeline-store-root-selection`) — `…/scratchpad/r2-cmds.txt`:

```
 Test Files  1 failed | 7 passed (8)
      Tests  1 failed | 53 passed (54)

 FAIL  test/commands/workspace-cli.test.ts >
       previews a cleanup, refuses an unsafe one, and removes a safe one by plan id
 Error: Test timed out in 30000ms.                                    (case ran 33.6s)
 Error: EPERM, Permission denied: …\Temp\rasen-workspace-cli-Kyi1nv   (fixture teardown)
```

**One failing file: `test/commands/workspace-cli.test.ts`, one case.** I did not
attribute it to flakiness on sight, because that case is precisely the one
findings 11 and 12 added per-target Git work to (a reachability + fingerprint
pre-pass at apply, and a `repositoryMainCheckout` resolution per target at plan),
and it exercises the cleanup path three times. Re-run **in isolation** after
clearing the stale temp directories:

```
 ✓ test/commands/workspace-cli.test.ts (13 tests) 88905ms
   ✓ previews a cleanup, refuses an unsafe one, and removes a safe one by plan id  20153ms
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

**Attribution: contention, not a regression.** The case runs 20.2s against its
30s budget — a 33% margin — and reached 33.6s only while competing with seven
other real-Git CLI suites in one batch; the EPERM is the known Windows teardown
race on a directory a just-killed child process still held. With that removed,
**every child 4 suite is green: 82 files, 1,122 passed, 2 skipped, 0 failed.**

Worth one sentence to the shipper anyway: 20s of a 30s budget is the thinnest
margin in this change's suites, and findings 11 and 12 are what moved it. This is
the first case to fail if CI is slower than this host, and it would then look
like a defect rather than a budget.

The 5 pre-declared environmental failures (`config.test.ts` ×1,
`config-editor.test.ts` ×4) were not in scope and were not run.

---

## G. What I could not verify

- **The reverts themselves.** I could not apply the fixer's production-line
  reverts, because two other agents are live in this tree and the review is
  read-only. For findings 2a and 2b that cost nothing — the guard operates on
  source text, so I reproduced both sweeps exactly in a scratch script. For
  finding 1 I substituted a stronger check (the built artifact, in the CLI's
  argument shape) plus a code-path table showing why the revert must separate the
  two test groups. For findings 5, 6, 7, 10, 11 and 12 my confirmation is a code
  read against the revert row, not an executed revert.
- **A path containing a newline.** Windows forbids it, so the fix report's claim
  that `-z` also survives that case is structurally sound (NUL is the only byte a
  path cannot contain) but unproven on this host.
- **Cross-platform behavior.** Everything ran on Windows. `-z` output decoding
  depends on `execFile`'s UTF-8 default meeting Git's raw path bytes; that is
  correct where the filesystem stores UTF-8, which is Git's own storage
  convention, but a Linux filesystem holding non-UTF-8 bytes in a filename would
  produce replacement characters. Out of scope for this delta and not introduced
  by it.
- **Finding 13 as an executed reproduction.** It is a two-hop code read
  (`prepared: false` at `module.ts:189` → `context.ts:135` → the `!prepared`
  branch at `:201`) with no intervening logic, so I am confident, but I did not
  drive the CLI with two prepared pairs to print it.
