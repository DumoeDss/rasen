## ADDED Requirements

### Requirement: Global UI theme preference

The global configuration SHALL accept `ui.theme` as a valid theme identifier
and SHALL default it to `editorial` when absent, while preserving existing and
unknown fields in the `ui` block. Loading an unavailable theme identifier SHALL
preserve that configured value so the UI can report and recover from it rather
than rewriting configuration as a read side effect.

#### Scenario: Existing config receives the Editorial default

- **WHEN** a valid existing global config has no `ui.theme` field
- **THEN** its effective global theme is `editorial`
- **AND** loading does not rewrite the file

#### Scenario: Theme coexists with pinned spaces

- **WHEN** `ui.theme` is saved while `ui.pinnedSpaces` and an unknown `ui` field
  already exist
- **THEN** the theme is saved and both existing fields are preserved

#### Scenario: Unavailable identifier survives loading

- **WHEN** a hand-edited global config contains a syntactically valid theme
  identifier whose manifest is unavailable
- **THEN** global config loading returns that identifier unchanged
- **AND** availability fallback is left to theme activation

