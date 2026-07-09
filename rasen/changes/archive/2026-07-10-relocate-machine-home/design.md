# Design: relocate-machine-home

## Context

Ratified product decision: the machine data root is the literal `~/.rasen` on all platforms. Verified current state:

- **Two global directories exist** (`src/core/global-config.ts`): `getGlobalDataDir()` — `XDG_DATA_HOME/rasen` > `%LOCALAPPDATA%\rasen` (win32) > `~/.local/share/rasen`; and `getGlobalConfigDir()` — `XDG_CONFIG_HOME/rasen` > `%APPDATA%\rasen` (win32) > `~/.config/rasen`, holding `config.json` (telemetry `anonymousId`/`noticeSeen`, profile, delivery).
- **Single funnel**: every data-dir consumer calls `getGlobalDataDir()` (or takes a `globalDataDir` DI option defaulting to it): `project-registry.ts`, `store/foundation.ts`, `artifact-graph/resolver.ts` (schemas), `pipeline-registry/resolver.ts` (pipelines), `worksets.ts`, `work-migration.ts`, `project-home.ts`. Changing the getter relocates everything; zero consumer edits.
- **Nothing under the root stores the root's own path**: `projects/registry.json` keys are canonical PROJECT repo paths and its `home` field is a directory NAME composed via `getProjectHomeDir(homeName)` at read time (child 1 D1, verified at `src/core/project-registry.ts:71`); `stores/registry.yaml` records store roots that live elsewhere on disk. A physical move of the whole root therefore needs NO rewrites. (The LEAD brief's "registry stores absolute home paths" assumption was checked and does not hold.)
- **`migrateLegacyBrandConfig` trap**: it computes the legacy `openspec` dir as `path.join(path.dirname(newDir), 'openspec')` — correct while `newDir` sits inside AppData/XDG trees, but with `newDir = ~/.rasen` it would look at `~/openspec`. The relocation must restructure the adoption chain around explicit old-scheme paths.
- **Test isolation reality**: ~30 test files (124 occurrences) isolate via `XDG_DATA_HOME` (+`LOCALAPPDATA`) env swaps; `XDG_DATA_HOME` already takes precedence on ALL platforms today, so tests isolate through it alone — `LOCALAPPDATA` swaps are belt-and-suspenders.
- **Templates are already abstract** ("machine-home", payload-carried paths) — no template edits, no parity churn. Docs carry the old scheme in five user-facing files.
- This machine has real data under the old scheme (a live project home with work dirs and migrated ephemera, plus the projects registry) — the migration path will run for real here.

## Goals / Non-Goals

**Goals:**
- One literal, documentable path — `~/.rasen` — on every platform, holding both `config.json` and all machine data.
- A dedicated, simple override (`RASEN_HOME`) in the `~/.claude`/`CODEX_HOME` tradition.
- Existing installs relocate losslessly and automatically; explicit-XDG users and the test suite keep working unchanged.
- Ancient `openspec`-era installs still chain into the new location.

**Non-Goals:**
- Deleting old directories (the user does, after verifying; doctor points at them).
- Registry/lock format changes, store-root moves, or any layout change INSIDE the root.
- Honoring `LOCALAPPDATA`/`APPDATA` after this change (the ratified default replaces the platform branches).
- Windows junction/symlink compatibility shims.

## Decisions

### D1. Both getters converge on one root; precedence `RASEN_HOME` > XDG alias > `~/.rasen`

- `getGlobalDataDir()`: `RASEN_HOME` > `XDG_DATA_HOME/rasen` > `os.homedir()/.rasen`.
- `getGlobalConfigDir()`: `RASEN_HOME` > `XDG_CONFIG_HOME/rasen` > `os.homedir()/.rasen`.

`RASEN_HOME` points BOTH at one directory (that is its point — one knob, one dir). The XDG variables stay honored as compatibility aliases below it: they keep explicit-XDG installs working, keep the 30 env-isolating test files green (they already win over the platform branches on every platform today), and cost one line each. The Windows `LOCALAPPDATA`/`APPDATA` branches are deleted — that is the ratified change; test `LOCALAPPDATA` swaps become no-ops (audited in tasks). Defaults collapse config+data into one dir; no filename collisions exist (`config.json` vs `stores/`, `projects/`, `schemas/`, `pipelines/`, workset state — verified).

*Rejected alternatives:* dropping XDG entirely (breaks explicit-XDG installs silently and forces a 30-file test rewrite for zero user value); keeping the platform branches below `~/.rasen` (two candidate defaults = the old-install detection problem forever); `RASEN_DATA_DIR`+`RASEN_CONFIG_DIR` pair (two knobs for a dir the decision says should be one).

### D2. Startup adoption chain with explicit old-scheme paths

A single startup hook `adoptLegacyMachineData()` replaces/absorbs `migrateLegacyBrandConfig` in `runCli`, running before any command parses. For each target (the resolved config dir and data dir — same dir under defaults, deduplicated):

1. Skip when an env override (`RASEN_HOME` or the respective XDG var) is set — an explicit location is the user's choice; nothing relocates.
2. Compute OLD-SCHEME candidates explicitly (not derived from the new getters): data — `%LOCALAPPDATA%\rasen`, `~/.local/share/rasen`; config — `%APPDATA%\rasen`, `~/.config/rasen`; and each one's `openspec` brand-legacy sibling.
3. Adopt in chain order: an old-scheme `rasen` dir wins; else an old-scheme `openspec` dir (ancient installs hop `openspec@old → ~/.rasen` in one copy — the intermediate `rasen@old` hop of the current brand migration collapses).
4. Copy-only, per top-level child, never overwrite an existing child in the target, never delete the source; a child copies to a temp name inside the target and renames into place (all-or-nothing per child); config adoption is just the `config.json` child.
5. Any failure: leave the partial temp cleaned up, print a LOUD warning naming source, target, and the manual command to finish by hand — then continue startup (never fatal, per the brand-migration contract). Idempotent: a completed adoption leaves nothing matching step 2's "target lacks it" test.

*Why copy-only, not move:* identical to the brand-migration rationale — a mid-operation crash must not strand the only copy; disk cost is bounded and the old dir is inert afterward. Doctor tells the user when it is safe to delete.

### D3. No registry rewrite; verification instead

Because `home` is a name and registry keys are project paths (Context), adoption is a pure directory copy. The relocation test matrix includes the end-to-end proof: seed an old-scheme root with a registered project + home + work files, run the CLI once, and assert `resolveProjectHome` (probe) finds the same home under `~/.rasen` with `lastSeen` intact and GC treating it as referenced.

### D4. Doctor reporting

The machine-home section gains: (a) after successful adoption, a note when an old-scheme directory still exists — "legacy data dir at <path>; contents were copied to ~/.rasen; safe to delete after verifying"; (b) when adoption previously failed (target lacks data, old-scheme dir present, no env override), a loud actionable warning with the manual copy command. Doctor stays read-only; it never re-attempts the copy itself (startup does, idempotently, every run until it succeeds or the user intervenes).

### D5. Docs and scope guard

Five user-facing docs get the new path + `RASEN_HOME` (`docs/cli.md`, `customization.md`, `opsx.md`, `opsx-workflow-guide.md`, `stores-beta/user-guide.md`); historical/handoff docs stay. No templates change (verified abstract). The `global-config` capability spec is the single source of the location contract; the data-root requirement is added there rather than scattered across store/registry specs (which already use `<globalDataDir>` abstractly).

## Risks / Trade-offs

- [Two rasen processes race the first adoption] → per-child temp+rename makes each child atomic; the loser's rename hits an existing child and skips (never-overwrite); worst case both copy the same bytes. The registry lock is NOT held (adoption predates registry reads) — acceptable because copy sources are quiescent old dirs.
- [A copy runs while the OLD dir is being written by an older CLI version still installed] → bounded exposure, same class as any side-by-side version overlap; newest-write-wins is not attempted — the copy is point-in-time and the old dir remains authoritative for old binaries. Doctor's lingering-dir note tells the user to retire old versions.
- [`RASEN_HOME` set to a relative path or file] → resolve to absolute; if unusable, warn and fall back to `~/.rasen` (never crash startup).
- [Tests that assert the OLD default paths (e.g. `global-config.test.ts` platform-branch cases)] → rewritten as part of the change; the audit task greps for any other literal `AppData`/`.local/share` assertions.
- [Users with scripts/backups pointing at the old path] → docs + doctor note; the old dir keeps existing until they delete it.
- [Homedir-less environments (CI containers where `os.homedir()` is odd)] → same exposure as `~/.claude`-style tools; `RASEN_HOME` is the documented remedy and tests always set it or XDG.

## Migration Plan

Ships as one change. First post-upgrade CLI run adopts existing data into `~/.rasen` automatically (this machine's real home included — smoke-test against a copied fixture first per tasks). Rollback = revert the commits; old binaries still read the untouched old-scheme dirs; `~/.rasen` becomes inert extra data.

## Open Questions

None blocking. Follow-up recorded: whether `doctor --gc` should eventually offer old-scheme-dir cleanup as an explicit flag once the note has existed for a release.
