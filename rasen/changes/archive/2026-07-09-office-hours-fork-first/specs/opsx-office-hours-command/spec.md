## ADDED Requirements

### Requirement: Diagnosis and Design Products

The skill SHALL route sessions to one of two products: the Diagnosis product (six forcing questions covering demand reality, status quo, target user, wedge, observation, and future-fit) and the Design product (fork-first discipline that asks weight-bearing forks before delivering a stance, then converges to a design doc). Routing is decided by the object of the user's request, not by a mode the user selects.

#### Scenario: Diagnosis product invocation

- **WHEN** agent executes `/rasen:office-hours` and the request routes to the Diagnosis product
- **THEN** the agent SHALL walk the user through six forcing questions covering demand reality, status quo, target user, wedge, observation, and future-fit
- **AND** each question SHALL require a substantive answer before proceeding

#### Scenario: Design product invocation

- **WHEN** agent executes `/rasen:office-hours` and the request routes to the Design product
- **THEN** the agent SHALL run the fork-scan procedure for the session's topics, asking weight-bearing forks before delivering any stance
- **AND** SHALL converge to a single design document once the discussion settles

#### Scenario: Product routing prompt

- **WHEN** agent executes `/rasen:office-hours` and the opening message does not unambiguously indicate which product the user wants
- **THEN** the agent SHALL prompt the user with a goal question and map the answer to a product (Diagnosis or Design), not to a named mode

## MODIFIED Requirements

### Requirement: Facilitation Delegates to the Office-Hours Expert

The office-hours workflow command SHALL treat the `/office-hours` expert skill as the single authority for session facilitation. The inline product-routed description in the command template (six forcing questions for the Diagnosis product; fork-first discipline for the Design product) SHALL serve only as a fallback pre-brief, used when the expert skill is unavailable, and SHALL NOT be run as a second facilitation pass. The design document SHALL be produced exactly once. Precedence: when both the inline description and the expert exist, the expert wins.

#### Scenario: Expert skill drives the session

- **WHEN** the office-hours workflow command runs and the `/office-hours` expert skill is available
- **THEN** the command SHALL delegate session facilitation to the `/office-hours` expert
- **AND** SHALL NOT run the inline description as a separate second pass
- **AND** SHALL produce the design document in a single step

#### Scenario: Fallback when the expert is unavailable

- **WHEN** the `/office-hours` expert skill is not available
- **THEN** the command MAY run the inline product-routed description (Diagnosis product's six questions, or the Design product's fork-first description) as a fallback
- **AND** SHALL still produce the design document exactly once

## REMOVED Requirements

### Requirement: Startup and Builder Modes
**Reason**: "Startup mode" and "Builder mode" are deleted as named routing modes. The office-hours expert now routes by product (Diagnosis vs Design), decided by the object of the user's request rather than a mode the user selects; the six forcing questions and the design-brainstorm content are preserved as behavior but no longer as named modes.
**Migration**: See the "Diagnosis and Design Products" requirement (ADDED above), which carries the six forcing questions forward under the Diagnosis product and the design-thinking content forward as the Design product's fork-first discipline.
