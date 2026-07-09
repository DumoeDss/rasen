# Tasks: externalize-artifacts-archive-dest

> Shared-working-tree discipline (every task): `git status --porcelain` on each file before editing and before committing — child 3 is shipping concurrently and touches `ship.ts`, `archive-change.ts`, `project-config.ts`; edit only files clean of foreign modifications; commit with explicit pathspec (`git commit -- <paths>`) and verify with `git show --stat`. Build with `node build.js`; tests with `npx vitest run` (pnpm broken machine-wide). After touching `src/`, always `node build.js` before CLI-spawning tests. Preserve child 3's invariant everywhere: branch on RECORDED ship-log facts, never re-resolved config, for already-delivered changes.
>
> Groups are dependency-ordered and hand-off-able at any boundary: 1 (config) → 2 (resolver) → 3 (CLI archive command) → 4 (CLI readers/exposure) → 5 (templates) → 6 (regen/parity) → 7 (verification).

## 1. Config field: archive.destination

- [x] 1.1 `src/core/project-config.ts`: parse optional `destination` ('in-repo' | 'external' | 'prune') inside the existing `archive` map under the resilient policy (invalid → warn naming `archive.destination` + drop field, siblings like `timing` unaffected; absence silent). Extend the `archive` type; export `resolveArchiveDestinationValue(config): ArchiveDestination` applying the 'in-repo' default (mirror `resolveArchiveTiming`).
- [x] 1.2 Unit tests: valid all three values / invalid value with valid sibling timing / non-map archive / absent field; resolver default. Mirror child 3's test style in `test/core/project-config.test.ts`.

## 2. Destination resolver (design D1)

- [x] 2.1 Add `resolveArchiveDestination(projectRoot, {globalDataDir?, ensure?}) → Promise<{destination, archiveDir: string | null}>` beside `resolveChangeWorkDir` in `src/core/change-work.ts`: 'in-repo' → `<projectRoot>/rasen/changes/archive` via the same path constants as makeRoot; 'external' → `resolveProjectHome(...).archiveDir` (probe-first, ensure only when `ensure:true`; swallow errors → null like `resolveChangeWorkDir`); 'prune' → null. `makeRoot`/`root.archiveDir` untouched (keeps sync in-repo meaning).
- [x] 2.2 Unit tests (per-test temp `globalDataDir`): each destination's mapping; external probe miss → null without writes; external ensure:true mints once; store-root projectRoot works.

## 3. CLI `rasen archive` (src/core/archive.ts)

- [x] 3.1 Destination routing in `run()`: resolve via 2.1 (ensure:true for external); in-repo unchanged; external targets home archive (collision check + `moveDirectory` against external path — verify EXDEV copy+remove path is exercised); prune deletes `changeDir` recursively after a prune-naming confirmation (interactive) or explicit `--yes` (JSON refuses without it, `archive_prune_confirmation_required`-style blocked error).
- [x] 3.2 Destructive preconditions (design D5) before external move / prune delete: `git status --porcelain -- <changeDir>` must be empty else blocked error with commit-first fix; skip quality capture for prune with a visible note; quality capture runs against the external path for external.
- [x] 3.3 Timing guard (closes child 3's bypass gap): read workDir ship-log (probe `resolveChangeWorkDir`, change-dir fallback); if resolved timing = on-merge AND ship-log records a `pr` delivery AND no `--yes` → blocked error explaining merge confirmation is required, pointing to `/rasen:archive` or `--yes`; `--yes` proceeds (override = user's merge confirmation). No gh/git invocation for the check itself (the pathspec status check in 3.2 is a local read).
- [x] 3.4 Result JSON gains `destination` and `archivedPath` (or `pruned: true`); human output states destination outcome.
- [x] 3.5 Tests for 3.1-3.4 (temp globalDataDir; scratch git repo fixtures for the pathspec/dirty checks; isolate-rerun Windows EBUSY flakes).

## 4. CLI readers + exposure

- [x] 4.1 `src/utils/item-discovery.ts` `getArchivedChangeIds`: union of in-repo archive dir + home archive when a home probe resolves (async probe, errors swallowed → in-repo only); de-dupe by id, in-repo wins. Verify the completions consumer (`src/commands/completion.ts`) handles the async shape unchanged.
- [x] 4.2 `src/commands/workflow/status.ts`: `archive` object gains `destination` (always) and `archiveDir` (probe-resolved absolute; OMITTED for prune and for unresolvable external — key templates' fallback on absence). Human output line. No writes, no git/gh.
- [x] 4.3 Tests: union enumeration (both locations, de-dupe, home-less project); status exposure matrix (in-repo / external resolved / external unresolvable / prune).

## 5. Templates (destination-aware bookkeeping)

- [x] 5.1 `archive-change.ts` (both getters): bookkeeping step branches on payload `archive.destination`/`archiveDir` — in-repo mv (unchanged) / external mv to `archiveDir` with same date-prefix + collision rules, falling back to in-repo WITH an explicit note when `archiveDir` absent (fallback may relocate, NEVER delete) / prune delete. Add destructive preconditions (delivery complete per existing gates + clean `git status --porcelain -- <changeRoot>` + prune-naming confirmation, outright refusal when dispatched). Post-bookkeeping commit guidance per destination: external/prune commits contain ONLY spec sync + removal (pathspec `git commit -- <changeRoot> <specsDir>`).
- [x] 5.2 `archive-change.ts` step 1.5: extend the already-archived detection — pre-status in-repo scan stays first; the external-location scan (via `rasen context --json`'s `machineHome`, since a status call throws for a change whose directory has already moved/gone) and the ship-log tombstone check (archived path / pruned record) run next, still before any status call; report existing outcome + stop cleanly for all three destinations.
- [x] 5.3 `bulk-archive-change.ts`: same destination branch + preconditions + fallback for its per-change moves; output examples updated.
- [x] 5.4 `ship.ts` in-ship bookkeeping step (child 3's step): resolve destination — move in-repo / move to `archiveDir` / delete for prune (capture-first ordering already covers reads); ship-log records the destination outcome (`Archived in ship: <path>` or `Pruned in ship`). Committed-state precondition inherently satisfied (move/delete precedes ship's own commit) — state that.
- [x] 5.5 Sweep: grep templates for remaining hardcoded `<changesDir>/archive/` bookkeeping references (e.g. `onboard.ts` narration) — update where behavioral, leave illustrative prose that explicitly describes the in-repo default. Confirmed: only `ship.ts`, `bulk-archive-change.ts`, `archive-change.ts` (all updated) and `onboard.ts` (illustrative walkthrough of the in-repo default — left as-is, matches the guidance).

## 6. Regeneration and parity

- [x] 6.1 `node build.js` + the update flow to regenerate `.claude/skills/**` and `.codex/**`; hand-edit nothing generated. (`.codex/` not a configured delivery target in this repo — `rasen update --force` only touches `.claude/skills/**`, confirmed no `.codex` diff appears.)
- [x] 6.2 Update `skill-templates-parity` expected hashes for exactly the affected templates; `npx vitest run test/core/templates/` green with only those hashes moved. (9 hash entries moved: 6 function hashes + 3 generated-skill hashes, exactly the archive/bulk-archive/ship templates touched.)

## 7. Verification

- [x] 7.1 `node bin/rasen.js validate externalize-artifacts-archive-dest` passes; `node build.js` clean; full `npx vitest run` green (isolate-rerun Windows CLI-spawn flakes after clearing stale tmp dirs). (124 test files, 2304 passed, 22 pre-existing skips, 0 failures — no flake retry needed.)
- [x] 7.2 Live smoke (scratch repo + temp globalDataDir): archive a change under each destination via `rasen archive` — in-repo lands as today; external lands under `<home>/archive` and the repo copy is gone; prune refuses on dirty pathspec, then deletes with `--yes`; status shows destination/archiveDir matrix. (Union enumeration verified via `test/utils/item-discovery.test.ts` instead of the shell-completion CLI surface — no top-level `rasen completion <type>` subcommand exists to drive directly; the underlying `getArchivedChangeIds` union function is what `completion.ts` calls, and it's covered directly. Re-invoking archive on an in-repo-archived change via the raw CLI correctly reports `archive_change_not_found` — the CLI `ArchiveCommand` intentionally has no already-archived directory scan; that sticky-union detection is skill-side only, per design D3/opsx-archive-skill spec.)
- [x] 7.3 Timing-guard smoke: on-merge + pr-delivered ship-log → `rasen archive` refuses without `--yes` (`archive_merge_confirmation_required`), proceeds with it.
- [x] 7.4 Cross-platform: all new paths via `path.join`; no hardcoded separators; Windows-safe tests (EXDEV/EPERM move path covered by existing moveDirectory tests — extend only if destination code adds branches; the external move reuses the same `moveDirectory` helper, so no new branch). Full suite ran green on this Windows machine including the new git-backed destination tests.
