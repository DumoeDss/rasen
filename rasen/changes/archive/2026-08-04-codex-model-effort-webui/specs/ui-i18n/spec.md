## ADDED Requirements

### Requirement: Pipeline model and effort controls have complete three-language coverage

Every user-facing label introduced for the Pipelines role-default and per-stage reasoning-effort controls SHALL be catalog-backed with complete English, Simplified Chinese, and Japanese coverage. This includes the Effort column and field labels, Inherit/unset actions, effective-value explanation, and runtime-default fallback copy. Model ids, effort values, config key paths, and provenance source identifiers SHALL remain stable domain tokens across locales.

#### Scenario: Effort controls follow the active language

- **WHEN** the Pipelines page renders in English, Simplified Chinese, or Japanese
- **THEN** every new effort label, action, and fallback explanation renders in the active language without a raw key or English fallback in either non-English locale

#### Scenario: Stable values survive localization

- **WHEN** the active locale changes while a user inspects Luna with effort `max`
- **THEN** the surrounding labels re-localize while `gpt-5.6-luna`, `max`, the config key, and the backend source identifier remain unchanged

#### Scenario: Catalog tests pin effort-key parity

- **WHEN** the UI locale catalogs are tested
- **THEN** every Pipelines effort key used by the page exists with a non-empty translation in `en`, `zh-cn`, and `ja`
