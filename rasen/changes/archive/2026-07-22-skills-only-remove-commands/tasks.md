## 1. Freeze cleanup knowledge into a static module (additive; nothing deleted yet)

- [x] 1.1 Create `src/core/shared/retired-command-paths.ts`: freeze the 19 built-in command file IDs (the workflow IDs behind the 19 `get*CommandTemplate` exports, run through the `-command`-suffix strip — apply, archive, auto, bulk-archive, continue, explore, goal, handoff, help, new, office-hours, onboard, propose, retro, review-cycle, ship, sync, verify, verify-enhanced). Model the module on `legacy-cleanup.ts`'s `RETIRED_WORKFLOW_COMMAND_IDS` precedent.
- [x] 1.2 In the same module, freeze each tool's command file-path rule currently living in the 26 adapters' `getFilePath` (e.g. `.claude/commands/rasen/<id>.md`, `.cursor/commands/rasen-<id>.md`, `.opencode/commands/rasen-<id>.md`, `.windsurf/workflows/rasen-<id>.md`, Codex global prompt dir, etc.). Build every path with `path.join`; never hardcode separators.
- [x] 1.3 Migrate the path-candidate expansion logic from `command-generation/command-file-id.ts` (`getCommandFileId`, `getLegacyCommandFilePath`, `getCommandFilePathCandidates`, `toLegacyPrefixPath`) into the static module, so a cleanup caller gets: current path, `-command`-suffixed legacy path, and legacy `opsx`-prefix variants (`commands/opsx/<id>.md` and `opsx-<id>.md`).
- [x] 1.4 Move `quoteYamlValue` from `command-generation/yaml.ts` to `src/core/shared/yaml.ts` (retained; still referenced by `skill-generation.ts:215/225/239/240`). Leave `escapeYamlValue`/other command-only yaml helpers to be deleted with the module.
- [x] 1.5 Add unit tests for the static module: the 19 IDs are present; path candidates for a sample tool include current + `-command` + `opsx` variants; cross-platform paths via `path.join`.

## 2. Rewire init/update cleanup onto the static module (module still present, keep green)

- [x] 2.1 `src/core/update.ts`: merge `removeCommandFiles` (:564-590) and `removeUnselectedCommandFiles` (:597-637) into ONE unconditional cleanup method that, per detected tool, deletes every candidate path (from task 1.3) for all 19 built-in IDs plus `-command`/`opsx` variants. Preserve the known-id-only safety boundary (never touch user-authored files).
- [x] 2.2 `src/core/init.ts`: point its same-named cleanup (~:1017) at the static module; run it opportunistically even for fresh projects so a fresh `init` leaves zero rasen command files.
- [x] 2.3 Repoint `migration.ts:47-48` (command-install detection loop over `ALL_WORKFLOWS` using `getCommandFilePathCandidates`) at the static module.
- [x] 2.4 Repoint `profile-sync-drift.ts` (:10 import; :59 `definition.command.content.id`; :166-167/:177/:195-196/:251-253 command-path cleanup) at the static module. Where the logic keyed on `definition.command`, key on the static ID list instead.
- [x] 2.5 Repoint `workflow-artifact-ledger.ts` (:7 import; :138-140/:248-250 command-path resolution via `CommandAdapterRegistry`+`getCommandFileId`) at the static module, or drop the command-path branch if the ledger entry only existed to track the command copy.
- [x] 2.6 Repoint `profile-editor.ts:17,200` (`getCommandFileId`) at the static module's id helper.
- [x] 2.7 Run the init/update/migration/profile test suites; confirm cleanup still finds and removes seeded command files.

## 3. Retire the delivery config dimension

- [x] 3.1 `src/core/global-config.ts`: delete `Delivery` type (:35), `LegacyDelivery` (:37), `LEGACY_DELIVERY_MAP` (:40), `isLegacyDelivery` (:46), `DEFAULT_CONFIG.delivery` (:176), and `delivery?` from `GlobalConfig` (:75). Rewrite `normalizeDelivery` (:61-68) as retirement detection: any presence of a `delivery` key → one-time retirement notice + strip key + rewrite. Update the merge/read path (:328-359) accordingly.
- [x] 3.2 Add the retirement notice string (`legacyDelivery` replacement, e.g. `deliveryRetired`) to `src/locales/en.json`, `ja.json`, `zh-cn.json`. Remove the retired delivery UX strings (`deliveryPickerMessage`, the `delivery.both`/`delivery.skills` option labels ~:204-207, `deliveryLabel`, `deliveryExplanation` ~:417-419, `diffDelivery` :466, and the delivery config-key description :493). Keep all three catalogs key-parallel.
- [x] 3.3 `src/core/config-key-registry`: remove `delivery` from the settable-key registry; update the registry-vs-schema drift test data. Ensure `config set delivery <x>` routes to a graceful retirement notice (retired-key handling per design D4), not a raw unknown-key crash and no persistence.
- [x] 3.4 `src/commands/config.ts`: remove delivery display (:481-486) and the legacy-delivery accept block (~:572); wire the retired-key notice path.
- [x] 3.5 `src/commands/profile.ts` + `src/commands/profile-editor.ts`: remove the delivery picker choice, the `delivery` action paths (`profile-editor.ts:36` `ProfileAction`, :40/:73/:76/:83), delivery in profile summaries (:50/:58/:65/:134-147/:181/:189/:262/:299/:348/:371), and the `both`/`skills` delivery selection. Profiles are workflows-only now.
- [x] 3.6 Run config/profile tests; confirm reading a config with a `delivery` value (current or legacy) never errors, prints the notice once, and strips the key.

## 4. Delete command template functions and the command type surface

- [x] 4.1 `src/core/templates/workflows/*.ts`: delete all 19 `get*CommandTemplate` exports. Do NOT touch skill template bodies (Phase C scope).
- [x] 4.2 `src/core/templates/types.ts`: delete the `CommandTemplate` type; `src/core/templates/index.ts`: remove the command-template exports.
- [x] 4.3 `src/core/shared/skill-generation.ts`: delete `CommandTemplateEntry` (:33-42), `getCommandTemplates` (:153-175), `getCommandContents` (:182-192), and the `CommandContent` import (:11); switch the `quoteYamlValue` import (:12) to `../shared/yaml.js`.
- [x] 4.4 `src/core/workflow-registry/types.ts`: delete the `command` field (:39) and its `CommandContent` import (:1). Update catalog loading to ignore any `command` field on user packages with a debug-level note (no error).
- [x] 4.5 `workflow-author` / `workflow-review` expert templates: remove the "generate/review command" segments (these are the experts' own job descriptions — Phase A scope, not skill-body chain steering).
- [x] 4.6 Fix every remaining compile break the type deletions surface (the compiler is the consumer census). Confirm `tsc` is clean.

## 5. Delete the command-generation module

- [x] 5.1 Delete `src/core/command-generation/` entirely (26 adapters + `generator.ts`, `registry.ts`, `types.ts`, `toml.ts`, `command-file-id.ts`, `yaml.ts`, `index.ts`).
- [x] 5.2 Full-repo grep for `command-generation` — confirm zero residual imports. Update `codex-home.ts:7`'s stale prose comment (no code dependency; do not move the file — it is used across the codex module).
- [x] 5.3 `tsc` + full build clean.

## 6. Tests

- [x] 6.1 Delete command-generation test suites (adapter/generator/registry tests).
- [x] 6.2 Update init/update tests: assert zero command files after init; assert `update` unconditionally removes seeded command files; add/keep the "update cleans stale command files without touching user files" case.
- [x] 6.3 Update config/global-config tests: assert the delivery-retirement notice + key strip + rewrite (once), for a current value (`both`) and a legacy value (`commands-first`).
- [x] 6.4 Update `test/core/templates/skill-templates-parity.test.ts`: remove all command-template hash entries; keep skill-template parity.
- [x] 6.5 Update methodology-expert-fusion tests to inspect skill templates only. (No test file inspected command templates for this capability; the delta spec's own scenarios were already skill-only, and all sibling command-template assertions found elsewhere — auto/handoff/review-cycle/ship — were removed in 6.1/6.2.)
- [x] 6.6 `pnpm test` green (Windows CLI-spawning EBUSY flake isolated-rerun per existing convention).

## 7. Docs and changelog

- [x] 7.1 Update `docs/commands.md`, `docs/how-commands-work.md`, `docs/supported-tools.md` for skills-only delivery. `docs/customization.md` and `docs/getting-started.md` had no command-delivery-specific content requiring changes. `docs/zh/` mirrors are pre-existing stale (still on the `openspec-`/`opsx-` pre-rebrand naming, unrelated to this change) — left untouched rather than partially patched; flagged as known-open for a dedicated brand-consistency pass.
- [x] 7.2 Confirm the "no instructions-file injection" non-goal holds — do NOT add a skills index to AGENTS.md/.cursorrules/GEMINI.md. (Verified: no such injection was added.)
- [x] 7.3 CHANGELOG entry (version attribution left to the user; no version bump — read `package.json`).

## 8. Validate

- [x] 8.1 `node bin/rasen.js validate skills-only-remove-commands` clean.
- [x] 8.2 Verify acceptance criteria: fresh init has zero rasen command files; update on a project with command files removes them + notice, user files untouched; a config with any delivery value never fails. (Verified via test/core/init.test.ts and test/core/update.test.ts.)
