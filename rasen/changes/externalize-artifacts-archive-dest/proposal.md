# Proposal: externalize-artifacts-archive-dest

## Why

`rasen/changes/archive/` is a browsable copy of what git history already holds, and it grows the repo forever — this repo carries 60+ archived change directories. The design of record (`rasen/office-hours/externalize-openspec-artifacts.md`, Decision 3) makes the destination a config axis: keep the upstream-compatible in-repo copy (default), land archives in the project's machine home (`external` — repo never bloats, observability data concentrates under the home child 1 built), or delete at archive (`prune` — git history IS the archive). All three share one pipeline; only the bookkeeping destination differs. Children 1-3 shipped everything this needs: the frozen `resolveProjectHome(...).archiveDir` (child 1), workDir-resident ship-log/reports that survive the change directory's departure (child 2), and the nested `archive:` config map plus delivery-fact discipline (child 3).

## What Changes

- **New config field `archive.destination`**: `in-repo` (DEFAULT, current behavior) | `external` (archive to `resolveProjectHome(...).archiveDir` = `<home>/archive/`) | `prune` (delete the change directory at archive), joining child 3's nested `archive:` map. Child 3's field-by-field parsing already tolerates unknown keys (verified at `src/core/project-config.ts` ~324), so the addition is forward- and backward-compatible.
- **`root.archiveDir` keeps its sync in-repo meaning; a new async resolver carries the axis.** `makeRoot` (`src/core/root-selection.ts:124`) cannot resolve the external home synchronously (the home name is registry-stored by design, never re-derived — child 1 D4), so instead of making `makeRoot` config-resolved as the design doc's shorthand suggests, `root.archiveDir` remains "the in-repo archive location" and a new resolver (`resolveArchiveDestination`) maps config → `{destination, archiveDir | null}`, ensuring the home at write time and probing at read time (child 2's mint-once pattern).
- **`rasen archive` (the legacy CLI `ArchiveCommand` in `src/core/archive.ts`) becomes destination-aware**: in-repo → move as today; external → move to the home archive (ensure-registering the project); prune → delete after its confirmations, skipping quality capture (there is no archived directory to stamp; git history holds the artifacts). AUDIT CORRECTION absorbed here: this CLI command exists (wired at `src/cli/index.ts:391`) contrary to child 3's "entirely skill-driven" finding, and it currently bypasses child 3's merge gate — it gains a minimal timing guard (on-merge + PR-delivered ship-log + no explicit override → refuse with guidance to `/rasen:archive`, since the CLI itself never shells to `gh`).
- **Sticky-union reader semantics (existing archives are never orphaned):** readers enumerate the UNION of the in-repo archive dir and the home archive (when a home resolves), regardless of current config — switching destination affects only future archives; nothing migrates, nothing is lost. Applies to `getArchivedChangeIds` (`src/utils/item-discovery.ts`, feeds completions) and the archive skill's step-1.5 already-archived scan.
- **Templates become destination-aware** (resolved values ride the status JSON like child 3's timing): `archive-change.ts` — bookkeeping step branches per destination, step-1.5 scan covers all three destinations (in-repo scan + external scan + prune tombstone via ship-log/git history), commit guidance per destination (external/prune archives produce NO archive-dir additions — the commit carries only the spec sync and the change-dir removal); `bulk-archive-change.ts` — same bookkeeping branch; `ship.ts` — child 3's in-ship bookkeeping step resolves the destination for its move/delete. All template branches keep keying on RECORDED ship-log facts over re-resolved config (child 3 invariant).
- **Safety preconditions for destructive destinations:** external and prune both remove the repo copy of T2 review material, so the prose requires delivery to be complete first (merge-confirmed for pr mode per child 3's gate) AND `git status --porcelain -- <changeRoot>` to be clean (uncommitted content would not be in git history); prune additionally requires its own named confirmation. The removal is committed pathspec-scoped so the working tree ends clean.
- **CLI exposure:** `status --json`'s `archive` object (child 3) gains `destination` and the resolved `archiveDir` (absolute; omitted for prune or when unresolvable — skills fall back to in-repo with an explicit note, never to deletion).

## Capabilities

### New Capabilities
- `archive-destination`: the destination config axis — values and default, the resolution rule (in-repo path / home archive / none), sticky-union reading of existing archives, destructive-destination safety preconditions, prune's quality-capture skip, and the fallback-to-in-repo rule when external cannot resolve.

### Modified Capabilities
- `config-loading`: the `archive` block carries an optional `destination` field (ADDED requirement; resilient parsing).
- `cli-archive`: the archive command honors the destination axis and gains the minimal timing guard (ADDED requirements).
- `cli-artifact-workflow`: `status --json` exposes `archive.destination` and the resolved `archive.archiveDir` (ADDED requirement).
- `opsx-archive-skill`: destination-aware bookkeeping, multi-destination step-1.5 scan, per-destination commit guidance, safety preconditions (ADDED requirements).
- `opsx-ship-command`: in-ship bookkeeping resolves the destination (ADDED requirement).

All deltas on existing capabilities are ADDED requirements — the same collision-avoidance pattern as child 3 (child 3's spec sync may still be landing when apply starts).

## Impact

- **CLI code**: `src/core/project-config.ts` (destination parse + resolver), a small destination-resolution helper (new module or beside `resolveChangeWorkDir`), `src/core/archive.ts` (destination-aware move/delete + timing guard + prune quality-capture skip), `src/utils/item-discovery.ts` (union enumeration), `src/commands/workflow/status.ts` (exposure). `makeRoot` untouched.
- **Templates**: `archive-change.ts`, `bulk-archive-change.ts`, `ship.ts` (in-ship step only). Regeneration + `skill-templates-parity` hashes for exactly these.
- **Tests**: config matrix, resolver, ArchiveCommand destination behaviors (temp `globalDataDir` isolation per store-test precedent), union enumeration, status exposure, parity. `node build.js` + `npx vitest run` (pnpm broken machine-wide).
- **Not in scope**: SHA cross-stamping (child 5); retro/goal-loop archive-reader adaptation beyond what exists (AUDIT RESULT: retro does not read archive directories today — the design doc's "retro reads the configured location" concerns the future swept-work/ flow, recorded as a follow-up for the archive-sweep work); work-dir sweep/retention at archive (separate follow-up); migrating existing archives (never).
- **Coordination**: child 3 is shipping concurrently — same shared-tree discipline; apply must re-check `git status` on `ship.ts`/`archive-change.ts`/`project-config.ts` (all touched by child 3) before every edit and commit, pathspec-scoped commits only.
