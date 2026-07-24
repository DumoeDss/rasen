## ADDED Requirements

### Requirement: The UI renders in the language selected by the `language` config key

The web UI SHALL display every user-facing string — the application shell and header, primary navigation, every page (board, spaces, configuration, workflows, profiles, pipelines, archive, task detail, pipeline canvas), every dialog and notice, and all loading and error fallbacks — in the locale selected by the existing `language` config key (the same key the CLI's locale follows). The UI SHALL treat the `language` key as its sole locale source of truth: it SHALL NOT introduce a separate UI-language setting, and it SHALL NOT widen the config registry or the config HTTP API to carry presentation data. When `language` holds a concrete supported locale, the UI SHALL render in that locale on load.

#### Scenario: UI matches a non-English configured language

- **WHEN** the effective `language` config value is `zh-cn` (respectively `ja`) when the UI loads
- **THEN** every translated user-facing string the UI renders appears in Simplified Chinese (respectively Japanese), including the shell, navigation, page headings, dialog buttons, and loading/error states

#### Scenario: UI defaults to English for the `en` value

- **WHEN** the effective `language` config value is `en` when the UI loads
- **THEN** the UI renders throughout in English

#### Scenario: The UI does not add a separate language setting

- **WHEN** the configuration page is inspected after this change
- **THEN** the only language control is the pre-existing `language` row in the Appearance group, and no second UI-only language key has been added to the registry or surfaced as a control

### Requirement: Changing `language` in Config re-localizes the UI without a page reload

When the user changes the `language` value through the configuration page's existing `language` row, the UI SHALL re-localize the entire application to the newly selected locale as soon as the write succeeds, WITHOUT requiring a full page reload or manual refresh. The re-localization SHALL be global: every currently visible string and every string rendered thereafter SHALL reflect the new locale, including strings on other pages the user navigates to afterward. The write itself SHALL flow through the existing configuration write path (the same write the Config page already performs for every other key), unchanged.

#### Scenario: Switching language in Config re-localizes the live UI

- **WHEN** the UI is open in one locale and the user changes the `language` row to a different supported locale
- **THEN** upon the successful write, every visible user-facing string updates to the new locale while the user remains on the same page, with no navigation loss and no re-entry of the session token

#### Scenario: Re-localization carries to subsequently visited pages

- **WHEN** the user has just switched language in Config and then navigates to another page (for example the board or the pipelines page)
- **THEN** that page renders entirely in the newly selected locale, with no leftover strings from the prior locale

#### Scenario: No full page reload on language change

- **WHEN** the user changes the `language` row and observes the browser during the re-localization
- **THEN** the browser does not perform a full document reload (the in-memory session and the current route are preserved)

### Requirement: `auto` resolves the locale from the browser environment

When the `language` config value is `auto` (the default), the UI SHALL resolve a concrete locale by inspecting the browser's language preference (the environment the UI actually runs in), NOT the CLI's Node-side locale detection. Resolution SHALL prefer a supported locale that matches the browser's stated preference. When the browser's preferred language is one the UI has no catalog for, the UI SHALL fall back to English rather than rendering partially in an unsupported language.

#### Scenario: `auto` detects a supported browser language

- **WHEN** `language` is `auto` and the browser reports a preference whose primary language subtag maps to a supported non-English locale (for example a `zh-…` preference mapping to `zh-cn`)
- **THEN** the UI renders in that supported locale

#### Scenario: `auto` falls back to English for an unsupported browser language

- **WHEN** `language` is `auto` and the browser reports a preference the UI has no catalog for (for example a locale with no `en`/`ja`/`zh-cn` mapping)
- **THEN** the UI renders in English

#### Scenario: `auto` with no detectable browser preference falls back to English

- **WHEN** `language` is `auto` and no browser language preference can be determined
- **THEN** the UI renders in English

### Requirement: Missing translations fall back to English, never blank and never a raw key

For any locale other than English, when a translation key has no entry in that locale's catalog, the UI SHALL render the English entry for that key. At no time SHALL the UI display a blank string or a raw dot-path key to the user as the result of a missing translation. This fallback SHALL be automatic and SHALL apply uniformly to every translated string in the UI.

#### Scenario: A missing key in a non-English locale renders in English

- **WHEN** a user-facing string's key is absent from the active non-English catalog (for example a `zh-cn` catalog gap)
- **THEN** the UI renders that string using the English catalog's entry for the same key

#### Scenario: No raw key or blank is ever shown

- **WHEN** any locale catalog is missing an entry that another catalog provides
- **THEN** the affected location renders the English text, never the key itself and never an empty string

### Requirement: Catalog coverage — `en` and `zh-cn` complete; `ja` covers the framework chrome

The shipped catalogs SHALL provide complete coverage for `en` and `zh-cn`: every key used by the UI SHALL exist in both catalogs, so neither locale leaks English through an untranslated key except via the documented fallback when a key is genuinely missing. For `ja`, the framework chrome — the application shell, the primary navigation entries, and the configuration page's structural labels and controls — SHALL be translated; content beyond the framework chrome MAY fall back to English per the fallback requirement, and every such accepted gap SHALL be recorded in the change's design document as an accepted-known limitation rather than appearing as an unannounced mid-screen language switch.

#### Scenario: `en` and `zh-cn` have complete key-for-key coverage

- **WHEN** the `en` and `zh-cn` catalogs are compared
- **THEN** every key present in one is present in the other, so switching between English and Simplified Chinese never surfaces an English fallback caused by a missing `zh-cn` entry

#### Scenario: `ja` framework chrome is translated

- **WHEN** the `language` is `ja` and the user views the application shell, the primary navigation, and the configuration page's structural labels and controls
- **THEN** those framework-chrome strings render in Japanese

#### Scenario: Accepted `ja` content gaps fall back to English by design

- **WHEN** the `language` is `ja` and the user views content beyond the framework chrome whose key the `ja` catalog does not provide
- **THEN** that content renders in English, and the gap is listed in the change's design document as accepted-known

### Requirement: The `language` control shows each language in its own script

The configuration page's `language` row SHALL label each selectable language with its own endonym rather than only a raw code — English, 日本語, and 简体中文 for the concrete locales, and an `Auto` option for `auto` — so a user who does not read English can still recognize and choose their language. Selecting an option SHALL write that option's underlying config value (`auto`, `en`, `ja`, or `zh-cn`) exactly as before; only the displayed label changes.

#### Scenario: Each locale is shown by its endonym

- **WHEN** the user opens the `language` row's selector
- **THEN** the choices are displayed using their endonyms — English, 日本語, 简体中文 — alongside an `Auto` choice, rather than as the raw values `en` / `ja` / `zh-cn` / `auto` alone

#### Scenario: Selecting an endonym writes the correct underlying value

- **WHEN** the user chooses 简体中文 (respectively English, 日本語, Auto) from the selector
- **THEN** the write carries the underlying value `zh-cn` (respectively `en`, `ja`, `auto`) to the config API, identical to the value the row writes today
