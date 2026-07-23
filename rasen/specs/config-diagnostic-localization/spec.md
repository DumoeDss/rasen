## Requirements

### Requirement: Config and CLI diagnostics render in the session's resolved locale

Every config or CLI diagnostic that has a corresponding entry in the locale catalog SHALL render in the session's resolved CLI locale, regardless of which command or internal code path triggers it. This applies uniformly to the skill/CLI version-mismatch warning, the expert-selection migration notice, the retired-`delivery`-key warning, and the invalid-global-JSON warning — not only to diagnostics surfaced through the `config`/`profile` commands.

#### Scenario: Skill version mismatch warning honors CLI locale

- **WHEN** a project-scoped command triggers the skill/CLI version-mismatch warning
- **AND** the session's resolved CLI locale is `ja` or `zh-cn`
- **THEN** the warning text SHALL render using that locale's catalog entry for the mismatch message, not the English fallback

#### Scenario: Expert-selection migration notice honors CLI locale

- **WHEN** `rasen update` runs against a project without an explicit expert-selection marker, triggering the expert-selection migration notice
- **AND** the session's resolved CLI locale is `ja` or `zh-cn`
- **THEN** the notice text SHALL render using that locale's catalog entry, not the English fallback

#### Scenario: Retired delivery key warning honors CLI locale

- **WHEN** `getGlobalConfig()` reads a stored config containing a retired `delivery` value
- **AND** the caller does not supply an explicit diagnostic reporter
- **AND** the session's resolved CLI locale is `ja` or `zh-cn`
- **THEN** the retired-key warning SHALL render using that locale's catalog entry, not the English fallback

#### Scenario: Invalid global JSON warning honors CLI locale

- **WHEN** `getGlobalConfig()` fails to parse the global config file as JSON
- **AND** the caller does not supply an explicit diagnostic reporter
- **AND** the session's resolved CLI locale (determined without depending on the unparseable file) is `ja` or `zh-cn`
- **THEN** the invalid-JSON warning SHALL render using that locale's catalog entry, not the English fallback

### Requirement: Diagnostics fall back to English when locale cannot be resolved

When resolving the session's CLI locale, or looking up a diagnostic's catalog entry for that locale, fails for any reason, the diagnostic SHALL still be reported, using its hardcoded English fallback text — the same text produced before locale-aware reporting existed. A diagnostic SHALL never be silently dropped because locale resolution failed.

#### Scenario: Locale resolution failure still reports the diagnostic

- **WHEN** any of the four diagnostics above would otherwise render in a resolved locale
- **AND** resolving that locale or its catalog entry throws or otherwise fails
- **THEN** the diagnostic SHALL still print, using its English fallback text
- **AND** the command that triggered the diagnostic SHALL be unaffected by the failure (no additional error surfaced, no non-zero exit caused by the fallback itself)
