# workflows-ui Delta

## ADDED Requirements

### Requirement: Workflow cards share a uniform anatomy with a corner enablement switch

Workflow cards SHALL share one uniform anatomy: equal card sizes within a section's grid (content differences never producing ragged card heights in a row), a fixed slot order — title and id, metadata badges, actions pinned to a consistent footer position — and, when a space is picked for enablement, the per-space enable/disable control rendered as a switch in the card's top-right corner rather than a labeled button crowded against the state text. The enabled/installed state SHALL read as quiet metadata, not as a competing text line. A unit that cannot be toggled (required by an enabled workflow's dependency closure) SHALL show its switch-position affordance visibly inert with the reason available, preserving the existing no-toggle contract. Library actions on a card (export, delete) SHALL render as quiet actions in the card footer.

#### Scenario: Cards render uniformly despite differing content

- **WHEN** a section's grid renders workflow cards whose titles, ids, and badges differ in length
- **THEN** the cards in each row share equal heights with title, metadata, and actions in the same positions on every card

#### Scenario: Enablement is a corner switch

- **WHEN** the user picks a space and views a toggleable workflow card
- **THEN** the card shows a switch in its top-right corner reflecting the enabled state, and operating the switch performs the same per-space enable/disable as before

#### Scenario: Closure-required unit shows an inert control

- **WHEN** the picked space requires a unit through an enabled workflow's dependency closure
- **THEN** that card's switch position shows a visibly inert control with the required-by reason available, and no toggle is possible
