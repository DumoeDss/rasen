## ADDED Requirements

### Requirement: Temporary retro wrapper includes its canonical backing runner

While the temporary `rasen-retro` direct-invocation compatibility surface is generated, the configured tool SHALL also contain the canonical `rasen-retain` runner and the report sidecar to which the wrapper delegates. This compatibility dependency SHALL affect only the effective installed artifact set; it SHALL NOT make retro selectable, model-invokable, or a member of stored profiles.

#### Scenario: Retro remains usable without auto or ship

- **WHEN** init or update configures a profile containing neither `auto-command` nor `ship-command`
- **AND** the current migration window still generates `rasen-retro`
- **THEN** the configured tool SHALL also receive `rasen-retain` with its `report.md` sidecar
- **AND** direct invocation of `rasen-retro` SHALL be able to execute the forced report branch

#### Scenario: Retro remains user-invoked only

- **WHEN** the wrapper and backing runner are generated together
- **THEN** `rasen-retro` SHALL retain `disable-model-invocation: true`
- **AND** neither the wrapper nor the internal compatibility dependency SHALL appear as a selectable profile checkbox

#### Scenario: Codify profile does not change retro behavior

- **WHEN** a user directly invokes `rasen-retro` under a profile whose retention mode is `codify`
- **THEN** the wrapper SHALL use the installed runner's report branch only
- **AND** it SHALL not create, rewrite, promote, or retire a learned skill

#### Scenario: Compatibility files resolve on supported platforms

- **WHEN** the wrapper loads its canonical report branch on POSIX or Windows
- **THEN** the generated runner and sidecar SHALL be discoverable below the configured tool's resolved skills root using platform-native path handling
- **AND** no hardcoded home directory or path separator SHALL be required
