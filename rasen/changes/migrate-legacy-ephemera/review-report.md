# Review Report: migrate-legacy-ephemera

Reviewer: adversarial code review (rasen-review, dispatched mode). Scope: uncommitted diff on
`src/core/work-migration.ts` (new), `src/commands/work.ts` (new), `src/core/project-home.ts`,
`src/core/store/git.ts`, `src/core/completions/command-registry.ts`, `src/cli/index.ts`,
`src/commands/doctor.ts`, `src/core/relationship-health.ts`, and their tests. Cross-checked
against `proposal.md`, `design.md` (D1-D6), and the three delta specs.

## VERDICT: DONE_WITH_CONCERNS — 2 Major, 1 Minor, 1 Trivial-adjacent observation

No Blockers. No data loss found on any path I traced (conflict-skip and per-file try/catch hold
up; EXDEV/EPERM fallback is sound in the success case). Two Major findings both concern silent
deviation from the feature's own documented safety invariants, not lost files.

---

### MAJOR 1 — `--dry-run` / `--json` preview mints identity and writes into the repo, contradicting the codebase's "ensure only at write time" invariant

`src/core/work-migration.ts:291-308` (`runWorkMigration`) calls
`resolveProjectHome(projectRoot, { ensure: true, ... })` **unconditionally** — this happens on
every call, including `options.execute === false` (i.e. `--dry-run`, `--json` without `--yes`,
and the first preview call `work.ts:216` makes before the interactive confirm prompt).

`resolveProjectHome(..., { ensure: true })` (`src/core/project-home.ts:91-118`) mints a
`projectId` into the project's `rasen/config.yaml` if one doesn't exist yet (via
`ensureProjectIdInConfig`) and writes a registry entry (`registerProject`). Both are **writes into
the repository and the global machine registry**, triggered by a command whose own spec
(`specs/work-migration/spec.md` scenario "Dry run moves nothing") says: "the full per-file plan
SHALL be printed and no file SHALL move" — files, yes, but the command also silently dirties
`rasen/config.yaml` and the global registry, which nothing in the proposal/design/spec surfaces
to the user as a `--dry-run` side effect.

This directly contradicts a documented, tested codebase invariant:
`rasen/specs/project-registry/spec.md:22-25`, "Read-only commands never dirty the repo — WHEN a
command that does not need the machine home... runs in a project without a `projectId` THEN no
file inside the repository is created or modified." It also contradicts the established pattern
this very design claims to follow: `src/core/archive.ts:349-358` explicitly **defers** the
identity-minting `ensure:true` "to right before the actual... move, once every gate has passed,"
specifically because "an archive later refused by a gate... must not have already minted machine
identity and written the registry as a side effect of a failed run" (review M6 in that file's
history). `pipeline resume`, `status`, and `context` all probe with `ensure:false` for exactly
this reason (`src/commands/pipeline.ts:306-308`, `src/commands/workflow/status.ts:112-129`,
`src/commands/context.ts:60`).

Design D3's text ("The home is resolved with `ensure: true`... matching the archive-command
precedent") mischaracterizes that precedent — archive only uses `ensure:true` immediately before
the real write, not during its preview/gate phase.

**Concrete failure scenario:** a user in a project with no `projectId` yet runs
`rasen work migrate --dry-run` purely to see what would happen. The command prints "no file SHALL
move" and technically doesn't move any *ephemera* file — but it silently writes a `projectId` into
their `rasen/config.yaml` and registers the project in `~/.rasen`'s global registry, with zero
mention in the output. Re-running with different flags, or a colleague inspecting `git diff`
afterward, finds an unexplained config mutation attributable to a command documented as a preview.

**Evidence this was known, not accidental:** the file's own top comment (lines 12-18) rationalizes
it ("applied uniformly to preview and execute so a preview shows REAL destination paths"), and
`test/core/work-migration.test.ts:400-411` ("reports home_unresolved when the config file cannot
be written") *proves* the preview path (`execute: false`) requires write access to
`rasen/config.yaml` to succeed — i.e. the test locks in the write-on-preview behavior rather than
catching it. No test anywhere asserts that a successful `--dry-run` leaves `config.yaml` /
the registry untouched.

**Fix direction:** resolve with `ensure:false` for the preview/gate phase (matching archive.ts);
if no identity exists yet, either show projected-but-unminted destination paths (home dir "would
be created at ..." style, as archive's own preview does for other axes) or defer minting to the
one call site where `options.execute` is actually true. Re-resolve with `ensure:true` only right
before performing moves.

---

### MAJOR 2 — A transient git-query failure is indistinguishable from "not a git repo," silently bypassing the tracked/untracked opt-in gate (D4)

`src/core/store/git.ts:189-213` (`gitListTrackedFiles`) catches **every** error from
`git ls-files` — binary missing, non-repo path, corrupt `.git`, index lock contention, permission
denied, transient I/O failure — and returns `null` in all cases identically. The doc comment even
says so: "Returns null when `repoRoot` is not a Git working tree or Git is unavailable" — but the
implementation also returns null for "git IS available and the root IS a repo, but this one query
failed for an unrelated transient reason."

The caller, `runWorkMigration` (`src/core/work-migration.ts:311-317`), treats `trackedFiles === null`
as `gitRoot = false` and pushes a note: *"Root is not a Git working tree; every candidate is
treated as untracked."* That note is **factually wrong** when the root genuinely is a git working
tree and the query merely failed. Worse, the consequence isn't just a wrong log line: with every
candidate classified `tracked: false`, in **execute mode** actually-committed files move exactly
as if they were untracked noise —

- The `--include-tracked` opt-in gate (`work-migration.ts:345`) is bypassed entirely; a
  tracked file is moved without the user ever passing `--include-tracked`.
- The commit-guidance block (`work.ts:155-164`) only fires when `f.tracked === true`, so the user
  gets **no** "these deletions are uncommitted, run `git commit -- ...`" warning — the exact
  warning D4 says protects the human when tracked ephemera moves.
- `git status` afterward shows unexplained deletions with no record of why, and if the user's next
  unrelated `git add -A && git commit` sweeps them in, tracked content silently leaves history
  attributable to a command that (per its own spec) is supposed to require explicit opt-in for
  exactly this outcome.

This is not a hypothetical corner case for this environment: this review itself is running in a
repo under concurrent multi-session git/file activity (per the dispatch's own note about a
concurrent session owning other files right now), where transient git-lock contention is a
realistic trigger.

**Test gap confirms it's unhandled, not just undocumented:** `test/core/store/git.test.ts` only
covers the genuine non-git-root case (`:69-76`); there is no test for "git repo exists, `ls-files`
fails for another reason" — the two paths are conflated in both code and test coverage.

**Fix direction:** distinguish "confirmed non-repo" (e.g. probe `git rev-parse --is-inside-work-tree`
or check for `isSpawnNotFoundError`/a specific known non-repo exit signature) from "repo exists but
this query failed," and refuse to auto-classify as untracked in the latter case — either abort the
run with a clear diagnostic ("could not determine git tracked-ness; try again") or, at minimum,
label the note distinctly enough that execute-mode does not silently move real tracked content.

---

### MINOR — Doctor's migratable-ephemera count doesn't distinguish tracked from untracked, so the suggested fix command may not clear it

`src/commands/doctor.ts:126-131` calls `countMigratableEphemera(root.changesDir)`
(`src/core/work-migration.ts:179-186`), which sums **all** scanner candidates with no tracked/
untracked classification (that split only happens later, inside `runWorkMigration`, which doctor
never calls — by design, to stay read-only). In a repo with many git-tracked legacy reports (e.g.
upstream-era archives, exactly the case this repo's own live smoke test flagged: "tracked
upstream-era files reported as skipped"), doctor will hint "Migratable legacy ephemera: N (run
`rasen work migrate`)" — the user runs the suggested command, it moves 0 files by default (all N
are tracked, skipped, reported), and the doctor hint count is unchanged on the next run. The hint
doesn't lie (the files genuinely are migratable, via `--include-tracked`), but the suggested
command text doesn't mention that condition, so the natural first attempt looks like it did
nothing. Cosmetic/UX-only — no correctness or safety issue. Consider either counting
untracked-only for the hint (requires a git call doctor currently avoids) or wording the hint as
"N ephemera found (some may require `--include-tracked`)".

---

### Observations that are NOT findings (checked, clean)

- **Conflict/overwrite safety**: `pathExists` check precedes every move in both preview and
  execute (byte-identical logic per the file's own doc comment); a pre-existing destination is
  always skipped and reported as `conflict`, never overwritten in either direction. Confirmed no
  overwrite path exists.
- **Cross-volume / EXDEV / EPERM**: `moveFileSafe` (`work-migration.ts:255-268`) falls back to
  copy+rm on `EXDEV`/`EPERM`; the happy path is correct. One narrow residual: if `copyFile`
  succeeds but the subsequent `fs.rm(source, { force: true })` throws for a non-ENOENT reason
  (e.g. `EBUSY` on Windows), the exception propagates to the per-candidate catch and the file is
  reported `status: 'failed'` — but by then the copy already landed at the destination, so the
  true state is "duplicated, not moved," not "nothing happened" as `'failed'` implies. Re-running
  would then report a false `conflict` for a file that's actually already safely copied (source
  just wasn't cleaned up). No data loss, but the status label is misleading in this one sub-case.
  Noting as a durable finding, not blocking (narrow trigger: copy-then-delete-fails specifically).
- **Symlinks**: `safeReaddir`'s `Dirent.isDirectory()`/`isFile()` checks do not match symlinks
  (dirent type reflects the link itself), so a symlinked file or directory inside a change dir is
  silently skipped by the scanner — not moved, not reported as a note either. Safe (nothing lost)
  but silently incomplete; not spec-required, no finding raised beyond this note.
- **Path length / Windows 260-char paths**: any `ENAMETOOLONG`-class failure surfaces through the
  same per-candidate `try/catch` as any other move failure → reported as `'failed'`, run continues,
  source untouched (fails before any write in that case). Handled correctly.
- **Migrate-set correctness**: scanner matches D2 exactly — run-state trio, `handoff/` recursive,
  `verification-report.md`, `ship-log.md`, `*-report.md`; hard exclusions
  (proposal/design/tasks/specs/.openspec.yaml/office-hours-design.md/retro.md) enforced by
  construction (only `handoff/` is recursed into) not by a denylist; report-like non-candidates
  (`*-review.md`, `*-audit.md`) correctly produce notes, not moves. Verified against
  `test/core/work-migration.test.ts:72-124`.
- **--json / --yes semantics**: verified both in code (`work.ts:195-198`) and tests
  (`test/commands/work.test.ts:48-142`) — `--dry-run` always preview; `--json` alone previews;
  `--json --yes` executes; exit codes are 0 for success/no-op, 1 for `--change` matching nothing.
  Sane for automation.
- **Path construction on Windows**: `git ls-files -- rasen\changes` (backslash pathspec) returns
  correct results on this Windows/git-for-windows install — verified directly, not a real risk.
  `path.join(repoRoot, entry)` in `gitListTrackedFiles` and every `candidate.source` build in
  `work-migration.ts` derive from the exact same `root.path`/`changesDir` strings
  (`root-selection.ts:121-122`), so no casing/prefix mismatch between the tracked-set keys and
  candidate source paths.
- **Destination collision-freedom**: `archivedWorkDir` is keyed by the full date-prefixed on-disk
  archive directory name (`project-home.ts:68-70`), distinct from `workDir(name)` by construction;
  confirmed via the design's own reasoning and the layout addition's shape.
- **Completions parity**: the new `work` group + `migrate` subcommand in
  `command-registry.ts:875-908` matches `work.ts`'s actual Commander flags exactly (`--change`
  takesValue, `--dry-run`/`--include-tracked`/`--json`/`--yes` boolean). No drift.
- **No template files touched**: confirmed via `git status --porcelain` — this change is CLI-only,
  as the proposal states.
- **Doctor stays read-only for the hint**: `countMigratableEphemera` never calls
  `resolveProjectHome`, confirmed both by reading the function and by
  `test/core/work-migration.test.ts:172-184` ("countMigratableEphemera counts candidates without
  resolving any home... No home was minted").

---

## Durable findings for the LEAD (top 3, most load-bearing)

1. **MAJOR** — `runWorkMigration` mints `projectId`/registry state on preview (`--dry-run`,
   `--json` without `--yes`, and the interactive pre-confirm call), violating the codebase's own
   "ensure only at write time" invariant (`project-registry/spec.md` scenario "Read-only commands
   never dirty the repo") and misdescribing the archive-command precedent it claims to follow.
   `src/core/work-migration.ts:291-308`.
2. **MAJOR** — `gitListTrackedFiles` conflates "confirmed non-git-root" with "git query failed for
   any other reason," and `runWorkMigration` silently treats the latter as untracked — bypassing
   the `--include-tracked` opt-in gate and the commit-guidance warning for genuinely tracked files
   on any transient git failure. `src/core/store/git.ts:189-213`,
   `src/core/work-migration.ts:311-317`, `src/commands/work.ts:155-164`.
3. **MINOR** — Doctor's migratable-ephemera count doesn't split tracked/untracked, so the hint's
   suggested command (`rasen work migrate`) may move 0 files when the pending ephemera are mostly
   tracked, without saying so. `src/commands/doctor.ts:126-131`.

---

## Round 2 — delta re-review

Re-reviewed only the fix delta for M1, M2, m1, and the noted `moveFileSafe` sub-case, against the
current state of `src/core/work-migration.ts`, `src/core/store/git.ts`, `src/commands/work.ts`,
`src/commands/doctor.ts`, `src/core/relationship-health.ts`, their four test files, `design.md`,
and the two updated delta specs. Ran the targeted suite myself rather than trusting the claim:

```
npx vitest run test/core/work-migration.test.ts test/commands/work.test.ts \
  test/core/store/git.test.ts test/core/project-home.test.ts \
  test/core/relationship-health.test.ts test/commands/doctor.test.ts
→ 6 files, 75 tests, all passed
```

### M1 — CONFIRMED FIXED

`runWorkMigration` now resolves the home with `ensure: options.execute` (`work-migration.ts:402-417`).
Verified the critical ordering directly: the mint-or-fail resolution happens in full — including the
`!home && options.execute → { ok:false, reason:'home_unresolved' }` early return — *before* the
per-change move loop begins (`work-migration.ts:438`). There is no code path where a second
`ensure:true` resolution can fail *after* some files have already moved; a failed mint on an execute
call aborts with zero moves, by construction, not by convention. Confirmed both by reading the
control flow and by test `'M2: fails closed...'`/`'reports home_unresolved when the config file
cannot be written on an execute call (M1)'` (`work-migration.test.ts:444-455`), which shows the abort
happening with the target file still in place.

Preview calls (`execute:false`) now resolve with `ensure:false` (never mint) and, when no identity
exists yet, set `identityPending:true` with every `destination`/`workDir` null plus an explanatory
note — never a mint, never a hard failure. Verified byte-for-byte via
`work-migration.test.ts:461-513` (config.yaml and the global registry directory provably untouched
across repeated and `--include-tracked`-flavored preview calls) and the CLI-level equivalent in
`work.test.ts` ("M1: --dry-run on an unregistered project never mints identity"). `design.md`'s D3
now carries an explicit correction paragraph that accurately describes `archive.ts`'s actual
deferred-mint pattern (no longer misattributing it), and `work-migration/spec.md` gained the "A
preview never mints machine identity" scenario matching this behavior. This closes the finding as
described; no residual gap found.

### M2 — CONFIRMED FIXED, with one narrow residual noted (not blocking)

`isConfirmedGitWorkTree` (`git.ts:201-218`) now uses `git rev-parse --is-inside-work-tree` as the
sole source of "confirmed non-git root," matching the exact upward-walking resolution `git ls-files`
itself uses — so it cannot diverge from what a tracked-files query would actually see (ruling out the
"nested inside a parent repo" false-negative class of bug). `runWorkMigration` now calls this first
and fails closed (`git_query_failed`, no files moved) on `null`, and separately fails closed if
`gitListTrackedFiles` itself fails even after `isConfirmedGitWorkTree` confirmed a real repo
(`work-migration.ts:376-391`). Verified with a real corrupted-`.git/index` repro
(`work-migration.test.ts:519-537`, plus the equivalent in `countMigratableEphemera`'s
`'reports splitUnavailable...'` test and `work.test.ts`'s `'M2: a git query failure...'` CLI test) —
all three levels confirm zero moves and zero identity minting on the abort path. The "confirmed
non-git root still proceeds as untracked" regression test (`work-migration.test.ts:539-549`) confirms
the legitimate non-git case wasn't collateral damage.

Adversarial checks on the three-way detector specifically:
- **Inside `.git` itself / linked-worktree gitdir file**: not a realistic trigger — `repoRoot` here
  is always `resolveRootForCommand`'s resolved project root (a directory containing `rasen/`), never
  `.git` itself, and git's native `-C <dir> rev-parse --is-inside-work-tree` already resolves linked
  worktrees correctly via their `.git` gitdir-file redirection (standard git behavior, not something
  this code needs to special-case). No case found where a genuine work tree gets misclassified `false`.
- **Bare repository**: `--is-inside-work-tree` prints `false` for a bare repo (git's own accurate
  answer — a bare repo has no work tree). Reported as "confirmed non-git," which is correct: a bare
  repo cannot contain the working-tree ephemera files this command looks for in the first place, so
  there's nothing unsafe about treating it as "nothing to classify as tracked."
- **Git binary entirely absent from PATH** (residual, narrow, safe-direction): `isSpawnNotFoundError`
  still routes to `null` (same as any other query failure), so a machine with no `git` on PATH now
  gets `git_query_failed` — the command refuses entirely — even for a plain non-git project with no
  `.git` directory anywhere in the tree, where pre-fix behavior would have gracefully treated
  everything as untracked and proceeded. This is a genuine behavior change introduced by this delta
  (the fix collapsed the OLD two-case split — "definitely no repo" vs "query failed" — into the same
  `null`-fails-closed bucket for *this* sub-case too, since a missing binary can't be distinguished
  from "query failed on a real repo with a currently-broken git" using only `rev-parse`). It trades
  usability for safety in the correct direction (declining to assume "no tracked content" just
  because this session can't currently ask git), and the failure mode is a clear refusal with a fix
  suggestion, not silent data risk — so I'm not raising it to Major. But it is untested (no test
  exercises the missing-binary branch of `isConfirmedGitWorkTree`, only the corrupted-index and
  non-git-root branches) and unmentioned in either correction paragraph, so it's worth the LEAD
  knowing this sub-case exists as a deliberate-but-unexamined trade-off rather than an oversight to
  silently carry forward. **Grading: Minor, informational — not a fix-blocker.**

### m1 — CONFIRMED FIXED

`countMigratableEphemera` now takes `(projectRoot, changesDir)`, returns
`{total, untracked, tracked, splitUnavailable}`, and is wired through `doctor.ts:126-131` /
`relationship-health.ts` to print e.g. `"48 untracked (+115 tracked, needs --include-tracked)"` or
the `splitUnavailable` fallback — never a bare misleading total. Confirmed it still never calls
`resolveProjectHome` (only `isConfirmedGitWorkTree` + `gitListTrackedFiles`, both read-only), so
doctor's read-only contract holds. `project-registry/spec.md`'s requirement text and scenario were
updated to match. Test coverage for both the split and the `splitUnavailable` fallback exists in both
`work-migration.test.ts` and `doctor.test.ts` and passed in my run.

### `moveFileSafe` sub-case — CONFIRMED FIXED (message-only, as scoped)

The delete-after-copy-fails branch (`work-migration.ts:322-338`) now throws an error whose message
explicitly says the file is "DUPLICATED, not lost" and that a re-run will report it as a conflict —
matching exactly what was asked (status stays `'failed'`, no new status enum, but the message no
longer implies nothing happened). No dedicated test exercises this exact branch (it requires
simulating a successful copy followed by a failing `rm`, which none of the four delta test files
attempt) — the fix is correct on inspection but unverified by an automated test. Not blocking: this
was already flagged in round 1 as a narrow, non-blocking sub-case, and the fix is a message-wording
change with no logic change to re-derive.

### Answers to the four adversarial questions posed

- **(a) M1 half-executed-run risk**: none found — mint-or-abort happens in full before the move loop;
  verified in code and by test.
- **(b) M2 three-way detector edge cases**: no case found where a genuine repo is misclassified
  `false` (fail-open reopened); one narrow, safe-direction, untested behavior change found for the
  "git binary entirely missing" sub-case — see above, graded Minor.
- **(c) `identityPending` JSON schema stability**: stable. Keys (`workDir`, `destination`,
  `identityPending`) are always present; only their value type is a documented `string | null` union
  rather than a sometimes-missing key, which is the correct pattern for automation consumers (fixed
  key set, discriminate on value). No finding.
- **(d) New findings in the delta**: one — the Minor missing-git-binary sub-case above. No other new
  issues found; all three original findings plus the sub-case are fixed as claimed and independently
  verified (code inspection + a live 75/75 test run, not just trusting the report).

## VERDICT — Round 2: CLEAN (0 Blocker, 0 Major, 1 new Minor, all round-1 findings resolved)

M1 and M2 (the two Majors) are fully fixed and independently verified — both the happy path and the
specific failure-ordering/fail-open concerns I was asked to re-check. m1 (the Minor) is fixed. The
`moveFileSafe` sub-case is fixed as scoped (message-only). One new Minor surfaced during adversarial
probing of the M2 fix (git-binary-entirely-missing degrades to refusal rather than graceful
non-git-root handling) — informational, safe-direction, not a blocker, and worth a one-line mention
to the LEAD but does not warrant another fix round on its own. This change is ready to ship from a
review standpoint.
