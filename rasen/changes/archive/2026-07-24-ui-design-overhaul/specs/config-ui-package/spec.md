# config-ui-package Delta

## ADDED Requirements

### Requirement: Configuration values render readably, never as raw JSON walls

Configuration values SHALL be presented in a human-readable form appropriate to their shape: list values (such as an installed-workflows selection) render as a wrapping list of individual item chips — collapsed behind an item count with an explicit disclosure when the list is long — and structured object values render as labeled fields, while primitive values render as plain text. Raw serialized JSON SHALL NOT be the user-facing presentation of any value. Layer-transparency annotations ("inherited from", "shadowed by") SHALL summarize list values by their item count with the full list available on demand, rather than repeating the entire serialized value a second time. These are display rules only — edit controls and write behavior are unchanged.

#### Scenario: A list value renders as items, not JSON

- **WHEN** the user views a key whose value is a list of workflow ids
- **THEN** the value renders as individual readable items (collapsed to a count with a disclosure when long), not as a bracketed JSON array string

#### Scenario: Inherited list values are summarized

- **WHEN** a list-valued key is inherited from a wider layer and the entry shows an inherited-from annotation
- **THEN** the annotation names the providing layer with the list summarized by item count and expandable on demand, instead of duplicating the serialized list

#### Scenario: Object values render as labeled fields

- **WHEN** the user views a read-only value that is a structured object (for example a remaining-tokens threshold)
- **THEN** it renders as labeled name/value fields rather than a raw JSON object string
