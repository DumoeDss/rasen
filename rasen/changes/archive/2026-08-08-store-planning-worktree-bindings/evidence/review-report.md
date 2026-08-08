# store-planning-worktree-bindings — independent review report

Reviewer: independent (did not write this code). Read-only: no `src/`, `test/`,
or artifact file was modified. Every claim below was verified by running
something, not by reading alone; the command and its real output are given.

**12 findings: 3 high, 2 medium, 7 low.** The two leads the author left open are
both resolved in §A. The production code is good — the plan/apply core, the
revalidation contract, and the injected-failure apply suite are genuinely strong
— and the defects cluster in one place: **three guards that cannot fail, one of
them on the production path only.** That is the same shape this portfolio has
already been bitten by three times.

---

## A. The two specific leads

### A1. `test/commands/**` and the `workspace` retirement

`pnpm exec vitest run test/commands/ test/vocabulary-sweep.test.ts`

```
 Test Files  3 failed | 60 passed (63)
      Tests  6 failed | 1103 passed | 1 skipped (1110)
   Duration  516.09s
```

`vocabulary-sweep.test.ts` passes. The two cases the implementation report's §1
left red are green, and `legacy-groups-removed.test.ts` is not among the failing
files. A second full run was started to enumerate all three failing files by
name; see §D — I did **not** extrapolate the third from the five known
environmental ones.

**The retirement of the top-level `workspace` name is genuinely enforced, and
the pin discriminates.** `test/commands/legacy-groups-removed.test.ts:68-75`
runs `rasen workspace list` and requires stderr to contain
`unknown command 'workspace'`. Had child 4 registered a top-level `workspace`
group, Commander would have reported `unknown command 'list'` instead — a
different string — so the case fails on the regression it exists to catch.
`:77-83` asserts `not.toMatch(/^\s*workspace\s/m)` against `rasen --help`, which
lists top-level commands only; a `store workspace` subcommand cannot appear
there, so the assertion is both correct and unable to pass vacuously.

**The 31-token enumeration in `vocabulary-sweep.test.ts:137-180` is complete and
a 32nd token would fail.** Verified mechanically rather than by eye: the
allow-list is a literal `Set`, the scan is `for (const filePath of
walkFiles(src))` with `/(workspace|initiative)_[a-z_]+/g`, and the assertion is
`[...found].filter((t) => !allowed.has(t))` — no prefix rule, no directory
exemption. I audited every one of the 31 for presence in `src/` and for a
non-allow-list assertion in `test/`:

```
STALE allow-list entries (absent from src/): none
NEVER asserted in test/: none
```

Two caveats on that clean result, recorded as findings 8 and 9 below:
`workspace_dirty_tree` and `workspace_git_failed` are present only as union
members in `types.ts` and are never thrown or asserted as behavior anywhere; and
unlike the first test in the same file, this allow-list carries no staleness
assertion.

### A2. `validate --strict`, and the archive-time title check

```
$ node bin/rasen.js validate store-planning-worktree-bindings --strict
Change 'store-planning-worktree-bindings' is valid
EXIT=0
```

**It passes.** The implementation report's later section already recorded this;
I re-ran it rather than trusting the record.

**Do I trust `title-check.mjs`? Its parsing yes, its configuration no — as
handed to me it would have produced a false ALL CLEAR for child 4.** Three
problems, all fixed in the adapted copy I ran:

1. `SIBLINGS` contains `store-planning-worktree-bindings` itself. Pointed at
   child 4, the script would apply child 4's own delta to child 4's baseline,
   making every MODIFIED block trivially match itself.
2. It applies children 5, 6, and 7. Those archive **after** child 4, so they are
   not in its baseline. Only child 3 precedes it.
3. It only checks the MODIFIED direction. Child 4's delta is **100% ADDED**
   (`grep -rn '^## \(ADDED\|MODIFIED\|REMOVED\|RENAMED\)'` returns three
   `## ADDED Requirements` and nothing else), so the MODIFIED check is vacuous
   here and the real archive hazard is the opposite one:
   `specs-apply.ts:316-321` throws `ADDED failed … already exists` when an
   ADDED title is already in the baseline.

What I *do* trust: its `MODIFIED`-drop check mirrors the engine exactly. I read
`src/core/specs-apply.ts:289-311` — MODIFIED replaces the whole block, and
`findMissingCurrentScenarios` (`:404-410`) rejects any baseline scenario the
block fails to repeat, which is what the script's `missing` computation
reproduces. `normalizeRequirementName` is `name.trim()`
(`src/core/parsers/requirement-blocks.ts:18-20`), so byte-match after trim is
the right standard. One residual gap: the script's heading regexes assume a
single space (`^### Requirement: `) while the engine's are
`/^###\s*Requirement:\s*(.+)\s*$/i`; a delta heading with irregular spacing
would be silently skipped rather than checked. I widened the regexes to the
engine's in my copy and re-verified no heading in this change relies on it.

Adapted checker:
`…/scratchpad/c4-archive-check.mjs` (child 3 as the only prior sibling; both
directions checked). Result:

```
### session-runtime-context — canonical EXISTS (9 reqs)
OK   ADDED "A Store session freezes its complete planning and execution worktree pair" (5 scenarios) — no collision
### store-planning-worktree-bindings — canonical ABSENT (new capability)
OK   ADDED … x11, no collision
### store-target-lines — canonical ABSENT (new capability)
OK   ADDED … x4, no collision
ALL CLEAR
```

No sibling delta touches any of child 4's three capabilities, so the effective
baseline equals current `rasen/specs/` and there is nothing for archive order to
perturb. **Child 4 has no scenario-title exposure at all.**

One ship-time note, not a defect: `store-planning-worktree-bindings` and
`store-target-lines` are **new capabilities**, so archiving will write the
`TBD - created by archiving change …` placeholder Purpose over the real Purpose
the delta carries. That is the known repo-wide behavior recorded in
`planning-context.md`; both will need a real Purpose authored after archive.

---

## B. Findings, most severe first

### 1. HIGH — cleanup precondition 7 is inert on the production CLI path, so cleanup will remove a worktree out from under a live session

`src/core/store/workspace/cleanup.ts:95` with `src/commands/workspace.ts:351,358`

`sessionReferencedRoots` returns `{ roots: [], unreadable: [] }` immediately when
`globalDataDir` is `undefined`. The CLI constructs `new StoreWorkspace()` with no
options and calls `planCleanup({…})` with no `globalDataDir`, so
`module.ts:198`'s `input.globalDataDir ?? this.globalDataDir` is `undefined`,
`cleanup.ts:169` passes `undefined`, and the session scan never runs. Every other
consumer of the machine root survives this because the *coordination adapter*
falls back to `getGlobalDataDir()` internally (`dependencies.ts:463`) — the
session scan is the one place that bails out instead. That asymmetry is why it
reads as working.

**Failure scenario.** A Rasen session is live in the execution worktree
`…/elftia--redesign-b`; `<dataDir>/sessions/<id>/context.json` names both roots.
In a second terminal the user runs
`rasen store workspace cleanup --change redesign-b`. Precondition
`execution-7-no-live-session` is reported **satisfied**, printing the literal
false statement `No live session context references …/elftia--redesign-b`. The
plan is `applicable`, carries a token, and `--apply-plan <id>` removes both
worktrees while the session is running inside one of them. The spec requires the
opposite: "no live session references it" is a precondition, and an unsatisfied
precondition must be `workspace_cleanup_unsafe` with no override.

The fail-closed half is inert too: "a context file that cannot be read counts as
REFERENCING everything" (`cleanup.ts:86-89`) can never fire either.

**The fix.** `WorkspaceSelectors` already carries an optional `globalDataDir`
(`types.ts:297`), so the CLI *could* thread it — but the right fix is to make
`sessionReferencedRoots` resolve its own default the way the coordination adapter
already does (`dependencies.ts:463`: `globalDataDir ?? getGlobalDataDir()`), so
that an omitted argument means "the real machine root", never "no sessions
exist". A precondition whose default answer is "satisfied" is the wrong default
for a fail-closed gate.

**Why no test caught it.** `test/helpers/store-workspace-fixture.ts:295`
constructs `new StoreWorkspace(dependencies, { globalDataDir })`. Every unit test
therefore passes the argument the CLI omits, so the defect is invisible to child
4's entire suite by construction. There is also **no cleanup test for
precondition 7 at all** — the 13 cases in `workspace-cleanup.test.ts` cover
preconditions 1–6 and 8, and task 10.5 ("Assert preconditions 7-8") is ticked on
the strength of 8 alone.

### 2. HIGH — the Git verb source guard has two demonstrated bypasses, and one of them also defeats the runtime allow-list

`test/core/store/workspace-git-verb-guard.test.ts:81-95,104-123`

The capability requires the closed verb set to be "enforced by a source guard
rather than by convention", and `#### Scenario: A forbidden verb cannot be
introduced silently` says the guard SHALL fail. It does not, in two ways. I
reimplemented the test's helpers verbatim and swept every insertion point
(`…/scratchpad/probe-verb-guard2.mjs`, `probe-verb-guard3.mjs`).

**(a) 65 consecutive insertion sites in real adapter code are excluded from the
scan.** `withoutVerbDeclarations` (`:90-95`) matches
`\b(GIT_WRITE_VERBS|GIT_READ_VERBS|GIT_WORKTREE_SUBCOMMANDS|ALLOWED_GIT_VERBS)\b[^=]*=[\s\S]*?\]\)?;`
— which fires on **use** sites, not only declarations, and then lazily swallows
everything up to the next `]…;`. On `dependencies.ts` it deletes six regions
totalling 2,775 characters, including one **2,134-character / 58-line** block
running from `GIT_WORKTREE_SUBCOMMANDS.includes(subcommand)` at line 251 through
the whole tail of `spawnGit`, `nonEmptyLines`, `repositoryPaths`, and into
`worktreeList`:

```
--- (A) canonical `['checkout', ...]` shape, inserted after each line 240..320 ---
MISSED at lines: 244..309 (65 sites)
  e.g. L275:     .split(/\r?\n/u)
```

**(b) The verb matcher cannot see the spawn shape this module itself uses.**
`quotedLiteralMatcher` (`:81-83`) anchors on `\[\s*` immediately before the
quoted verb — the verb must be the **first** array element. But the real spawn at
`dependencies.ts:261` is `execFilePromise('git', ['-C', cwd, ...args])`, where
the verb sits at index 2. A new call written in that same shape is invisible
everywhere in the file:

```
--- (B) the module's OWN spawn shape: execFilePromise('git', ['-C', cwd, <verb>, ...]) ---
MISSED at 536 of 536 insertion points (EVERY ONE)
```

**Failure scenario.** A maintainer adds branch cleanup to `removeWorktree`:
`await execFilePromise('git', ['-C', repoRoot, 'branch', '-D', branch]);`.
Running the real guard's matchers over the mutated file returns
`guard offenders: []`. And because `execFilePromise` is called directly rather
than through `spawnGit`, the runtime `ALLOWED_GIT_VERBS` check at
`dependencies.ts:244` never executes either. **Both layers miss it.** Cleanup then
force-deletes the user's branch — forbidden by design §16
("不自动 merge、rebase、force-delete branch 或 worktree"), by the capability
("SHALL NOT … delete a branch or ref"), and by
`#### Scenario: Cleanup never widens beyond the pair`.

The suite's own discrimination case (`:155-168`) is what makes this survivable
in review: it feeds the matchers a synthetic `['checkout', …]` — the one shape
that *is* caught — and never exercises `withoutComments`, `withoutVerbDeclarations`,
or the `['-C', cwd, verb]` shape. It proves the matcher fires on the case it was
written for, which is not the same as proving the guard discriminates.

### 3. HIGH — `rasen context` reports an arbitrary Change's workspace pair when a scope holds more than one

`src/core/store/workspace/module.ts:152-155` with `src/commands/context.ts:170-175`

```ts
const entry =
  input.changeId === undefined
    ? (entries[0] ?? null)
    : (entries.find((candidate) => candidate.changeId === input.changeId) ?? null);
```

`gatherWorkspace` calls `describe({ store, project, targetLine, startPath })`
with **no `changeId`**, so `describe` takes `entries[0]` — the
alphabetically-first `changeId` in the scope
(`registry.ts:176-180` sorts by `(planningScopeId, changeId)`). `startPath` is
used for scope resolution and is never consulted for the entry pick, and the
execution worktree's own `.rasen/planning-binding.json` — the association the
design makes authoritative for "which pair am I in" — is not read here at all.
Multiple entries per scope is a designed state, not an anomaly: judgment call 3
makes the index file "a per-scope DOCUMENT holding one entry per Change alias",
and judgment call 4 explicitly reasons about "a concurrent preparation of a
different Change in the same scope".

**Failure scenario.** One `(store, project, target line)` scope has two prepared
pairs, `add-billing` and `zebra-fix`. The developer `cd`s into the **`zebra-fix`**
execution worktree and runs `rasen context --json`. The `workspace` object
reports `add-billing`'s planning root, execution root, both instance ids, its
`changeInstanceId` and `workspacePairId`, and `bindingState: "bound"`. Nothing in
the payload indicates it describes a different Change than the worktree the
command ran in, and no finding is emitted. This breaks
`#### Scenario: A bound pair is fully auditable` and the requirement's "Absent
facts SHALL be absent rather than guessed", and it contradicts design §17's
closing criterion that the machine association uniquely determines the pair.

Not covered: `test/commands/context-workspace.test.ts` uses a single
`const CHANGE = 'redesign-routing'` throughout, so the scope never holds two
entries and the branch is never exercised.

### 4. MEDIUM — `--include-untracked` cannot delete a non-ASCII untracked file, wedging cleanup mid-phase with a raw Git error

`src/core/store/workspace/dependencies.ts:419-425` (and `:407` for the same bug in `dirtyEntries`)

```ts
return nonEmptyLines(result.stdout).map((line) => line.replace(/^"|"$/gu, ''));
```

This strips the surrounding quotes but never decodes git's octal escaping. With
default `core.quotePath` (true), git quotes any path with non-ASCII bytes.
Verified against real git in a scratch repository:

```
$ git ls-files --others --exclude-standard
plain.txt
"\350\256\276\350\256\241\346\226\207\346\241\243.md"
```

so the adapter yields the literal 24-character string
`\350\256\276\350\256\241\346\226\207\346\241\243.md`, not the filename.

**Failure scenario.** A developer leaves `设计文档.md` untracked in the execution
worktree and runs `rasen store workspace cleanup --change X --include-untracked`,
then `--apply-plan`. `applyCleanupPlan` advances the index phase to
`removing-execution` (`cleanup.ts:486`), resolves the escaped string to a path
that does not exist, `removeFile` swallows the `ENOENT` (`dependencies.ts:173-179`),
and the real file survives. `git worktree remove` — which this module may never
force — then refuses, so `cleanup.ts:552` throws a bare
`WorkspaceGitCommandError` rather than `workspace_cleanup_unsafe`. The index is
left at `removing-execution`, and every retry reproduces the same failure, with
no `--force` and no override flag. The user is stuck.

No wrong file is deleted — `isContainedIn` at `cleanup.ts:528` rejects the
`win32` resolution of a leading-backslash name — so this is availability and
diagnostic quality, not data loss. Coverage: the only untracked case
(`workspace-cleanup.test.ts:248-267`) uses `scratch.txt`, and
`workspace-windows-paths.test.ts:265` stubs `untrackedFiles` as
`unused('untrackedFiles')`. Non-ASCII names are covered for *identity* and never
for the census or the deletion path — despite task 12.5 and design §15 both
naming UTF-8 Chinese fixtures.

### 5. MEDIUM — a stale lock file from a dead process blocks cleanup permanently, and the refusal names no path

`src/core/store/workspace/locks.ts:257-267` with `cleanup.ts:184-186`

`lockIsHeld` is a bare `fs.access` — file exists means held. That is strictly
more conservative than the lock protocol it is supposed to reflect:
`acquireOwnerAwareFileLock` steals a lock whose recorded pid is provably dead
(`src/core/file-state.ts:249-259,322-335` — `pidIsAlive` returns false only on
`ESRCH`), which the capability states as "a holder that is proven dead is
recovered".

**Failure scenario.** A `rasen store workspace apply` is killed (Ctrl-C, OOM,
terminal closed) while holding the scope lock; `withWorkspaceLocks`'s `finally`
never runs and the lock file survives with a dead pid. Every subsequent
`rasen store workspace cleanup` for that scope reports
`execution-8-no-lock-held` and `planning-8-no-lock-held` unsatisfied, so
`plan.applicable` is false, `plan.token` is `undefined`, and
`applyStoredCleanupPlan` throws `cleanupGateError`. There is no `--force`. The
refusal text is `A lock is held elsewhere: scope elftia@line-0.2` — the label,
not the file — while the *acquire* path's diagnostic does name `info.lockPath`
(`locks.ts:202-209`). So the user is told to resolve a precondition without being
told where the file is, and its name is a sha256 digest they cannot compute.

Non-discriminating test: `workspace-cleanup.test.ts:328-343` writes the lock file
with `pid: ${process.pid}` — the test runner's own live pid. `lockIsHeld` ignores
the pid entirely, so the case passes identically whether the holder is live or
long dead. It cannot distinguish the correct refusal from this defect.

### 6. LOW — the two containment preconditions in the workspace plan are tautologies

`src/core/store/workspace/plan.ts:556-574`

```ts
const markerPath = planningMarkerPath(planningSide.plan.root, flavor);
…
isContainedIn(root, destination, flavor)
```

`planningMarkerPath` is `join(planningRoot, '.rasen', 'planning-line.json')`
(`binding.ts:56-61`) and `executionAssociationPath` is the matching
`join(executionRoot, '.rasen', 'planning-binding.json')` (`:63-71`). A path built
by `join`ing two fixed non-`..` literals onto a root is a descendant of that root
for every input, so `planning-marker-contained` and `execution-marker-contained`
can never be reported unsatisfied.

**Failure scenario for the guard, not the code.** Task 4.4 asks for "containment
checks against the recorded roots"; the roots themselves — including a
user-supplied `--planning-worktree` — are never containment-checked against
anything, and the only check present is structurally incapable of firing. If a
future change makes the marker path configurable or relative, this precondition
will keep reporting satisfied. The implementation report's mutation table lists
"`isContainedIn` stops rejecting a `..` escape → 5 failures", but those five are
in `workspace-windows-paths.test.ts`, which calls `isContainedIn` directly as a
unit. The mutation proves the *function* works; it says nothing about whether the
*plan* uses it meaningfully.

### 7. LOW — `completeChangeBinding`'s marker-conflict check omits `storeUid`, though its own comment claims it and a correct helper already exists

`src/core/store/workspace/module.ts:611-631`

The comment reads "a marker naming another **Store**, project, or line … is a
conflict"; the code compares only `marker.fact.projectId` and
`marker.fact.targetLineId`. `BindingFact` carries `storeUid`
(`plan.ts:576-583`), `CompleteChangeBindingInput` carries it (used at
`module.ts:667`), and `binding.ts:194-205` is an existing helper that checks all
three with `storeUidsMatch`. This is a second, divergent implementation of one
rule.

**Failure scenario.** A planning worktree carries a marker written for Store A
with the same `projectId` and `targetLineId` — legitimate, because the design
makes `storeUid`, `projectId`, and `targetLineId` orthogonal dimensions and
`projectId` portable. A Change created there against Store B completes its
binding with no refusal, and the index records `storeUid: store_B` beside an
on-disk marker saying `store_A`. The capability requires `workspace_marker_conflict`
for "a local carrier that names a different Store … than the committed metadata".

Reachability is currently blocked upstream: `verifyPlanningWorktree` in
`src/core/store-planning/internal/resolver.ts:618-631` compares `storeUid` before
`createChange` proceeds. So this is missing defense-in-depth rather than a live
hole — but it is the layer the spec names, and it is one refactor away from
being the only one.

### 8. LOW — two members of the "closed refusal taxonomy" are declaration-only

`src/core/store/workspace/types.ts:347,367`

`grep -rn workspace_dirty_tree src/ test/` and the same for
`workspace_git_failed` return exactly two hits each: the union member in
`types.ts` and the entry in `vocabulary-sweep.test.ts`'s allow-list. Neither is
ever thrown, and neither is asserted as behavior.

`workspace_dirty_tree` is genuinely unreachable by design — the spec says "A
dirty working tree SHALL NOT block reuse", and cleanup reports dirtiness as
`workspace_cleanup_unsafe`. `workspace_git_failed` is the more consequential one:
task 5.6 requires a Git-level failure to be "surfaced as itself", and it is —
as a bare `WorkspaceGitCommandError` with no `code` property.

**Failure scenario.** `git worktree add` fails on an `index.lock` during
`rasen new change --json` (the resolver seam, not the `store workspace` CLI).
`statusFromError` duck-types coded diagnostics, and this error carries no code,
so the agent receives a generic `change_error` — the exact collapse the
implementation report's §3 defect 4 was written to fix, still reachable on the
one path that has no adapter-level fallback. The `workspace_*_failed` fallbacks
at `src/commands/workspace.ts:286,311,335,370` cover only the CLI group.

### 9. LOW — the workspace token allow-list has no staleness assertion, unlike the other allow-list in the same file

`test/vocabulary-sweep.test.ts:137-191`

The first test in this file checks its `ALLOWED_IDENTIFIERS` for staleness
(`:31-44`, and the comment at `:35` says so explicitly). The 31-entry `allowed`
Set has no equivalent: it is only ever used as `!allowed.has(token)`.

**Failure scenario.** A later child deletes `workspace_ref_drift` from `src/`.
The gate stays green. A year later an unrelated feature reintroduces
`workspace_ref_drift` with a different meaning, and the gate — whose stated
purpose is that "a new `(workspace|initiative)_` token in `src/` must be a
deliberate decision recorded in the ledger" — still stays green. Given that
finding 8 shows two entries are already declaration-only, the ledger is already
drifting from the code it claims to record.

### 10. LOW — cleanup's failure diagnostic prints a nonsense precondition count

`src/core/store/workspace/cleanup.ts:423`

```ts
expected: `${plan.blockers.length + plan.targets.length * 8} preconditions satisfied`,
```

The total is a constant `targets.length * 8`; adding `blockers.length` makes the
"expected" figure grow with the number of failures.

**Failure scenario.** A pair with two targets (16 preconditions) has one blocker.
The user reads `expected: 17 preconditions satisfied, actual: 1 unsatisfied` —
a number that matches neither the real total (16) nor anything else. Fix the
arithmetic to `targets.length * 8`.

### 11. LOW — cleanup's apply step does not revalidate reachability, so the plan's most expensive precondition is advisory

`src/core/store/workspace/cleanup.ts:479-555`

`applyCleanupPlan` re-checks the worktree instance id (`:502`) and the
main-checkout guard (`:538`), and `git worktree remove` backstops dirty and
untracked trees. Precondition 6 (`merge-base --is-ancestor`) is not re-run, and
`plan.indexFingerprint` is carried in the token but never compared inside
`applyCleanupPlan` — `module.ts:241` compares it to the *stored plan*, which is
the same document, so the check is self-satisfying.

**Failure scenario.** The user previews cleanup (reachability satisfied), then
commits new work on the planning branch, then runs `--apply-plan`. Both worktrees
are removed. The commits survive on the branch — cleanup never deletes refs — so
this is recoverable, which is why it is low; but it contradicts design §10's
"apply 前再次校验，变化则作废并重新 plan" for the one precondition that exists to
prevent losing work.

### 12. LOW — an already-absent worktree skips the prune it is recorded as having done

`src/core/store/workspace/cleanup.ts:494-501`

```ts
if (!facts.exists) {
  // … the removal is still driven through `worktree prune` below …
  await advance(removedPhase);
  continue;
}
```

The comment says the prune still happens; the `continue` jumps past `:538-551`,
which is the only place `mainCheckouts.set(target.side, mainCheckout)` runs. The
prune loop at `:557-559` iterates `mainCheckouts.values()`, so a side that was
already gone contributes no repository and is never pruned — yet `advance('pruned')`
at `:560` records the phase, and the result reports `phase: 'complete'`.

**Failure scenario.** The user previews cleanup (applicable), then deletes the
execution worktree directory by hand, then runs `--apply-plan`. The planning side
is removed and its Store repository is pruned; the **code** repository is not.
`git worktree list` in the code repository still lists the deleted path as
prunable, and a later `git worktree add` at that same destination fails with
"already registered" — which this Module would surface as
`workspace_destination_exists` against a path that does not exist. The index says
`pruned` and `complete` throughout.

---

## C. Guard tests I judge non-discriminating

| Guard | Verdict | Why |
| --- | --- | --- |
| `workspace-git-verb-guard.test.ts` "permits only the closed verb set" | **No discrimination over 65 lines of the adapter, and none at all for the module's own spawn shape** | Proven by injection sweep — finding 2. Its own discrimination case tests the matchers in isolation against the one shape that works. |
| `workspace-cleanup.test.ts:328` "refuses while a scope lock is held elsewhere" | **Cannot distinguish live from dead holder** | `lockIsHeld` ignores the pid the test writes; passes identically either way — finding 5. |
| `plan.ts` `planning-marker-contained` / `execution-marker-contained` | **Structurally cannot fail** | Path is `join(root, …)`; containment is guaranteed by construction — finding 6. |
| `cleanup.ts` `*-7-no-live-session` | **Cannot fail in production** | `globalDataDir` is always `undefined` on the CLI path — finding 1. No test exists for it at all. |
| `vocabulary-sweep.test.ts` 31-token enumeration | **Discriminates correctly** | Verified: individual entries, whole-`src/` scan, no prefix rule. Weakness is staleness only (finding 9). |
| `legacy-groups-removed.test.ts:68,77` | **Discriminates correctly** | Verified by reasoning through what a top-level registration would produce — §A1. |
| `workspace-apply.test.ts:209-283` injected failures | **Discriminates strongly** | Real failures injected at a chosen occurrence of `addWorktree`/`writeText`, asserting the exact resumable phase and that resume reaches `prepared`. Best suite in the change. |

The implementation report's mutation verification covers **one** suite
(`workspace-windows-paths.test.ts`, 5 mutations) plus one against
`workspace-baseline.test.ts`. `workspace-binding.test.ts` (15),
`workspace-plan.test.ts` (19), `workspace-apply.test.ts` (13),
`workspace-cleanup.test.ts` (13), `workspace-pairing.test.ts` (11), and
`target-lines.test.ts` (23) — 94 cases — have no discrimination evidence. Per
this portfolio's own rule that unproven guards should be assumed to have none, I
read them by eye; the apply suite is discriminating by construction, and the two
cleanup gaps above are what that reading found.

---

## D. What I could not verify

- **The third failing file in `test/commands/`.** The first run reported
  `3 failed | 60 passed (63)` and `6 failed | 1103 passed`, but I had piped it
  through `tail -80` and the summary truncated failure `[1/6]`. The five known
  environmental failures (`config-editor.test.ts` x4, `config.test.ts` x1) span
  only **two** files, so one more file fails and I refuse to guess which. A
  second full-capture run (`--reporter=basic`, output to
  `…/scratchpad/commands-full.txt`) was still executing when I finished; the
  LEAD should read that file's `FAIL` lines. Note the run also happened while
  child 5's implementer was editing `src/`, so a third failure may belong to
  child 5's in-flight work rather than to child 4.
- **Findings 1–3 as live end-to-end reproductions.** All three are proven by
  reading the wiring and by mechanical probe, not by driving the real CLI to the
  wrong outcome, because building the fixtures would require writing under
  `test/` — which this review is not permitted to do. Finding 1 in particular is
  a two-line reading (`cleanup.ts:95` plus `commands/workspace.ts:351`) and I am
  confident in it, but a reproduction case belongs in the fix.
- **Cross-platform behavior.** Everything ran on this Windows host. The `win32`
  and `posix` flavor paths in `identity.ts` and `plan.ts` are exercised by
  `workspace-windows-paths.test.ts` on this host's native flavor only; the
  portfolio has been bitten before by a suite that `early-return`s on one
  platform.
- **The 5 pre-declared environmental failures.** Accepted as declared; not
  re-investigated, per instructions.
- **Child 5's in-flight files.** `src/core/store/finalization/**`,
  `src/core/archive*.ts`, and finalization additions to `management-api/` were
  excluded. `src/core/management-api/supervisor.ts` is child 4's and was
  reviewed: its single addition (`resolveFrozenWorkspacePair` at `:300`, spread
  into the context at `:319`) is correct and carries no finding.

---

## E. What is right, and worth saying

The plan/apply core is the strongest work in this portfolio so far. `apply`
revalidates the Store metadata layout version, the target-line catalog digest,
both ref OIDs, every reused worktree's ref and HEAD, destination non-existence,
and the index fingerprint before its first write (`apply.ts:73-183`), and the
idempotence carve-out at `:148-159` is reasoned rather than convenient. The
index fingerprint deliberately excludes the plan's own entry so that resuming an
interrupted apply works while a concurrent sibling preparation still invalidates
— and `workspace-apply.test.ts:358` pins exactly that. `planId` is computed from
a body that excludes `createdAt` (`plan.ts:745`), which is the fix that makes
determinism real rather than claimed. The marker filenames match design §5.3
byte for byte (`.rasen/planning-line.json`, `.rasen/planning-binding.json`).
Nothing in this change merges, rebases, force-deletes, or moves a ref — the
§16 prohibitions are respected by the code as written; finding 2 is that the
guard meant to keep them respected does not work, not that they are violated.
