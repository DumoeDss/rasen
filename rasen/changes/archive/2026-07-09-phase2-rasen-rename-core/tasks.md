## 1. Package identity & binary

- [x] 1.1 In `package.json`: set `name` to `rasen`; change `bin` key `openspec` → `rasen` (value updated to `./bin/rasen.js` per 1.3); set `homepage` and `repository.url` to `https://github.com/DumoeDss/rasen`; set `author` to the maintainer; replace the `openspec` keyword. Keep `version` at `0.1.0` and `publishConfig.access` at `public`. Do NOT touch the `release`/`release:ci`/`changeset` scripts or changeset devDeps (owned by C3).
- [x] 1.2 Update the `dev:cli` script path to `node bin/rasen.js`.
- [x] 1.3 Rename the entry file `bin/openspec.js` → `bin/rasen.js` (contents unchanged) and update `scripts/pack-version-check.mjs` and every CLI-spawning test under `test/` that references the old path (`test/commands/spec.test.ts`, `spec.interactive-show.test.ts`, `spec.interactive-validate.test.ts`, `show.test.ts`, `change.interactive-show.test.ts`, `change.interactive-validate.test.ts`, `validate.enriched-output.test.ts`).

## 2. Brand strings across src (bucket discipline — see design D1)

- [x] 2.1 Set the Commander program name to `rasen` and rebrand the top-level `.description` / help text in `src/cli/index.ts` (program `.name('openspec')` at ~line 109).
- [x] 2.2 Rebrand proper-noun prose "OpenSpec" → "Rasen" in command descriptions, error/notice messages, and template prose across `src/` — EXCLUDING the preserved buckets in task 6. Use per-match review, not a blanket replace.
- [x] 2.3 Rewrite CLI-invocation examples in generated skill/command/expert templates: `openspec <verb>` → `rasen <verb>` (e.g., `openspec update` → `rasen update`). Do NOT alter `openspec/` directory paths or the `opsx:` prefix.
- [x] 2.4 Repoint upstream-repo references to the fork: `src/commands/feedback.ts:101,133` (`Fission-AI/OpenSpec` → `DumoeDss/rasen`), `src/core/init.ts:820-821`, and `src/core/update.ts:313` (`https://github.com/Fission-AI/OpenSpec` → `https://github.com/DumoeDss/rasen`).

## 3. Environment variables → RASEN_ (clean cut, no shim)

- [x] 3.1 `OPENSPEC_TELEMETRY` → `RASEN_TELEMETRY` in `src/telemetry/index.ts` (reads at line 99 and the doc-comment/notice mentions at lines 7, 93, 183).
- [x] 3.2 `OPENSPEC_CONCURRENCY` → `RASEN_CONCURRENCY` in `src/commands/validate.ts:344`, `src/cli/index.ts:370`, and `src/core/completions/command-registry.ts:96`.
- [x] 3.3 `OPENSPEC_ENABLE_CLI_AGENT_OPENERS` → `RASEN_ENABLE_CLI_AGENT_OPENERS` in `src/core/openers.ts:41,44`.
- [x] 3.4 `OPENSPEC_NO_AUTO_CONFIG` → `RASEN_NO_AUTO_CONFIG` in `src/core/completions/installers/bash-installer.ts:121` and `zsh-installer.ts:124`.
- [x] 3.5 Leave `DO_NOT_TRACK` and `CI` untouched. Confirm `grep -rn "process.env.OPENSPEC_" src` returns empty.

## 4. Telemetry notice text (telemetry spec)

- [x] 4.1 Update the first-run notice in `src/telemetry/index.ts:183` to say the stats go to rasen's own Cloudflare Worker and opt-out is `RASEN_TELEMETRY=0`. Keep the transport as `node:https` + `agent:false` + guard timer — do NOT revert to `fetch`. Leave the endpoint URL constant alone (owned by C4).

## 5. Global config directory + one-time migration (global-config spec)

- [x] 5.1 In `src/core/global-config.ts`, set `GLOBAL_CONFIG_DIR_NAME` and `GLOBAL_DATA_DIR_NAME` to `rasen`; update the XDG/APPDATA/`~/.config` doc-comments accordingly.
- [x] 5.2 Add `migrateLegacyBrandConfig()` (design D5): for each resolved new-brand dir (config + data, across XDG / APPDATA / LOCALAPPDATA / `~/.config` / `~/.local/share`), if the new dir is absent but the sibling legacy `openspec` dir exists, recursively copy it into the new location (preserving `anonymousId`/`noticeSeen`). Never overwrite an existing new dir; never delete the legacy dir; swallow all errors so startup can't break.
- [x] 5.3 Invoke the migration once at CLI startup (before config is read for normal operation).
- [x] 5.4 Add unit tests for the migration: legacy-present/new-absent → anonymousId preserved; new-present → no-op (no overwrite); neither present → normal first-write path; filesystem error → swallowed, startup proceeds.

## 6. Preserved identifiers — verify untouched (rasen-cli-identity spec)

- [x] 6.1 Confirm workspace-dir constants keep value `'openspec'`: `OPENSPEC_ROOT_DIR`, `OPENSPEC_CONFIG_YAML`, `OPENSPEC_CONFIG_YML`, `OPENSPEC_SPECS_DIR`, `OPENSPEC_CHANGES_DIR`, `OPENSPEC_ARCHIVE_DIR`, `ANCHORED_OPENSPEC_DIRS` (`src/core/openspec-root.ts`) and `OPENSPEC_DIR_NAME` (`src/core/config.ts`).
- [x] 6.2 Confirm `OPENSPEC_MARKERS` values `<!-- OPENSPEC:START -->` / `<!-- OPENSPEC:END -->` (`src/core/config.ts`) are unchanged.
- [x] 6.3 Confirm the `opsx:` command prefix and schema identifiers (`spec-driven`, `DEFAULT_OPENSPEC_SCHEMA`) are unchanged.

## 7. LICENSE

- [x] 7.1 Verify `LICENSE` still carries `Copyright (c) 2024 OpenSpec Contributors` (mandatory) and the `Copyright (c) 2026 DumoeDss` maintainer line. No edit expected.

## 8. Regenerate parity golden-master hashes

- [x] 8.1 Run `pnpm vitest run test/core/templates/skill-templates-parity.test.ts`, read the actual hashes from the `toEqual` diff, and replace both `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES`. Re-run to green. (Full-table churn is expected from the rename.)

## 9. Verification

- [x] 9.1 `pnpm build` green.
- [x] 9.2 `node bin/rasen.js --version` prints `0.1.0`; `node bin/rasen.js --help` shows program name `rasen`.
- [x] 9.3 Vitest trio green: `skill-generation`, `skill-templates-parity`, `skill-sidecar-install`. Update any test asserting old bin name / old env-var names / old config dir / old notice text.
- [x] 9.4 `openspec validate --specs` stays at 93/93 (or higher). Run `openspec validate --specs` and the change validation.
- [x] 9.5 Full `pnpm test` — 2180 passed, 22 skipped, 1 pre-existing failure (`update.test.ts > version tracking > should only update tools that need updating`), which fails at the committed baseline too: the fork's `version` is `0.1.0` and the test hardcodes `generatedBy: "0.1.0"` as its "stale" marker, so no tool reads as needing an update. Not a rename regression (brand strings do not enter version detection).
- [x] 9.6 Final guard grep: `process.env.OPENSPEC_` returns empty in `src/`; workspace-dir constant values still `'openspec'`; markers (`<!-- OPENSPEC:START -->`) and `opsx:` prefix intact; `DEFAULT_OPENSPEC_SCHEMA = 'spec-driven'` intact.
