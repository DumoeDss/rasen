## ADDED Requirements

### Requirement: Threshold scheme and binding surfaces have complete three-language coverage

Every user-facing string introduced or changed for threshold scheme management on the Pipelines page SHALL be translated in the shipped English, Simplified Chinese, and Japanese catalogs. This SHALL include scheme and preset cards, editor labels and validation, runtime/default binding rows, scope/source badges, empty and dangling states, delete confirmation, migration guidance, Advanced Overrides, loading states, and mutation success/error framing. These feature keys SHALL exist in all three catalogs; Japanese SHALL NOT rely on the English fallback for this experience.

Runtime ids, scheme names, model match strings, configuration paths, threshold values, and server-provided error details SHALL remain data and SHALL not be translated. Changing the configured language SHALL re-localize an open threshold editor or binding surface through the existing live locale store without losing the draft or reloading the page.

#### Scenario: English threshold management renders completely

- **WHEN** the configured UI locale is English and the user opens schemes, presets, bindings, migration guidance, and Advanced Overrides
- **THEN** every feature label, action, hint, empty state, and confirmation renders from the English catalog

#### Scenario: Simplified Chinese threshold management renders completely

- **WHEN** the configured UI locale is `zh-cn` and the same surfaces are opened
- **THEN** every feature-owned string renders in Simplified Chinese without an English fallback or raw key

#### Scenario: Japanese threshold management renders completely

- **WHEN** the configured UI locale is `ja` and the same surfaces are opened
- **THEN** every feature-owned string renders in Japanese without an English fallback or raw key

#### Scenario: Live language switch preserves an editor draft

- **WHEN** a user has entered an unsaved scheme name and thresholds and the locale changes successfully
- **THEN** the open editor's labels and validation text re-localize immediately
- **AND** the entered name and threshold values remain unchanged

#### Scenario: Domain identifiers remain stable across locales

- **WHEN** the page renders runtime `codex`, scheme `tight`, or config path `thresholds.bindings.codex` in any locale
- **THEN** those identifiers remain byte-identical while their surrounding labels are translated

#### Scenario: Catalog tests pin feature-key parity

- **WHEN** the UI i18n catalog suite runs
- **THEN** every threshold-management key used by the page exists in `en`, `zh-cn`, and `ja`
