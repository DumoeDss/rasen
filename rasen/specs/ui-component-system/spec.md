# ui-component-system Specification

## Purpose

Define the shared visual component language for the management web UI — button hierarchy, card contract, switch control, page header pattern, dialog action convention, and state presentation — built exclusively from the existing design tokens, so every page across the platform reads as one coherent system in both color schemes.

## Requirements

### Requirement: The management UI presents one consistent component language

The management web UI SHALL present a single visual component language across all pages, built exclusively from the existing design tokens (the warm-editorial palette, spacing scale, radii, and both color schemes are unchanged). The language SHALL define: a button hierarchy in which each view shows at most one filled primary action (the view's single highest-signal action), with all other actions rendered as secondary or quiet/ghost buttons and destructive confirmations visually distinct; a uniform card contract in which cards presented in the same grid share equal heights per row with a fixed internal slot order (title area, metadata, actions) and actions aligned consistently; and a switch control for binary on/off state that is operable by keyboard, exposes its on/off state to assistive technology, and shows a visibly distinct disabled state.

#### Scenario: One primary action per view

- **WHEN** the user views any page with multiple actions in its toolbar (for example a page offering both a create action and a refresh action)
- **THEN** exactly one action is rendered in the filled primary style and the remaining actions render in the secondary or quiet style

#### Scenario: Cards in a grid align uniformly

- **WHEN** a page renders a grid of cards whose content lengths differ
- **THEN** cards in the same row render at equal height, with their action areas aligned at a consistent position rather than floating at content-dependent offsets

#### Scenario: Switch communicates and enforces its state

- **WHEN** the user operates a switch control with the keyboard
- **THEN** the switch toggles, its on/off state is exposed to assistive technology, and a disabled switch is visibly inert and does not toggle

### Requirement: Pages share a common header and state presentation

Every page SHALL open with a common header pattern — the page title with the page-level actions aligned in one toolbar row — and dialogs SHALL follow one action convention: a single visually primary confirming action with quiet dismiss/cancel affordances, never two competing filled buttons. Loading, empty, and error states SHALL render in one consistent muted presentation with any retry affordance styled as a non-primary action.

#### Scenario: Page header pattern is shared

- **WHEN** the user navigates between the Board, Archive, Config, Pipelines, and Workflows pages
- **THEN** each page opens with the same title-plus-toolbar header pattern with actions in a consistent position

#### Scenario: Dialogs follow one action convention

- **WHEN** any dialog with a confirming action is open
- **THEN** the confirming action is the only filled button in the dialog and dismissal is offered as a quiet action

### Requirement: The component language holds in both color schemes

Every component defined by the component language SHALL derive its colors from the design tokens so that it renders legibly in both the light and dark color schemes (and degrades gracefully under the opt-in CRT variant), with interactive states (hover, focus, disabled) visible in both schemes.

#### Scenario: Components stay legible across schemes

- **WHEN** the user switches between the light and dark color schemes
- **THEN** buttons, cards, switches, and status chips remain legible with visible interactive states, without any component hardcoding scheme-specific colors
