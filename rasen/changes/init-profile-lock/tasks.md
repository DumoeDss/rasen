# Tasks: init-profile-lock

## 1. Project config: `profile` field

- [x] 1.1 Add optional `profile` string to `ProjectConfigSchema` in `src/core/project-config.ts` (describe it as the project's locked profile) and expose it on `ProjectConfig`
- [x] 1.2 Extend the resilient parser (`parseProjectConfigContent`) next to the existing `workflows` block: non-empty string exposed; non-string or empty dropped with a warning naming `profile`; absence silent
- [x] 1.3 Tests in `test/core/project-config.test.ts`: valid value exposed, non-string dropped resiliently, empty string dropped, absent silent, unknown name still parses

## 2. Resolution seam: honor the lock

- [x] 2.1 In `src/core/profiles.ts`, extend `resolveProjectWorkflowSelection` with the lock layer (precedence: `workflows` override > `profile` lock > user-wide profile); add `'locked-profile'` to the result `mode` and carry structured warning info (shadowed lock, missing definition, `custom` lock) for callers to print
- [x] 2.2 Resolve a locked named profile via `resolveProfileDefinition` verbatim plus dependency closure (bypassing `expertSelectionExplicit`); resolve a locked built-in (`full`/`core`) through `resolveDesiredWorkflowSelection` with the marker honored (design D3)
- [x] 2.3 Fall back to the user-wide profile with a warning when the lock names a missing/invalid definition or `custom`; never fail the command and never write global config (design D6)
- [x] 2.4 Mirror the same three-layer order in `resolveBaseSelectionIds` (`src/core/management-api/workflow-enablement.ts`) and confirm `profile-sync-drift.ts` picks the lock up through the shared seam
- [x] 2.5 Tests in `test/core/profiles.test.ts`: named lock governs, built-in lock governs, override shadows lock (mode + warning), missing profile falls back with warning, `custom` lock falls back, expert dimension per D3
- [x] 2.6 Tests in `test/core/profile-sync-drift.test.ts`: no drift when installed set matches the locked profile's closure while the global profile differs

## 3. `rasen update` in a locked project

- [x] 3.1 In `src/core/update.ts`, print the locked-profile note when resolution reports `mode: 'locked-profile'` (alongside the existing override note) and surface the shadowed-lock/missing-profile warnings
- [x] 3.2 Tests in `test/core/update.test.ts`: update resolves from the locked profile when it differs from global, output names the lock, fallback warning on a deleted named profile

## 4. `rasen init --profile` persists the lock

- [x] 4.1 Extend `resolveProfileOverride` in `src/core/init.ts` to accept saved profile names (via `named-profiles.ts` lookup) in addition to `full`/`core`/`custom`; the invalid-value error lists built-ins plus saved profile names and exits 1
- [x] 4.2 Thread the explicit `--profile` value (except `custom`) into config creation: fresh init emits `profile:` through `serializeConfig` (`src/core/config-prompts.ts`); extend mode writes through the comment-preserving `updateProjectConfigKey`
- [x] 4.3 Resolve the install selection in init from the same three-layer seam so extend mode honors an existing lock when `--profile` is absent
- [x] 4.4 Success output states the project is locked to the chosen profile (English output, matching init's existing output conventions; the fallback/shadow warnings are localized via config diagnostics)
- [x] 4.5 Tests in `test/core/init-profile-lock.test.ts` (dedicated file — `init.test.ts` has an anomalous mixed-EOL committed blob that would EOL-rewrite all 2100 lines under `core.autocrlf=input` if touched): fresh init writes the lock (built-in and named), no `--profile` writes no key, `--profile custom` not persisted, extend mode updates the key preserving comments/other keys, extend mode honors an existing lock, invalid name exits 1 listing available profiles

## 5. `rasen profile update` subcommand

- [x] 5.1 Add an overwrite-capable save path for editing in `src/core/named-profiles.ts` (already existed: `saveNamedProfile` takes `{ overwrite }`; `new` keeps refusing existing names — regression test added)
- [x] 5.2 Implement `updateProfileCommand` in `src/commands/profile.ts`: TTY required; name argument or prompted selection among saved profiles (reuse `chooseUserProfileName`); reserved/built-in names rejected; unknown name → not-found; picker seeded from the stored definition via `promptForNewProfileState`; diff shown; confirm then save; decline → cancelled, file untouched; never calls `applyProfileState`
- [x] 5.3 Register `update [name]` in `registerProfileCommand` and print guidance that locked projects apply the change on their next `rasen update`
- [x] 5.4 Tests in `test/core/named-profiles.test.ts` and `test/commands/profile.test.ts`: definition round-trip on edit, reserved/unknown/non-TTY failures, decline leaves file byte-identical, global selection untouched

## 6. Config key registry: project-scope `profile`

- [x] 6.1 In `src/core/config-keys.ts`, extend the `profile` entry to global+project with per-scope value validation (`enumValuesForScope` + scope-aware `validateConfigValue`): global keeps the `full`/`core`/`custom` enum; project accepts `full`, `core`, or an existing saved profile name and rejects `custom` and unknown names (listing available profiles); store stays rejected
- [x] 6.2 Confirm `rasen config set/unset profile --scope project` and the config HTTP API/UI generic row work through the registry entry (scope threaded into config.ts, config-api/router.ts, config-api/serialize.ts, effective-config.ts); the registry round-trip consistency test covers both scopes
- [x] 6.3 Tests in `test/core/config-keys.test.ts`: project-scope accept/reject matrix (core, named, custom, unknown, store scope)

## 7. Localization

- [x] 7.1 Add all new strings to `src/locales/{en,ja,zh-cn}.json` through the message-key registries (`profile-messages.ts` for the update subcommand; lock warnings as config diagnostics; the locked note in update/init output follows the existing English note convention; help/commandDescriptions entries for the new subcommand and the `--profile` description)
- [x] 7.2 Run the vocabulary sweep and catalog parity tests (both pass)

## 8. Docs and verification

- [x] 8.1 Update `docs/` (`cli.md` init options/examples, `rasen profile` section incl. `update` and the locked-profile contract, config key table; `customization.md`; `zh/cli.md` `--profile` section)
- [x] 8.2 Run focused tests, `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build`, and the full `pnpm test` suite (4067 passed; 1 pre-existing machine-local e2e failure in `test/cli-e2e/basic.test.ts` — untracked `.claude/skills` stamped `0.1.5-dev.local` vs freshly built CLI `0.1.5` triggers the skill-version warning on stderr; unrelated to this change). `packages/ui` build + 300 tests pass
- [x] 8.3 Cross-platform check: all new path handling uses `path.join()`/existing helpers (`listSavedProfileNames`, lock write via `updateProjectConfigKey`, tests use `path.join`); Windows coverage rides the existing CI matrix over the touched suites
