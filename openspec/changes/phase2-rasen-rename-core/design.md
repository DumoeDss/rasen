## Context

The fork has diverged far enough from upstream `@fission-ai/openspec` to ship as an independent product, **rasen**. Phase 1 shipped under the inherited `openspec` identity; this change (portfolio child C1) performs the core code rename. The hard part is not the volume (~136 files in `src/` contain "openspec") but the **disambiguation**: the token "openspec" appears in at least seven distinct roles, and only some of them are the brand. A blind `sed openspec→rasen` would corrupt the workspace contract and break every already-initialized user project.

Current state, verified by code inspection:
- Package name `@fission-ai/openspec`, bin key `openspec` → `./bin/openspec.js`, version `0.1.0`, `publishConfig.access` already `public`.
- Four true `process.env.OPENSPEC_*` reads (telemetry, concurrency, openers, no-auto-config) across five sites; everything else matching `OPENSPEC_*` is either a code constant naming the workspace dir or a template placeholder token.
- Global config dir constant `GLOBAL_CONFIG_DIR_NAME = 'openspec'` (and `GLOBAL_DATA_DIR_NAME`) in `src/core/global-config.ts`; telemetry `anonymousId`/`noticeSeen` live under it.
- LICENSE already carries both the mandatory upstream line and the maintainer line.
- Three upstream-repo references send users to `Fission-AI/OpenSpec` (`feedback.ts`, `init.ts`, `update.ts`).

## Goals / Non-Goals

**Goals:**
- Published artifact installs as `rasen`, exposes a `rasen` binary, and self-identifies as rasen in program name, help, and telemetry notice.
- Environment variables move cleanly to `RASEN_*` (no shim) except the two industry-standard opt-outs (`DO_NOT_TRACK`, `CI`).
- Global config directory becomes `rasen` with a lossless one-time migration that preserves anonymous telemetry identity.
- Existing user workspaces keep working untouched: the `openspec/` workspace directory, `opsx:` prefix, `<!-- OPENSPEC:START/END -->` markers, and schema identifiers are preserved verbatim.
- `pnpm build` green; skill-generation / skill-templates-parity / skill-sidecar-install green (parity hashes regenerated); `openspec validate --specs` stays 93/93.

**Non-Goals:**
- README/docs rename (C2), release workflow + changesets removal (C3), telemetry endpoint domain switch to `telemetry.rasen.io` (C4). The `telemetry-backend/` directory belongs to another session and is off-limits.
- Renaming the workspace directory `openspec/` or the `opsx:` prefix (a separate, ecosystem-breaking decision deferred indefinitely).
- Any version bump, tagging, push, or npm publish (portfolio-level external actions).

## Decisions

### D1 — Seven-way token disambiguation (the core rule)
Do **not** do a blanket replace. Classify every "openspec"/"OpenSpec"/`OPENSPEC_` occurrence into one of these buckets and act per-bucket:

| # | Bucket | Example | Action |
|---|--------|---------|--------|
| a | Package/bin/brand identity | `name`, bin key, program `.name()` | → `rasen` |
| b | Brand prose (proper noun) | "OpenSpec sends anonymous stats…" | → `Rasen` |
| c | CLI-invocation examples in templates | `openspec update`, `openspec list` | → `rasen <verb>` |
| d | True env vars (non-workspace) | `process.env.OPENSPEC_TELEMETRY` | → `RASEN_*` |
| e | Workspace-dir constants (name + value) | `OPENSPEC_ROOT_DIR = 'openspec'`, `OPENSPEC_DIR_NAME` | **KEEP** |
| f | Workspace markers | `<!-- OPENSPEC:START -->` | **KEEP** |
| g | `opsx:` prefix / schema ids (`spec-driven`) | `opsx:apply` | **KEEP** |

Rationale: buckets e/f/g are part of the contract with existing on-disk user projects. Renaming (e) would make the CLI fail to find already-created `openspec/` workspaces; renaming (f) would make `update`/cleanup stop recognizing its own marker blocks in user files; renaming (g) would orphan existing changes' schema metadata. Because the correct action depends on the token's role — not its spelling — this MUST be done by reviewing each match, not by a global regex.

### D2 — Brand casing convention
Lowercase `rasen` for all machine identifiers (package name, bin, command, env-var lowercase forms, URLs). Capitalized `Rasen` as the proper noun in prose (help text, notice, error messages) where "OpenSpec" was capitalized. Alternatives (all-lowercase everywhere) rejected: sentence-initial "rasen sends…" reads as a typo in user-facing prose.

### D3 — Environment variables: clean cut, telemetry owned by telemetry spec
Rename all four brand env vars to `RASEN_*` with no back-compat reading of the old names — the fork never published, so no user has them set. Keep `DO_NOT_TRACK`/`CI` (not brand). The telemetry opt-out (`RASEN_TELEMETRY`) is specified by the `telemetry` capability; the other three (`RASEN_CONCURRENCY`, `RASEN_ENABLE_CLI_AGENT_OPENERS`, `RASEN_NO_AUTO_CONFIG`) by `rasen-cli-identity`. Internal template placeholder tokens (`__OPENSPEC_PROACTIVE__`, `__OPENSPEC_REPO_MODE__`) and the `OPENSPEC_VERSION` JS const are substituted-away internals with zero user exposure and are left as-is to limit churn (renaming them changes no observable behavior and no user-facing string).

### D4 — Bin file rename `bin/openspec.js` → `bin/rasen.js`
The installed command name is governed by the bin **key**, so renaming the file is not strictly required. We rename it anyway so the published package has no residual `openspec.js` artifact, and update every live reference: `package.json` bin value + `dev:cli`, `scripts/pack-version-check.mjs`, and the CLI-spawning tests under `test/` that reference the path. Archived-change docs and past ship logs that mention the old path are historical records and are left untouched.

### D5 — Global config one-time migration
Flip `GLOBAL_CONFIG_DIR_NAME` and `GLOBAL_DATA_DIR_NAME` to `rasen`. Add a `migrateLegacyBrandConfig()` that runs once at CLI startup: for each resolved new-brand directory (config and data, across XDG / APPDATA / LOCALAPPDATA / `~/.config` / `~/.local/share`), if the new dir is absent but the sibling old-brand `openspec` dir exists, copy it into place (recursive copy of the whole dir so `config.json` with `anonymousId`/`noticeSeen` carries over verbatim). If the new dir already exists, do nothing (never overwrite). Migration is best-effort and swallows errors so it can never break CLI startup — but must not silently drop data (copy-then-leave-original; we do not delete the old dir). This is distinct from the pre-existing `migrateLegacyTelemetryConfig` in `src/telemetry/config.ts`, which migrates the XDG-vs-`~/.config` legacy path *within* a brand; that logic continues to work post-rename because it keys off `GLOBAL_CONFIG_DIR_NAME`.

Alternative considered — lazy migration inside `getGlobalConfigDir()`: rejected because that function is called in hot paths and should stay pure/synchronous; a single explicit startup hook is clearer and testable.

### D6 — Parity hashes are regenerated, not hand-computed
Every skill/command template's text changes (bucket b/c edits), so both `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` in `skill-templates-parity.test.ts` will fail. Regenerate mechanically: run the test, read the actual hashes from the `toEqual` diff, replace both tables, re-run to green. This is expected fallout of a brand rename, not a signal of a logic regression.

### D7 — LICENSE is verify-only
Both required lines already exist. No edit needed beyond confirming the 2024 upstream line is intact.

## Risks / Trade-offs

- **Over-eager replace corrupts the workspace contract** → D1's bucket table is the guardrail; a post-change grep asserts buckets e/f/g are untouched (`OPENSPEC_ROOT_DIR`/`_DIR_NAME` values still `'openspec'`, markers still `OPENSPEC:START`, `opsx:` intact) as an explicit verification task.
- **Config migration data loss** → copy-not-move, never overwrite an existing new dir, best-effort with swallowed errors; a unit test covers "old dir present, new absent → anonymousId preserved" and "new dir present → no-op".
- **Missed env-var call site leaves a dead `OPENSPEC_*` read** → the four vars and five sites are enumerated in tasks; a final `grep -r process.env.OPENSPEC_ src` must return empty.
- **Windows CLI-spawn test EBUSY flake** (known) → isolate-rerun to confirm, not a logic regression.
- **package.json touched by both C1 and C3** → DAG serializes C3 after C1, so no concurrent edit; C1 stays out of the `release`/`changeset` scripts and changeset devDeps.
- **`rasen` npm name squatted between now and publish** → already probed available (placeholder 0.0.1 reserved); publish is a portfolio-level external action, not part of this child.

## Migration Plan

Local-only delivery (commit, no push/tag/publish). Rollback is `git revert` of the child's commits. The user-facing migration is D5's one-time config adoption, which runs automatically and idempotently on first `rasen` invocation.

## Open Questions

None blocking. (Casing D2 and bin-file rename D4 are decided here; if a reviewer prefers keeping `bin/openspec.js`, that is a reversible narrowing that does not affect the shipped command name.)
