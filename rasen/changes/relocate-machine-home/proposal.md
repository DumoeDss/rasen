# Proposal: relocate-machine-home

## Why

The product owner ratified moving the machine data root to the literal `~/.rasen` on every platform (verbatim: "使用~/.rasen 能够跨平台一致吧？并且现在像claudecode/codex/hermes/openclaw等各种产品都是写在~/.xxxx下面的，为什么你的设计要在用户目录呢？"). Three ratified reasons: cross-platform path consistency (one path in every doc, script, and agent prompt instead of `%LOCALAPPDATA%\rasen` / `$XDG_DATA_HOME/rasen` / `~/.local/share/rasen`); the de-facto dev-CLI convention (`~/.claude`, `~/.codex`, `~/.ssh`, `~/.npm`); and discoverability — users hand-inspect this directory, and the user was confused by the AppData path within minutes of first use (live evidence). Today the root is `getGlobalDataDir()`'s XDG/AppData scheme, and a second global directory (`getGlobalConfigDir()` — `%APPDATA%\rasen` / `~/.config/rasen` for `config.json`) has the same inconsistency; the ratified rationale covers both, so both consolidate into `~/.rasen`.

## What Changes

- **Default machine root becomes `~/.rasen` on all platforms.** `getGlobalDataDir()` defaults to `os.homedir()/.rasen` (subdirs `projects/`, `stores/`, `schemas/`, `pipelines/`, worksets state move with it — every consumer already funnels through this one getter, verified: project-registry, store foundation, schema/pipeline resolvers, worksets, work-migration). `getGlobalConfigDir()` consolidates to the same root — `config.json` (telemetry `anonymousId`) lives at `~/.rasen/config.json`. No content collisions exist between the two (verified).
- **Env-override policy (decided):** new dedicated `RASEN_HOME` takes highest precedence and points both getters at one directory (the `CODEX_HOME`-style escape hatch; XDG purists set `RASEN_HOME="$XDG_DATA_HOME/rasen"`). `XDG_DATA_HOME` / `XDG_CONFIG_HOME` remain honored BELOW `RASEN_HOME` as compatibility aliases — this keeps existing explicit-XDG installs working and, decisively, keeps the ~30 test files that isolate via `XDG_DATA_HOME`/`LOCALAPPDATA` env swaps green with near-zero churn (XDG already takes precedence over the platform branches today, on all platforms). The Windows `%LOCALAPPDATA%`/`%APPDATA%` branches are removed — the ratified default replaces them; `LOCALAPPDATA` swaps in tests become harmless no-ops.
- **One-time lossless relocation on startup** (precedent: `migrateLegacyBrandConfig`, which stays first in the chain): when no env override is in effect and `~/.rasen` lacks the data, the old default-scheme directories (`%LOCALAPPDATA%\rasen`, `~/.local/share/rasen`; config: `%APPDATA%\rasen`, `~/.config/rasen`) are adopted into `~/.rasen` — copy-only, never overwrite, old directories never deleted, per-child all-or-nothing, loud warning (with manual instructions) on failure, never breaks startup, idempotent. NO registry rewrite is needed — verified against source: `projects/registry.json` stores the home as a directory NAME composed against the root at read time, its keys are project repo paths, and `stores/registry.yaml` records store roots that live outside the machine root; nothing under the root stores the root's own absolute path.
- **Legacy-brand chain fixed, not broken:** `migrateLegacyBrandConfig` currently derives the legacy `openspec` location as a SIBLING of the new getters' result — with the new default it would look for `~/openspec` (wrong). The adoption chain is reworked to compute old-scheme locations explicitly: `openspec` (old scheme) → `rasen` (old scheme) → `~/.rasen`, so ancient installs still chain through.
- **Doctor visibility:** the machine-home section notes a lingering old-scheme directory after successful adoption ("safe to delete after verifying") and reports a failed/pending relocation loudly.
- **Docs updated** where the old scheme is user-facing (`docs/cli.md`, `docs/customization.md`, `docs/opsx.md`, `docs/opsx-workflow-guide.md`, `docs/stores-beta/user-guide.md`); historical documents (handoff notes, upstream-merge references) stay as written. **No template changes**: all skill prose says "machine-home"/payload paths abstractly (verified — no parity churn).

## Capabilities

### New Capabilities
(none — the location contract lives in `global-config`, which already owns path resolution)

### Modified Capabilities
- `global-config`: config storage moves to `~/.rasen/config.json`; the directory-resolution requirements are rewritten for the new precedence (`RASEN_HOME` > XDG alias > `~/.rasen`); a machine-data-root requirement is added for the data side; the one-time brand migration requirement is extended into the explicit two-hop adoption chain (MODIFIED + ADDED requirements).
- `project-registry`: doctor's machine-home section surfaces the lingering-old-directory note and relocation failures (ADDED requirement).

## Impact

- **CLI code**: `src/core/global-config.ts` (both getters + the relocation/adoption chain), `src/cli/index.ts` (startup hook ordering), `src/commands/doctor.ts`/`relationship-health.ts` (notes). All data-dir consumers are untouched (they funnel through the getter; verified list in design).
- **Tests**: `global-config.test.ts` rewritten for the new precedence + relocation matrix; the ~30 env-isolating test files keep working via the retained XDG alias (audit task confirms); new tests set `RASEN_HOME` going forward.
- **Docs**: five user-facing files.
- **This machine has real data** (`openspec-code-1e42477e` home with live work dirs, migrated ephemera, the projects registry): the relocation smoke-tests against a COPY first; the real adoption happens on the first post-merge CLI run.
- **Coordination**: `migrate-legacy-ephemera` (in flight) touches doctor's machine-home section too — apply must edit against landed text (its scanner/paths funnel through `getGlobalDataDir` and relocate for free).
- **Not in scope**: renaming `GLOBAL_DATA_DIR_NAME`, store-root relocation (stores are user repos), deleting old directories (user does, after verification), any `~/.rasen` layout reshuffle beyond the root move.
