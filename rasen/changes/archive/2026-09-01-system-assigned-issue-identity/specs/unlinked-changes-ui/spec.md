## MODIFIED Requirements

### Requirement: Creating a single-Change Issue is explicit and recoverable

The create flow SHALL require an operator-authored title, show a confirmation preview, create the
Store-level Issue through the title-only Issue mutation, and then conditionally publish its first
plan from the no-plan base with exactly one Change node and the returned Issue UID. The UI SHALL
report success only after both writes succeed. Because Issue deletion is not a declared mutation, a
first-plan failure SHALL leave the created Issue intact, report that the Change is still unlinked,
and offer the explicit attach-to-that-Issue recovery using the returned identity; it SHALL NOT
silently delete, hide, or call the partial outcome a single-Change Issue.

#### Scenario: Create preview requires authored Issue intent

- **WHEN** an operator chooses create for an unlinked Change
- **THEN** a non-empty title and the exact Change scope are shown for confirmation
- **AND** no Issue ID field or write is required before confirmation

#### Scenario: Both writes produce a single-Change Issue

- **WHEN** Issue creation returns an assigned identity and conditional first-plan publication succeeds
- **THEN** the new open Issue's first revision names that UID and contains exactly the selected Change node
- **AND** the Change link read reports it linked

#### Scenario: Existing Issue id is refused without overwrite

- **WHEN** a compatible create request supplies an alias already owned by another Issue
- **THEN** the flow refuses the alias conflict, leaves the existing Issue unchanged, and publishes no plan

#### Scenario: First-plan failure is an honest partial outcome

- **WHEN** the Issue record is created but first-plan publication fails
- **THEN** the surface names the created Issue by its returned key, reports the Change still unlinked, and offers a confirmed attach recovery using the returned UID
- **AND** it does not delete or disguise either resource
