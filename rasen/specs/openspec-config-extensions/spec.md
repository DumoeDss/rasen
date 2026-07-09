# openspec-config-extensions Specification

## Purpose
Extend the global config with `proactive` and `repoMode` fields and embed their values into generated skill instructions at `rasen init`.

## Requirements
### Requirement: GlobalConfig supports proactive field
The `GlobalConfig` interface in `src/core/global-config.ts` SHALL include an optional `proactive` field of type `boolean`. Default value SHALL be `true`.

#### Scenario: Config with proactive field
- **WHEN** `getGlobalConfig()` is called and config.json contains `"proactive": false`
- **THEN** the returned config SHALL have `proactive === false`

#### Scenario: Config without proactive field defaults to true
- **WHEN** `getGlobalConfig()` is called and config.json does not contain `proactive`
- **THEN** the returned config SHALL have `proactive === true`

### Requirement: GlobalConfig supports repoMode field
The `GlobalConfig` interface SHALL include an optional `repoMode` field of type `'solo' | 'collaborative'`. Default value SHALL be `'collaborative'`.

#### Scenario: Config with repoMode field
- **WHEN** `getGlobalConfig()` is called and config.json contains `"repoMode": "solo"`
- **THEN** the returned config SHALL have `repoMode === 'solo'`

#### Scenario: Config without repoMode field defaults to collaborative
- **WHEN** `getGlobalConfig()` is called and config.json does not contain `repoMode`
- **THEN** the returned config SHALL have `repoMode === 'collaborative'`

### Requirement: rasen init embeds config values in skill instructions
When `rasen init` generates expert skill SKILL.md files, the `proactive` and `repoMode` config values SHALL be embedded in the instructions content via a transform callback.

#### Scenario: Proactive false embedded in skill content
- **WHEN** `rasen init` runs with global config `proactive: false`
- **THEN** the generated expert skill instructions SHALL contain guidance to not proactively suggest skills

#### Scenario: RepoMode solo embedded in skill content
- **WHEN** `rasen init` runs with global config `repoMode: "solo"`
- **THEN** the generated expert skill instructions SHALL indicate solo repo mode behavior (proactive fixing)

