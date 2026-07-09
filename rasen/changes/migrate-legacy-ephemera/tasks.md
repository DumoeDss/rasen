# Tasks: migrate-legacy-ephemera

> Conventions: build `node build.js`; tests `npx vitest run` (pnpm broken machine-wide); after touching `src/`, always `node build.js` before CLI-spawning tests. Per-test temp `globalDataDir` isolation for anything touching the registry/home. Shared-tree discipline: per-file `git status --porcelain` before edit/commit; pathspec commits verified with `git show --stat`. The CLI's git surface stays READ-ONLY (one `ls-files` query; never a git write).

## 1. Layout + scanner core

- [x] 1.1 `src/core/project-home.ts`: add the archived-work layout member (`<home>/changes/archive/<archivedDirName>/work`) to `ProjectHome` (layout owner; consumers never derive it). Unit test: distinct from `workDir(name)` for a same-base-name pair.
- [x] 1.2 New `src/core/work-migration.ts`: the scanner — enumerate active change dirs (skip `archive`, dotdirs) and `changes/archive/*` dirs; per dir, classify candidates by the migrate set (run-state trio, `handoff/` recursive, `verification-report.md`, `ship-log.md`, `*-report.md`) with the hard exclusions (proposal/design/tasks/specs/.openspec.yaml/research/office-hours-design.md/retro.md); emit notes for report-like non-candidates (`*-review.md`, `*-audit.md`) and the static-runArtifact caveat. Pure planning function returning the per-file plan (source, destination, kind).
- [x] 1.3 Git classification: read-only helper (beside the read-only helpers in `src/core/store/git.ts`) running `git ls-files -z -- <changesDir>` once; classify each candidate tracked/untracked; non-git root → all untracked + note. Unit tests with a scratch git repo fixture.
- [x] 1.4 Executor: apply a plan — ensure home (`resolveProjectHome` ensure:true; hard error with init guidance if null), per-file EXDEV/EPERM-safe move (reuse the copy+rename utility), conflict skip (destination exists → never overwrite), per-file try/catch (report failures, continue), tracked files only when `includeTracked`. Returns the executed report (moved/skippedTracked/conflicts/failures/notes per change).
- [x] 1.5 Unit tests for the matrix: untracked moved / tracked skipped by default / tracked moved with includeTracked (deletions visible to git, nothing committed) / conflict skip / idempotent second run / archived dir → date-keyed destination while live same-name change unaffected / handoff dir per-file merge / non-git root.

## 2. Command surface

- [x] 2.1 `src/commands/work.ts` + wiring in `src/cli/index.ts`: `rasen work migrate` with `--change <name>`, `--dry-run`, `--include-tracked`, `--json`, `--yes`. Interactive: preview → confirm prompt → execute → report. `--json`: non-interactive, plan-only unless `--yes`; `--dry-run` always plan-only. Root via `resolveRootForCommand` (store flag NOT supported initially — nearest root; note in help).
- [x] 2.2 Human report (grouped per change: moved/skipped-tracked/conflicts/notes + summary + commit guidance block when tracked files moved) and `--json` shape `{changes:[...], summary}` per design D6.
- [x] 2.3 `src/core/completions/command-registry.ts`: register the `work` group + `migrate` subcommand and flags for completions.
- [x] 2.4 CLI-level tests: dry-run moves nothing; json without --yes is a preview; --yes executes; --change scoping; exit codes.

## 3. Doctor hint

- [x] 3.1 `src/commands/doctor.ts` / `src/core/relationship-health.ts`: machine-home section gains the pending-legacy-ephemera count (scanner in count-only mode, probe-resolved home, read-only) + `rasen work migrate` suggestion; omitted when zero; present in `--json`. Test both states.

## 4. Verification

- [x] 4.1 `node bin/rasen.js validate migrate-legacy-ephemera` passes; `node build.js` clean; full `npx vitest run` green (isolate-rerun Windows CLI-spawn EBUSY flakes after clearing stale tmp dirs).
- [x] 4.2 Live smoke ON THIS REPO (the motivating case): `node bin/rasen.js work migrate --dry-run` previews the 41 untracked run-state files (and other legacy ephemera) with correct destinations; then a real run with `--yes` clears them; `git status` no longer shows them; `rasen pipeline resume` on a migrated archived parent still behaves (archived changes aren't resumed — verify no error path); second run reports nothing to migrate; tracked upstream-era files reported as skipped (do NOT pass --include-tracked on this repo without LEAD sign-off).
- [x] 4.3 Doctor smoke: hint present before migration, gone after.
- [x] 4.4 Cross-platform: all paths via `path.join`; scratch-repo tests Windows-safe; no hardcoded separators.
