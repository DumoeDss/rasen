# Proposal: migrate-legacy-ephemera

## Why

The externalize-artifacts portfolio made process ephemera external-from-birth for NEW changes (T3 → `<home>/changes/<name>/work/`), but deliberately deferred migration of pre-existing files (Q3: sticky-legacy — old files stay where they are, readers fall back). The passive policy leaves real noise in place: this repo alone has 41 untracked `auto-run.json`/`portfolio-run.json` files under `rasen/changes/archive/**` polluting `git status` right now, plus legacy ephemera inside active and archived change dirs. The user asked for the active path (verbatim): "是不是加个命令能主动迁移当前项目中的rasen文件？……旧版本都还在in-repo，比如当前项目下有大量的auto-run.json，我希望有个命令能够直接迁移到外部产物目录". This change adds that command: a one-shot, idempotent migration of legacy in-repo ephemera into the machine-home work directories.

## What Changes

- **New command `rasen work migrate`** — a new `work` command group (the machine-home work-dir surface; room for future `work path`/`work sweep`). `rasen migrate` is NOT reused: it is the openspec→rasen brand migration and takes a positional path. Behavior: scan the resolved root's active change dirs and `changes/archive/**` for known T3 ephemera, preview the per-file plan (source → destination, tracked/untracked, conflicts), then move. Interactive runs confirm after the preview; `--json` runs are non-interactive and require `--yes` to execute (preview-only otherwise); `--dry-run` forces preview-only in both modes; `--change <name>` scopes to one change. Idempotent: a second run finds nothing to move.
- **What migrates (from the `change-work-dir` capability's T3 enumeration):** run-state (`auto-run.json`, `portfolio-run.json`, `goal-run.json`), the `handoff/` directory (including `relay-prompt.txt`), `verification-report.md`, `ship-log.md`, and the canonical report family (`review-report.md`, `cso-report.md`, `qa-report.md`, `benchmark-report.md`, `design-review-report.md`, `review-cycle-report.md`, and other `*-report.md`). Explicitly NOT migrated: T2 review material (proposal/design/tasks/specs, change-scoped research), T4 knowledge (`office-hours-design.md`), `retro.md` (placement deliberately unchanged by child 2), and `.openspec.yaml`. Custom goal-loop `runArtifact` filenames cannot be known statically — reported, not moved.
- **Destinations:** active change → the existing `workDir(name)`; archived change → a NEW home-layout area `<home>/changes/archive/<archived-dir-name>/work/`, added via the layout owner (`project-home.ts`). Using the DATE-PREFIXED archived dir name (not the bare change name) means a migrated archive can never collide with a live same-name change's work dir — this closes the recycled-name interaction rather than worsening it. Both destinations live INSIDE the registered home, so registry GC never treats them as orphans (verified: GC deletes only top-level unreferenced dirs under `<gdd>/projects/`).
- **Git boundary (read-only, as sanctioned):** one `git ls-files` query classifies candidates. UNTRACKED files move freely — this alone removes all 41 noise files. TRACKED files (committed, mostly upstream-era archives) are SKIPPED and reported by default; `--include-tracked` opts into moving them, leaving the resulting deletions UNCOMMITTED with printed pathspec commit guidance — the CLI never invokes git write commands. A non-git root treats everything as untracked (noted in output).
- **Safety:** never overwrite — a destination file that already exists is skipped and reported as a conflict (the workDir copy already wins for readers under sticky-legacy). Machine home is ensured (mint-once) since migration is a home-needing write, matching the archive command precedent. Per-file report + summary in human and `--json` forms.
- **Readers unaffected by construction:** workDir-first resolution (pipeline resume, ship pre-flight, archive gates, retro) finds moved state exactly where new-change state already lives; migration just makes workDir the only copy.
- **Doctor hint (small):** the machine-home section of `rasen doctor` reports a count of migratable legacy ephemera and suggests `rasen work migrate`.

## Capabilities

### New Capabilities
- `work-migration`: the `rasen work migrate` command contract — scan scope and the migrate/exclude sets, preview-then-confirm execution modes, the tracked/untracked git boundary, destination mapping (active vs archived), conflict and idempotency semantics, and reporting.

### Modified Capabilities
- `change-work-dir`: the home layout gains the archived-change work area, and migration is defined as the active path of the sticky-legacy policy — after migration the work-directory copy is the only copy and readers behave as for born-external changes (ADDED requirements).
- `project-registry`: doctor's machine-home section surfaces pending legacy ephemera with the migration hint (ADDED requirement).

## Impact

- **CLI code**: new `src/commands/work.ts` (or `src/core/work-migration.ts` + thin command), `src/core/project-home.ts` (archived-work layout helper — the layout owner), `src/cli/index.ts` (command group wiring), `src/core/completions/command-registry.ts` (completion entry), `src/commands/doctor.ts`/`relationship-health.ts` (hint line). One read-only git helper reuse/addition in `src/core/store/git.ts` (`git ls-files`).
- **Templates**: none expected (the command is user-invoked; skills already teach workDir-first reading).
- **Tests**: migration matrix (untracked/tracked/conflict/idempotent/archived-naming/non-git/scoped/dry-run/json), per-test temp `globalDataDir` isolation; `node build.js` + `npx vitest run` (pnpm broken machine-wide).
- **Not in scope**: repo-level `rasen/handoff/<topic>.md` fallback docs (no change scope — pre-existing follow-up); work-dir sweep/retention; store-mode T1/T2 relocation (different feature); committing anything on the user's behalf.
