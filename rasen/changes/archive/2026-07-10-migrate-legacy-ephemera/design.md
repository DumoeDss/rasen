# Design: migrate-legacy-ephemera

## Context

The externalize-artifacts portfolio (5 children, all shipped) established: T3 ephemera live at `resolveChangeWorkDir(...)` = `<gdd>/projects/<home>/changes/<name>/work/` for new changes; pre-existing files follow sticky-legacy (readers check workDir first, fall back to the change dir; files stay where born). This change is the deferred ACTIVE migration path. Verified current state:

- **Resolution APIs on disk**: `resolveChangeWorkDir(projectRoot, changeName, {ensure?})` (probe-first/mint-once, swallows errors → null) and `resolveArchiveDestination` in `src/core/change-work.ts`; the frozen `resolveProjectHome(...).workDir(name)` in `src/core/project-home.ts` — the HOME LAYOUT OWNER (siblings never re-derive paths).
- **GC semantics** (`gcProjectRegistry`, `src/core/project-registry.ts`): deletes only TOP-LEVEL directories under `<gdd>/projects/` whose name matches no registry entry's `home` field. Everything inside a referenced home is safe — including new layout areas this change adds.
- **Command taxonomy** (`src/cli/index.ts`): `rasen migrate [path]` is the openspec→rasen BRAND migration (copy-only, takes a positional) — colliding with it is not an option. Group precedents exist: `new`, `pipeline`, `agent`, `change`, `completion`.
- **Current pain measured**: 41 untracked `auto-run.json`/`portfolio-run.json` under `rasen/changes/archive/**` in this repo, plus legacy ephemera in active/archived change dirs; upstream-era archives also contain TRACKED (committed) artifacts.
- **The recycled-name wart** (portfolio findings): workDir is keyed by change NAME; archived dirs are `archive/YYYY-MM-DD-<name>`. A live change can share a name with an archived one — migration targeting must not merge their state.
- The CLI's sanctioned git surface is read-only porcelain/plumbing queries; it never runs git write commands (portfolio-wide invariant).

## Goals / Non-Goals

**Goals:**
- One idempotent command that moves legacy in-repo T3 ephemera to the machine home; the 41-file untracked noise disappears in a single default-safe run.
- Archived and active changes migrate to non-colliding, GC-safe destinations.
- The git boundary stays intact: untracked moves are free; tracked moves are opt-in and leave commits to the human.
- Preview-first UX; per-file honesty (moved / skipped-tracked / conflict / unknown-report-like).

**Non-Goals:**
- Committing deletions, rewriting history, or any git write.
- Migrating T2/T4 content, `retro.md`, `.openspec.yaml`, or repo-level `rasen/handoff/<topic>.md` (no change scope — pre-existing follow-up).
- Sweep/retention of work dirs; store-mode planning-content relocation.
- Watching or auto-running migration (user-invoked only; doctor only hints).

## Decisions

### D1. Command surface: a new `work` group — `rasen work migrate`

`rasen migrate` is taken (brand migration with a positional path; overloading it with subcommands is a breaking parse change and conflates two unrelated migrations). A `work` group names the machine-home work-dir surface and leaves room for `work path <change>` / `work sweep` later. Flags: `--change <name>` (scope to one active or archived change), `--dry-run` (preview only), `--include-tracked`, `--json`, `--yes` (execute without prompt; REQUIRED for execution in `--json` mode — non-interactive runs never move files without it, matching the archive command's `--yes` idiom). Default interactive flow: scan → per-file preview → confirm → execute → report. Registered in `command-registry.ts` for completions.

### D2. Migrate set = the `change-work-dir` capability's enumeration, applied conservatively

Per change directory (active: `rasen/changes/<name>/`; archived: `rasen/changes/archive/<date-name>/`):

- **Move**: `auto-run.json`, `portfolio-run.json`, `goal-run.json`; the `handoff/` directory wholesale (including `relay-prompt.txt`); `verification-report.md`; `ship-log.md`; `*-report.md` (covers the canonical six and other expert reports — matching what ship's pre-flight accepts as evidence).
- **Never move**: `proposal.md`, `design.md`, `tasks.md`, `specs/`, `.openspec.yaml`, research docs, `office-hours-design.md`, `retro.md` (child 2 deliberately left retro output placement unchanged).
- **Report, don't move**: report-LIKE files outside the set (`*-review.md`, `*-audit.md` — quality-capture inputs, already stamped at archive time for existing archives) and the fact that custom goal-loop `runArtifact` filenames cannot be detected statically. Honesty over completeness.

### D3. Destinations: active → `workDir(name)`; archived → a new `archivedWorkDir(dateName)` layout area

Active changes use the existing frozen `workDir(name)`. Archived changes get `<home>/changes/archive/<archived-dir-name>/work/` — added to `src/core/project-home.ts` (the layout owner) as a new `ProjectHome` member, mirroring the repo's own archive layout. Keying by the DATE-PREFIXED on-disk directory name guarantees: (a) no collision with a live same-name change's `workDir` (the recycled-name wart cannot bite migrated archives), (b) uniqueness across same-name archives from different dates, (c) GC safety (inside the registered home; verified GC only removes unreferenced top-level home dirs).

**Correction (review M1):** the home is resolved with `ensure: options.execute` — NOT unconditional `ensure: true` as originally written here. The archive-command precedent this decision claims (`archive.ts:349-358`) actually DEFERS its identity-minting `ensure:true` call until immediately before the real write, once every gate has passed; it does NOT mint during its preview/gate phase. Applying unconditional `ensure:true` here would have minted a `projectId` into `rasen/config.yaml` and written a registry entry on every `--dry-run`/`--json`-without-`--yes` preview — a silent repo mutation a "preview" must never cause, and a direct violation of `project-registry/spec.md`'s "read-only commands never dirty the repo" invariant. The fix: preview calls (`execute: false`) probe only (`ensure: false`); when no identity exists yet, the report sets `identityPending: true` and every destination is `null` with a note explaining that identity mints only on an actual execute call. Execute calls (`execute: true`) resolve with `ensure: true`, matching archive's actual deferred-mint pattern; if minting still fails, the command errors with "run rasen init" guidance rather than degrading.

### D4. Git boundary: classify once with `git ls-files`, move untracked freely, gate tracked behind `--include-tracked`

One read-only `git ls-files -z -- <changesDir>` (helper beside the existing read-only git helpers in `src/core/store/git.ts`) yields the tracked set; each candidate is classified: **untracked** → moved (this alone clears the 41-file noise — untracked moves change nothing in git's eyes); **tracked** → skipped and reported by default; with `--include-tracked` → moved, which makes git see deletions that the command LEAVES UNCOMMITTED, printing pathspec commit guidance (`git commit -- <paths>` form) — the human (or a skill run) commits. The CLI never executes git write commands. Rationale for skip-by-default: moving tracked files mutates the user's version-controlled state; that deserves an explicit opt-in, not a default.

**Correction (review M2):** "if `ls-files` fails, treat as non-git" (the original wording here) is wrong — it conflates "confirmed not a git work tree" with "IS a git work tree but this one query failed" (missing binary, corrupt index, lock contention). Both produced the same `null` from `gitListTrackedFiles`, so a transient failure on a REAL repo silently classified every tracked file as untracked, bypassing the `--include-tracked` gate entirely. Fixed: `isConfirmedGitWorkTree` (`git rev-parse --is-inside-work-tree`, the same upward-walking resolution `ls-files` itself uses) runs first and is the only source of "confirmed non-git root → treat as untracked." Any other failure — of that probe, or of the subsequent `ls-files` call on a confirmed repo — makes the command refuse the run (`git_query_failed`) rather than guess.

### D5. Conflict, idempotency, and atomicity semantics

- **Conflict**: destination file already exists → skip + report as a conflict, never overwrite in either direction (under sticky-legacy the workDir copy already shadows the legacy one for readers; deleting the legacy copy on a content mismatch would silently pick a winner — the report lets the human diff and resolve). The `handoff/` directory merges per-file under the same rule.
- **Idempotency**: a re-run finds no candidates (moved files are gone from the repo side) and reports "nothing to migrate".
- **Move mechanics**: reuse the EXDEV/EPERM-safe `moveDirectory`/copy+rename utilities (home may be on another filesystem); per-file try/catch — one failure is reported and does not abort the run (partial progress is safe because every unit is an independent file move).

### D6. Reporting and the doctor hint

Human output: grouped per change — moved / skipped (tracked) / conflicts / notes, with a summary line and, when tracked files were moved, the commit guidance block. `--json`: `{ changes: [{change, archived, moved[], skippedTracked[], conflicts[], notes[]}], summary }`. `rasen doctor`'s machine-home section gains one line when legacy ephemera are detectable — count + "run `rasen work migrate`"; detection stays read-only and never resolves or mints the home.

**Correction (review m1):** the doctor count is now SPLIT into untracked/tracked (reusing the same `isConfirmedGitWorkTree` + `gitListTrackedFiles` read-only pair `runWorkMigration` uses), not a single undifferentiated total. A single total silently overpromised: in a repo whose pending ephemera are mostly git-tracked (this repo's own live smoke found exactly this), the suggested `rasen work migrate` moves 0 files by default, and the human has no way to tell from the hint alone. The line now reads e.g. "48 untracked (+115 tracked, needs --include-tracked)"; when the split itself can't be determined (non-git root, or the git query fails), it falls back to "N (tracked/untracked split unavailable)" rather than guessing.

## Risks / Trade-offs

- [Moving run-state of a change whose pipeline is MID-FLIGHT could race an active LEAD session] → sticky-legacy writers keep appending to a legacy file only while it exists; the moved file is found by workDir-first readers immediately. Residual race (LEAD holds the old path in-memory mid-write) is the same class as any concurrent-session file move; the preview names active changes with run-state so the human can defer those — plus `--change` scoping. Not worth a lock: migration is a deliberate, human-invoked maintenance action.
- [`*-report.md` glob could catch a hand-authored T2-ish file] → the glob matches the evidence convention ship already treats as ephemera; anything unexpected still appears in the preview before anything moves.
- [Tracked-move leaves the tree dirty (deletions)] → by design (git boundary); guidance printed; `--include-tracked` is opt-in.
- [Archived work dirs accumulate in the home with no reader today] → intended (observability home concentration per Decision 4 payoffs); sweep/retention is the recorded follow-up, and the data was previously polluting the repo instead.
- [Windows EBUSY on moving files held open] → per-file error handling reports and continues; re-run completes the remainder (idempotent).

## Migration Plan

The command IS the migration; nothing runs automatically. Rollback of a run = moving files back by hand (paths are all in the report); nothing is deleted, only relocated, and git-tracked content is untouched by default.

## Open Questions

None blocking. Follow-ups recorded: repo-level `rasen/handoff/` topic docs; work-dir sweep/retention; possible `work path <change>` convenience subcommand.
