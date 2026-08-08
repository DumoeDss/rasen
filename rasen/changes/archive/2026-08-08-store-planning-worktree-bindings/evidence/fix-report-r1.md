# store-planning-worktree-bindings — fix report, round 1

Fixer: independent (wrote neither the code nor the review). Input:
`evidence/review-report.md`, 12 findings (3 high, 2 medium, 7 low) plus §C's
four non-discriminating guards.

**11 fixed, 1 fixed with a reasoned partial rejection (8), 0 deferred.** Every
fix carries a test that was proven to fail with the fix reverted; the reverts
and their observed failures are recorded per finding below and summarized in §3.

---

## 1. Findings, one line each

| # | Sev | Verdict | Where |
| --- | --- | --- | --- |
| 1 | HIGH | **FIXED** | `cleanup.ts` `sessionReferencedRoots` resolves its own machine-root default |
| 2 | HIGH | **FIXED** | `workspace-git-verb-guard.test.ts` rewritten: declaration-anchored strip, position-independent verb matcher, new single-spawn-site check, injection sweep |
| 3 | HIGH | **FIXED** | `module.ts` `describe` picks by the caller's location, or reports nothing |
| 4 | MED | **FIXED** | `dependencies.ts` `ls-files`/`status` now use `-z` |
| 5 | MED | **FIXED** | `locks.ts` `lockIsHeld` mirrors the acquire protocol; refusal names the lock file |
| 6 | LOW | **FIXED, partially rejected** | tautological pair kept and documented; three preconditions that CAN fail added |
| 7 | LOW | **FIXED** | `module.ts` `completeChangeBinding` uses the shared `assertCarrierAgreesWithScope` |
| 8 | LOW | **HALF FIXED, HALF REJECTED** | `workspace_git_failed` now carried; `workspace_dirty_tree` left declaration-only, see §2 |
| 9 | LOW | **FIXED** | `vocabulary-sweep.test.ts` gains a staleness assertion |
| 10 | LOW | **FIXED** | `cleanup.ts` `cleanupGateError` arithmetic |
| 11 | LOW | **FIXED** | `cleanup.ts` re-runs reachability AND the index fingerprint as a pre-pass |
| 12 | LOW | **FIXED** | `CleanupTarget.mainCheckout` frozen at plan time drives the prune |

---

## 2. What was fixed, and why that shape

### 1 — precondition 7 was inert on the production path

`sessionReferencedRoots` now resolves `globalDataDir ?? getGlobalDataDir()`,
mirroring `dependencies.ts:463`. The reviewer offered two options — thread the
argument from the CLI, or make the default mean "the real machine root" — and
the second is right: the first leaves the next caller that omits it with a
fail-open gate, and "satisfied" is the wrong default for a fail-closed
precondition.

Three tests, because the reviewer's diagnosis was that the fixture makes this
class invisible by construction:

- two at unit level with `globalDataDir` supplied (a referencing session; an
  unreadable context file, which is the fail-closed half that also could never
  fire);
- one at unit level that supplies **nothing** — `new StoreWorkspace(deps)` with
  no options and `planCleanup` with no machine root, with `RASEN_HOME` pointed
  at the fixture so the Module's own default resolution is what finds the
  session. This is the shape `src/commands/workspace.ts` actually uses;
- one through the **real CLI** (`test/commands/workspace-cli.test.ts`), where no
  test code passes a machine root at any layer.

### 2 — the verb guard had two demonstrated bypasses

Both confirmed, and a third the reviewer did not name (see §5). The guard is now
three checks:

1. `withoutVerbDeclarations` is anchored on `const <NAME>`, not on the bare name.
   Measured on the current `dependencies.ts`: the old regex removed **2,903**
   characters and deleted `execFilePromise('git'` outright; the new one removes
   **462** and keeps every adapter function.
2. The verb matcher is position-independent — a quoted verb following `[` or `,`
   — so `['-C', cwd, 'branch', …]` is visible. `git worktree add` is carved out
   by collapsing the permitted `'worktree', '<subcommand>'` pairing first, so
   `'add'` in any other element position is still an offender. Swept against the
   real sources: **zero false positives**.
3. A new check reads the EXECUTABLE, not the arguments: the literal `'git'` and
   the `node:child_process` import may each appear exactly once, both in
   `dependencies.ts`. That is what keeps `spawnGit`'s runtime allow-list on the
   only path to Git — the second half of the reviewer's finding, where the
   bypass evaded the source guard *and* the runtime check.

The synthetic-string case is kept but demoted; the discrimination proof is now an
**injection sweep**: three real bypasses inserted after every line of the real
`dependencies.ts` where a statement can legally go (declaration-body lines
excluded, and that exclusion is itself asserted to be under 30 lines — the broken
strip would have made it 65 larger). Zero missed sites. Runtime: 135 ms.

### 3 — `rasen context` reported an arbitrary Change

`describe` without `changeId` no longer takes `entries[0]`. One entry is
returned as before; with several, the only thing permitted to decide is the
caller's own `startPath` — the worktree the command is running inside. When the
location decides nothing, **no pair is reported at all**, with a
`workspace_binding_ambiguous` finding naming every candidate and telling the
caller to pass `--change`. That is "absent facts SHALL be absent rather than
guessed" applied literally.

Note the deliberate choice: `bindingState` stays `unbound` and `prepared` stays
`false` for the undecided case, because there is no fifth state and reporting
one of several pairs is the defect. The finding carries the truth.

### 4 — Git's path quoting

Fixed with `-z` on both `ls-files --others` and `status --porcelain=v1` rather
than by writing an octal decoder. `-z` removes the encoding step entirely: Git
emits raw bytes and separates on NUL, so a path with a newline in it survives
too, and there is no decoder to get wrong. Nothing is trimmed any more, because
a leading or trailing space is part of the name.

### 5 — stale locks, and the unnamed path

`lockIsHeld` reads the lock file and reports NOT held only when the recorded pid
is provably dead — the same test `acquireOwnerAwareFileLock` applies before it
steals. Everything the acquirer would wait on still blocks: a live owner, a
pid-less file, and a file this process cannot read (ENOENT alone means absent).

The liveness predicate is **exported from `src/core/file-state.ts`** as
`fileLockOwnerIsProvablyDead` rather than reimplemented in `locks.ts`. That is a
one-function addition to a file outside child 4's listed scope — see §6 — and it
is the right call: duplicating the ESRCH/EPERM/unknown-error rules is exactly
the divergent-second-implementation shape finding 7 is about.

The refusal now names the lock FILE beside the label.

### 6 — the containment tautologies

**Partially rejected, and the rejection is the substance.** The two named
preconditions are kept: they state the invariant and would fire if the marker
location ever became configurable, and deleting a precondition the task text
names is worse than keeping an honest one. But the reviewer's real point —
"the roots themselves … are never containment-checked against anything" — is
addressed by three preconditions that CAN fail:

- `planning-root-outside-repository` / `execution-root-outside-repository`: a
  worktree nested inside its own repository appears there as untracked content,
  which contradicts "the integration checkout SHALL remain byte-identical".
- `pair-roots-disjoint`: the two planned roots may be neither equal nor nested.
  This closes a reachable hole the review did not name — see §5.

The comment above the original pair now says in as many words that they cannot
fail and why the new ones exist.

### 7 — the divergent marker check

`completeChangeBinding` now calls `assertCarrierAgreesWithScope`, the existing
three-field helper, instead of comparing two fields inline. Its `storeUid`
branch's repair hint was reworded to the same "neither carrier is rewritten to
agree" clause the other two branches use, so all three state one rule; no test
was rewritten to accommodate that (the pre-existing assertion on that clause
passes unchanged).

### 8 — declaration-only taxonomy members

**`workspace_git_failed`: fixed.** `WorkspaceGitCommandError` now extends
`StoreWorkspaceError` with that code. That fixes BOTH agent-facing surfaces at
once — `statusFromError`'s duck-typed `error.diagnostic` (the resolver seam the
reviewer named) and `src/commands/workspace.ts`'s `fail()`, which tests
`instanceof StoreError` and therefore also missed it (the reviewer did not name
this half).

**`workspace_dirty_tree`: rejected, with evidence.** The reviewer's own verdict
is that it is unreachable by design, and the spec forecloses the obvious fix:
`specs/store-planning-worktree-bindings/spec.md` says "Any unsatisfied
precondition SHALL fail with `workspace_cleanup_unsafe`", so re-coding cleanup's
precondition 4 to `workspace_dirty_tree` — which `design.md:160`'s table would
otherwise suggest — would contradict the requirement. Removing the member
instead would require editing `proposal.md`'s enumerated closed taxonomy and the
design table, which is a product decision, not a review fix. Left as declared,
and flagged for the shipper in §6.

### 9 — allow-list staleness

Mirrors the staleness check the first test in the same file already carries.

### 10 — the nonsense count

`plan.targets.length * 8`, with `'a recorded pair'` for the no-target case
(where `0 preconditions satisfied` would have been a second nonsense number).

### 11 — advisory reachability, self-satisfying fingerprint

Both re-checked in a **pre-pass over every target, before the first removal**.
Interleaving the check with the removal loop would refuse only after the
execution side was already gone, which is the partial removal the capability
forbids — so the pre-pass shape is load-bearing, not stylistic. The fingerprint
is compared against the CURRENT index, which is what makes it non-vacuous; the
plan's own entry is excluded from the fingerprint, so resuming an interrupted
cleanup still works (verified: the resume case stayed green).

### 12 — the skipped prune

`CleanupTarget` gained `mainCheckout`, resolved at PLAN time while the worktree
still exists. A directory deleted by hand between preview and apply cannot
answer for its own repository, which is why the live resolution the reviewer
found `continue`d past could not simply be moved.

---

## 3. Discrimination — what was observed with each fix reverted

Each row: the production line reverted, the test run, and the result. Every fix
was restored afterwards and re-run green.

| # | Revert | Observed |
| --- | --- | --- |
| 1 | restore `if (globalDataDir === undefined) return { roots: [], unreadable: [] }` | `× scans sessions under the REAL machine root when no data directory is threaded`. **The two precondition-7 tests that DO pass a machine root stayed green** — the reviewer's diagnosis about the fixture, reproduced exactly. |
| 2a | restore the name-anchored `withoutVerbDeclarations` | 2 failed: `× strips the verb declarations without deleting the code around them` and `× fails on a forbidden verb inserted ANYWHERE…`, the latter listing missed sites at lines 244–292 of the adapter |
| 2b | restore the first-element `\[\s*` anchor **and** disable the spawn-site check | `× fails on a forbidden verb inserted ANYWHERE…`, missing `execFilePromise('git', ['-C', repoRoot, 'branch', '-D', branch])` at **every** insertion point (lines 1…n) |
| 3 | `entries.length <= 1` → `<= 99` (i.e. always take `entries[0]`) | 2 failed: `× reports the pair of the worktree it is standing in when a scope holds several`, `× reports NO pair, and names every candidate…` |
| 4 | restore line-splitting + quote-stripping in both adapter methods | 2 failed: `× lists and removes an untracked file whose name is not ASCII`, `× reports a modified non-ASCII tracked path as itself` |
| 5a | restore `lockIsHeld` to bare `fs.access` | `× does not call a lock held when its owner is provably dead…` |
| 5b | drop the lock path from the held-lock record | `× refuses while a scope lock is held elsewhere, and names the lock FILE` |
| 6 | force `inside`/`nested` to `false` | 2 failed: `× refuses a planned root inside its own repository checkout`, `× refuses a pair whose two roots are the same path or nested` |
| 7 | re-guard the shared call behind the old two-field comparison | `× refuses to complete a binding whose marker names another STORE` |
| 8 | `WorkspaceGitCommandError extends Error` | `× surfaces a Git failure as workspace_git_failed, on the seam that has no fallback` |
| 9 | add a fake token to the allow-list | `× keeps the deleted workspace/initiative token surface from regrowing` at the **staleness** assertion (line 201), message `allow-list entries no longer present in src/:` |
| 10 | restore `blockers.length + targets.length * 8` | `× lists every failed precondition at once…` |
| 11a | remove the `revalidateBeforeRemoval` call | `× re-checks reachability before the first removal, and removes nothing when it fails` |
| 11b | (same revert) | `× refuses an apply after a sibling Change was prepared in the same scope` |
| 12 | remove `mainCheckouts.set` from the already-absent branch | `× prunes the repository of a side that vanished between preview and apply` |

Batch runs, for the record: reverts 1/4/8/10 together produced **exactly 5
failures and 19 passes**, and reverts 5/11/12 together produced **exactly 5
failures and 19 passes** — in both cases only the intended tests, nothing else.

Two assertions were written to be self-discriminating rather than trusted:

- the prune test asserts Git DOES list the stale worktree before apply and does
  not after, because `git worktree list --porcelain` prints forward slashes on
  Windows and a naive `not.toContain(nativePath)` would have passed vacuously;
- the verb guard's `does not fire on the permitted neighbours` case pins that
  `merge-base`, `worktree add`, `objectType === 'commit'` and `{ kind: 'add' }`
  are NOT offenders, so the broadened matcher cannot be "fixed" into firing on
  everything.

---

## 4. Gates

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx eslint src test` | clean (no output) |
| `node bin/rasen.js validate store-planning-worktree-bindings --strict` | `Change 'store-planning-worktree-bindings' is valid`, EXIT=0 |
| `git diff --check` | clean, exit 0 |
| Encoding/whitespace audit, 15 touched files (BOM, CRLF/LF mixing, U+FFFD, NUL, trailing whitespace, trailing newline) | clean; `file-state.ts` and `vocabulary-sweep.test.ts` sit CRLF in the working tree and the edits preserved it (no MIXED) |
| `test/core/store/**`, `test/core/store-planning/**`, `test/vocabulary-sweep.test.ts`, `test/core/session-runtime-context.test.ts` | 69 files, **1069 passed, 2 skipped, 0 failed** |
| `test/cli-e2e/**`, `test/commands/pipeline-store-root-selection.test.ts`, `test/core/completions/**` | 21 files, **408 passed, 13 skipped, 0 failed** |
| `test/commands/workspace-cli.test.ts`, `context-workspace.test.ts`, `store-v2-workspace-journey.test.ts`, `store-v2-workspace-concurrency.test.ts` | 4 files, **26 passed, 0 failed** |
| `test/commands/store-target-line-cli.test.ts`, `legacy-groups-removed.test.ts`, `store-v2-planning-scope-journey.test.ts` | passed |

**Failing files: none.** Enumerated, not extrapolated.

Two transient batch failures were observed and are NOT defects, each verified by
re-running the same file in isolation immediately afterwards:

- an 8-file `test/commands/` batch reported 5 failures across
  `context-workspace.test.ts`, `workspace-cli.test.ts`,
  `store-v2-workspace-journey.test.ts` and
  `store-v2-workspace-concurrency.test.ts`; the same four files then passed
  26/26 as a batch, and each passed individually. This is the pre-declared
  concurrent-rebuild hazard.
- Vitest's `globalSetup` refused to start five times during this session because
  a sibling agent's in-flight edit did not compile — `membership-layout.ts`,
  `archive-consumer-invocation.ts`, and `layout-migration/plan.ts` in turn. None
  is child 4's file; each cleared on its own.

The 5 pre-declared environmental failures (`config.test.ts` ×1,
`config-editor.test.ts` ×4) were not run and not touched.

---

## 5. What the review missed

1. **The force-flag exemption was a proximity window.** `forceFlagMatcher`'s
   offender loop exempted any match within ±200 characters of the string
   `may never force a worktree removal`. A forced removal added anywhere near
   the runtime refusal would have been waved through. Found by adding a third
   shape to the injection sweep; the exemption is now keyed to the exact runtime
   condition (`arg === '--force' || arg === '-f'`), not to a window.
2. **A pair can be planned with both sides at one destination.** Nothing
   prevented `--planning-worktree X --execution-worktree X`, or one nested in
   the other. The plan-time destination-exists check reads disk before either is
   created, so both sides pass; apply then creates the planning side and the
   execution `worktree add` fails with a raw Git error. Now
   `pair-roots-disjoint`.
3. **Finding 8's CLI half.** The reviewer wrote that the `workspace_*_failed`
   fallbacks "cover only the CLI group", implying the CLI group was fine. It was
   not: `fail()` tests `instanceof StoreError`, and a bare
   `WorkspaceGitCommandError` is not one, so a Git failure surfaced there as
   `workspace_cleanup_failed`/`workspace_plan_failed` too — the generic bucket,
   one level down. One change fixed both.
4. **`CleanupTarget.repositoryRoot` is the worktree, not the repository.**
   `buildCleanupTarget` sets `repositoryRoot: recorded.root`. That is why
   finding 12 had no repository to prune from once the directory was gone. I
   added `mainCheckout` rather than repairing `repositoryRoot`, because other
   consumers may read the field and changing its meaning is a wider decision.
   **Worth a follow-up:** the field as it stands carries no information.
5. **The lock-semantics change crosses into child 5.**
   `test/core/store/finalization-plan-token.test.ts` imports child 4's
   `lockIsHeld` at four call sites. All four stayed green (they probe absent
   locks and live in-process holders, neither of which the new semantics
   changes), but the coupling is worth knowing before either side is edited
   again.
6. **The `2,775 characters` figure in finding 2(a) is 2,903 on the current
   file.** Immaterial to the finding; recorded so the number is not re-derived
   and mistrusted later.

---

## 6. Boundaries, and one thing for the shipper

**Touched outside child 4's listed scope, deliberately and additively:**
`src/core/file-state.ts` gains exactly one exported function,
`fileLockOwnerIsProvablyDead`, and nothing else in that file changed. It is not
a child 5 file and not on the exclusion list. The alternative was a second copy
of the ESRCH/EPERM liveness rules inside `locks.ts`.

**Left alone because it belongs to child 5:** nothing had to be. No file under
`src/core/store/finalization/**`, `src/core/archive*.ts`, or the finalization
additions to `src/core/management-api/` was read for edit or modified.

One observation across that boundary, reported rather than fixed: for part of
this session `test/vocabulary-sweep.test.ts` was RED on the shared branch because
child 5's `workspace_pair_unavailable`
(`src/core/store/finalization/{record,types}.ts`) had no ledger entry. I did not
add it — writing another child's ledger justification is exactly what that
ledger exists to prevent. Child 5's implementer added it, with their own
reasoning, before the final gate run; it is green now.

**For the shipper:** `workspace_dirty_tree` remains a declared member of the
closed refusal taxonomy (`proposal.md`, `design.md:160`, `types.ts:347`) that no
code path can raise, and the spec's "any unsatisfied precondition SHALL fail with
`workspace_cleanup_unsafe`" is what makes it unreachable. Either the proposal
drops it or the design table stops promising it; both are product edits.

**Human/JSON parity note:** `CleanupTarget` gained `reachableFrom` and
`mainCheckout`, which appear in `cleanup --json` (the payload passes `targets`
through) and are not printed in the human form. `reachableFrom` is already
stated in prose by precondition 6's detail; `mainCheckout` is machine plumbing,
like `indexFingerprint`. Flagged rather than silently accepted.
