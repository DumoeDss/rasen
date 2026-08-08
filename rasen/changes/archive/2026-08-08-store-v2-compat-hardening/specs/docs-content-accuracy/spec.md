## ADDED Requirements

### Requirement: Store-mode documentation matches the shipped Store layout

Documentation that describes where a Store-bound project's planning content lives SHALL describe the layout the CLI actually writes. Where a document states a planning location, an archive destination, or a selector rule as universal, and that rule now holds only for a standalone project or only for a legacy flat Store, the document SHALL say which case it describes rather than continue to state it as universal.

This applies to the curated `docs/` tree in every language it is published in: a translated page SHALL be reconciled together with its source page, so the two cannot state different layouts.

Documentation SHALL NOT present a Store layout, selector combination, or archive address that the shipped CLI refuses. Behavior that a later slice will add SHALL be presented as design direction, not as current behavior.

#### Scenario: A Store-mode planning location is the shipped one

- **WHEN** a document shows where a Store-bound project's changes, specs, or project design docs live
- **THEN** the location shown SHALL be the one the CLI writes for a Store-bound project
- **AND** it SHALL NOT show a Store-root planning location the CLI refuses to write

#### Scenario: A standalone-only rule says it is standalone-only

- **WHEN** a document states a planning location, archive destination, or selector rule that holds only outside Store mode
- **THEN** the document SHALL name the case it applies to
- **AND** the Store-mode case SHALL either be stated or be linked to the document that states it

#### Scenario: Translated pages state one layout

- **WHEN** a page describing Store layout exists in more than one language
- **THEN** every language's copy SHALL describe the same layout
- **AND** reconciling one copy SHALL reconcile the others in the same change

#### Scenario: Superseded design documents are marked, not silently left standing

- **WHEN** a retained design document's conclusions have been superseded by an accepted later design
- **THEN** the superseded conclusions SHALL be marked as superseded and name the document that replaces them
- **AND** the document SHALL NOT read as current design direction
