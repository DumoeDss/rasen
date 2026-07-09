# Design: externalize-artifacts-archive-dest

## Context

Decision 3 of the design of record: archive destination becomes a config axis (`in-repo` default | `external` | `prune`), one pipeline, only the bookkeeping destination differs. Verified current state:

- **Two archive implementations exist and BOTH must become destination-aware.** (a) The legacy CLI `rasen archive [change]` — `ArchiveCommand` in `src/core/archive.ts`, wired at `src/cli/index.ts:391` — validates, syncs specs via `specs-apply`, moves `changeDir` → `root.archiveDir`, then runs quality capture (writes into the archived dir's `.openspec.yaml`). (b) The `rasen-archive-change` skill (`archive-change.ts`), which runs the richer gate set (child 3's timing/merge gate included) and does its own `mv`. Child 3's finding "archive is entirely skill-driven" was WRONG (it checked only `src/commands/`); consequence: `ArchiveCommand` today bypasses child 3's merge gate — a gap this child absorbs since it edits that file anyway.
- **`root.archiveDir`** (`makeRoot`, `src/core/root-selection.ts:124`) is sync and hardcodes `<root>/rasen/changes/archive`. The external home path CANNOT be derived synchronously: the home directory name is stored in the registry and never re-derived (child 1 D4), so resolving it requires an async registry read.
- **Frozen API from child 1**: `resolveProjectHome(projectRoot, {ensure?}).archiveDir` = `<home>/archive`. Child 2's `resolveChangeWorkDir` established the probe-first/mint-once calling pattern and the ensure-vs-probe surface split.
- **Archive-location readers (exhaustive audit):** `getArchivedChangeIds` (`src/utils/item-discovery.ts:47`, consumed by shell completions only), the archive skill's step-1.5 already-archived scan (hardcodes `<changesDir>/archive/` — flagged by child 3's review), `bulk-archive-change.ts`'s move step, `ship.ts`'s in-ship bookkeeping step (child 3), and the init/workspace scaffolding that pre-creates `changes/archive/` (stays — in-repo remains the default shape). **Retro does NOT read archive directories today** (single incidental mention); the design doc's "retro reads the configured location" belongs to the future swept-work flow — follow-up, not this child.
- **Child 3 invariants to preserve:** template branches key on RECORDED ship-log facts, never re-resolved config; step-1.5 runs BEFORE the status call; ship-log lives in workDir (child 2), so it survives the change directory's move or deletion — which is precisely what makes `external`/`prune` bookkeeping safe for later readers.
- Config: child 3's nested `archive:` map parses field-by-field and ignores unknown keys (verified `project-config.ts` ~324) — `destination` is a compatible addition.

## Goals / Non-Goals

**Goals:**
- One config field choosing where bookkeeping lands: repo copy (default), machine home, or nowhere (git history is the archive).
- No archived change is ever orphaned by a config flip; no migration, ever.
- Destructive destinations cannot destroy unmerged or uncommitted review material.
- Both archive implementations (CLI command + skill) behave identically per destination.

**Non-Goals:**
- SHA cross-stamping (child 5); PR-body embedding (child 5).
- Retro/goal-loop reading of archived content (they do not read archives today; the swept-work reader is a recorded follow-up).
- Work-dir sweep/retention at archive time (follow-up; this child only relocates/deletes the CHANGE directory, never touches workDir).
- Migrating existing archives between destinations.
- Changing spec-sync in any way (destination is bookkeeping-only).

## Decisions

### D1. `root.archiveDir` stays sync in-repo; a new async resolver owns the axis

`makeRoot` is a pure sync constructor used everywhere; the external path needs an async registry read. So the design doc's "makeRoot's archiveDir becomes config-resolved" is implemented as: `root.archiveDir` KEEPS meaning "the in-repo archive location" (legacy reads, default writes, scaffolding), and a new helper — `resolveArchiveDestination(projectRoot, {globalDataDir?, ensure?}) → { destination, archiveDir: string | null }` beside `resolveChangeWorkDir` in `src/core/change-work.ts` — maps config to a concrete location: `in-repo` → the in-repo path; `external` → `resolveProjectHome(...).archiveDir` (probe-first, ensure only at write time — child 2's mint-once pattern); `prune` → `null`. Every consumer resolves through it; nothing re-derives home paths (child 1's frozen-API rule).

### D2. Config: `archive.destination`, resiliently parsed, default `in-repo`

`ProjectConfig['archive']` gains `destination?: 'in-repo' | 'external' | 'prune'` parsed under the same field-by-field policy as `timing` (invalid → warn + drop → default). `resolveArchiveDestinationValue(config)` applies the default, mirroring `resolveArchiveTiming`. Older parsers ignore the key (verified); newer parsers tolerate configs without it.

### D3. Sticky-union reads: config governs writes only

Readers of archived changes SHALL see the union of the in-repo archive directory and the home archive whenever a home resolves (probe), regardless of the configured destination. Rationale: a destination flip must not hide previously archived changes in either direction, and union reads make "where does it archive NOW" a pure write-side question — the same shape as child 2's sticky-legacy rule. Concretely: `getArchivedChangeIds` gains a home-probe union (de-duplicated, in-repo entry wins name collisions since it is the older convention); the skill's step-1.5 scan checks the in-repo location first, then the external location (path from status JSON), then the prune tombstone (ship-log `Archived:`/`Pruned:` record — recorded facts, child 3 invariant). `prune`d changes are enumerable only through their ship-log/git history — accepted; that is what prune means.

### D4. `ArchiveCommand` (CLI) becomes destination-aware and gains the minimal timing guard

- Destination resolution at the top of `run()` (ensure:true for external — archiving IS the home-needing write).
- `in-repo`: unchanged. `external`: identical flow, target = home archive; the collision check and `moveDirectory` (already EXDEV-safe via copy+remove — required, since the home is on a different tree and possibly filesystem) run against the external path; quality capture runs there too (it is path-agnostic, writes into the archived dir's `.openspec.yaml`). `prune`: after the existing confirmations plus a prune-specific named confirmation (`--yes` covers JSON mode), delete `changeDir` recursively; SKIP quality capture (no archived directory to stamp; the artifacts live in git history and workDir).
- **Timing guard (absorbing child 3's gap):** before bookkeeping, read the workDir ship-log (probe via `resolveChangeWorkDir`, change-dir fallback); if resolved timing is `on-merge` AND the ship-log records a `pr` delivery AND no explicit override (`--yes`), refuse with guidance: the CLI cannot verify merges (it never shells to `gh` — child 3 D2), so direct users to `/rasen:archive` (which runs the merge check) or an explicit `--yes` after confirming the merge themselves. This makes the CLI honest rather than smart — it blocks the bypass without importing gh.
- Result JSON gains `destination` and the archived path (or `pruned: true`).

### D5. Destructive-destination safety: delivery-complete + committed-tree preconditions

`external` and `prune` both remove the repo's copy of T2 review material, so both require, before bookkeeping: (1) delivery complete per recorded ship-log facts — for `pr` mode that means merge-confirmed via child 3's gate (skill) or the D4 guard (CLI); and (2) `git status --porcelain -- <changeRoot>` empty — uncommitted change-dir content is NOT in git history yet, and destroying the only copy is never acceptable; refuse with "commit the change directory first". After bookkeeping, the prose directs committing the removal pathspec-scoped (`git commit -- <changeRoot> <specsDir>`), so external/prune archives produce a commit containing ONLY the spec sync and the deletion — no archive-dir additions. In-ship (child 3) already moves before ship's commit, so its removal rides the delivery inherently.

### D6. Exposure and template degradation

`status --json`'s `archive` object (child 3) gains `destination` (always, default applied) and `archiveDir` (absolute resolved location; OMITTED for `prune` and when `external` cannot resolve — probe miss on an unregistered project). Template rule: destination `external` with no `archiveDir` in the payload → fall back to an in-repo move WITH an explicit note (a fallback may relocate, it must NEVER escalate to deletion); destination `prune` needs no path. The skill's step-1.5 external scan uses the payload path — but step-1.5 runs BEFORE the status call (child 3 design), so the scan order becomes: in-repo scan (no CLI needed) → status call → external scan + tombstone check once the payload is in hand; the pre-status in-repo scan alone still catches the overwhelmingly common case and the moved-directory hard-failure child 3 fixed.

### D7. `bulk-archive-change.ts` follows the same branch

Bulk archive does its own bookkeeping moves; it gains the same destination resolution (one status call per change already happens), the same D5 preconditions, and the same fallback rule. No new spec capability — the `archive-destination` requirements are written implementation-neutrally to cover every bookkeeping actor (CLI, skill, bulk, in-ship).

## Risks / Trade-offs

- [Prune deletes the only working-tree copy of review material] → D5's two preconditions (delivery complete + clean pathspec status) plus a named confirmation; non-interactive refusal without explicit override.
- [External move fails mid-way across filesystems] → `moveDirectory` already does copy+remove on EXDEV/EPERM; a partial copy leaves the source intact (remove happens after copy); re-running archives cleanly.
- [Home GC deletes external archives] → impossible while the project is registered: `<home>/archive` is inside the registered home (child 1's GC only removes unreferenced homes). `doctor --gc` on a deleted repo removes its home INCLUDING external archives — document in the capability spec as intended (machine-local archives die with the project's machine registration; git history remains).
- [Name collision between in-repo and external archives in union reads] → de-dupe by id, in-repo wins for display; collisions require archiving the same change name on the same date to two destinations — practically a config-flip artifact; both copies remain on disk regardless.
- [Concurrent session / child 3 still shipping touches the same files] → shared-tree discipline (per-file `git status` before edit/commit, pathspec commits); child 3's `ship.ts`/`archive-change.ts`/`project-config.ts` edits are upstream of ours — apply rebases its understanding on the CURRENT file content at edit time.
- [Template fallback masks misconfiguration (external → in-repo silently)] → the fallback REQUIRES an explicit note in the skill output; the CLI, which CAN ensure-register, never needs the fallback.

## Migration Plan

Purely additive; default `in-repo` is byte-identical to today. Existing archives stay where they are under every setting (D3). Rollback = revert commits; external archives already created remain readable via the union rule of any newer build, or manually from the home directory.

## Open Questions

None blocking. Recorded follow-ups: swept-work/ retro reader (with the archive-sweep work); child-3 findings-log correction about the CLI archive command (appended this round); workDir recycled-name wart (pre-existing, context only).
