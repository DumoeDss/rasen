## Why

`rasen store adopt --dry-run` violated its own printed guarantee ("nothing was moved and no config changed") in two ways, both inside `adoptProject`:

1. **The archive line always read `0 entries`.** The archive handler ran inside the `if (!input.dryRun)` mutation guard, so `archiveMoves` stayed empty on a preview. A real repo hitting this reported `Archive: move (0 entries)` for **496 archived directories / 4011 files**; the subsequent real adopt correctly moved all 496. Adopt is a cross-repository operation that deletes thousands of git-tracked files, and the dry run is the user's only "look before you leap" surface — under-reporting the archive by three orders of magnitude makes users underestimate the scale, skip `--verify-hash`, and land unprepared for the two-repo commit planning.
2. **The preview dirtied the source repo.** `ensureProjectIdInConfig` ran unconditionally, appending `projectId:` to the tracked `rasen/config.yaml`, so `git status` was non-empty after a run that claimed to change nothing.

`archive relocate` already gets both of these right (it threads `dryRun` into `moveArchiveEntries` and probes the machine home with `ensure: false`); adopt is brought into the same shape.

## What Changes

- Enumerate archive entries during a dry-run adopt by calling the archive handler with `dryRun: true` outside the mutation guard, so the reported count and names are the real ones. The mutating call stays at its original position inside the guard, after the manifest write, preserving the "manifest before source deletion" resume invariant.
- Make `--archive external` dry-run inert: probe the machine home with `ensure: false` instead of minting it, fall back to a symbolic target directory when the project has no home yet (instead of throwing), and skip the `archive.destination` config write.
- Stop minting a project id on a dry run: read the existing id, and report the exported `UNASSIGNED_PROJECT_ID` placeholder when the project has none. A project with no id can have no manifest entry, so the interrupted-adopt resume probe is unaffected.
- Add regression coverage for the archive count, external-mode inertness, config byte-identity, and the real adopt still moving the full archive after a preview.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `store-adopt`: Spell out that the dry-run plan covers the selected archive with real, disk-enumerated entries and is fully inert (no machine home, no minted project id, no config writes).

## Impact

Affects `src/core/store/migration-ops.ts` (`adoptProject`, `handleAdoptArchive`) and `test/core/store/migration-ops.test.ts`. No command-line syntax, output-format, or dependency changes: the human formatter and `--json` shape are untouched, they simply receive the correct data. The only behavioral change outside dry-run is none — the real adopt path is byte-for-byte equivalent in ordering and effects.
