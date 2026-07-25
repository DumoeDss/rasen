## ADDED Requirements

### Requirement: Theme selection and import are localized

Every user-facing string introduced by theme selection and import SHALL be
catalog-backed, with complete English, Simplified Chinese, and Japanese
coverage. This includes labels, built-in theme descriptions, import actions,
progress and success states, unavailable-theme warnings, validation categories,
size and identifier conflicts, persistence failures, and recovery guidance.
Missing theme strings SHALL retain the existing English fallback behavior.

#### Scenario: Theme experience follows the active language

- **WHEN** the UI language is English, Simplified Chinese, or Japanese and the
  user opens the General theme controls
- **THEN** the selector, import action, built-in metadata, status, and recovery
  text render in that language

#### Scenario: Theme errors re-localize live

- **WHEN** a theme import error is visible and the user changes `language`
- **THEN** the error category and recovery guidance re-render in the new
  language without a page reload

#### Scenario: Missing translation falls back safely

- **WHEN** a theme message key is absent from the active non-English catalog
- **THEN** the English message is shown rather than a blank or raw key
