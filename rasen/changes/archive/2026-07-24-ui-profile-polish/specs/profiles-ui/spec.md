# profiles-ui Delta

## ADDED Requirements

### Requirement: Enabling a workflow cascades its strong dependencies into the draft

When the user switches a workflow ON in an editable profile's membership, the draft SHALL also gain every workflow in that workflow's strong dependency closure (as served by the workflow dependency-graph read) that is not already a member, and the page SHALL state which workflows were auto-added and for which workflow. Switching a workflow OFF SHALL never cascade — only that workflow leaves the draft, and any dependents are left for the user to handle. The cascade edits the draft only; Save/Discard semantics are unchanged, and save-time normalization remains the final authority on the stored list.

#### Scenario: Enable pulls strong dependencies

- **WHEN** the user switches ON a driver workflow whose pipelines require other workflows' skills (for example the auto driver)
- **THEN** the draft additionally gains the strong closure (for example propose, apply, review-cycle, ship, archive, retro, and the always-dispatched review expert), and a note names the auto-added workflows and the workflow that required them

#### Scenario: Disable never cascades

- **WHEN** the user switches OFF a workflow that other draft members strongly depend on
- **THEN** only that workflow leaves the draft, no dependent is switched off, and saving still re-adds anything the stored closure requires (visibly, per the existing snap-back behavior)

#### Scenario: Cascade additions are already-on tolerant

- **WHEN** the user enables a workflow whose strong dependencies are all already in the draft
- **THEN** the draft gains only the toggled workflow and no auto-added note appears

### Requirement: Weakly associated experts are hinted, not auto-enabled

An expert workflow that condition-gated pipeline stages of a draft member would use SHALL carry a visible hint naming what it enhances (for example "enhances auto"), so the user understands the association before deciding. A weak association alone SHALL NOT auto-enable the expert; an expert that is also in an enabled workflow's strong closure is enabled by the cascade like any strong dependency. The hint SHALL appear only on the Profiles page's membership editor — the Workflows page presentation is unchanged.

#### Scenario: Conditional expert shows an enhances hint

- **WHEN** the draft contains a workflow whose pipelines dispatch an expert only under a condition (for example the security expert in the full-feature pipeline)
- **THEN** that expert's card shows a hint naming the workflow it enhances, and the expert is not auto-added by enabling that workflow

#### Scenario: Strongly required expert still cascades

- **WHEN** the user enables a workflow whose strong closure includes an expert (for example the review expert)
- **THEN** that expert is auto-added by the cascade even if it also appears as a weak enhancer elsewhere

### Requirement: Bulk membership selection

An editable profile's membership editor SHALL offer two bulk actions: Select all, which adds every selectable (non-internal) workflow to the draft, and Invert, which flips the membership of every selectable workflow. Both act on the draft only, are unavailable for read-only profiles, and are announced by the same unsaved-changes indication as individual toggles.

#### Scenario: Select all fills the draft

- **WHEN** the user activates Select all on an editable profile
- **THEN** every selectable workflow's switch is ON in the draft and the unsaved-changes indication shows (unless the draft was already full)

#### Scenario: Invert flips the draft

- **WHEN** the user activates Invert with some workflows ON
- **THEN** every selectable workflow's membership flips (ON becomes OFF and vice versa) in the draft — so Invert right after Select all clears the selection

#### Scenario: Read-only profiles offer no bulk actions

- **WHEN** the user views a built-in or broken profile
- **THEN** neither Select all nor Invert is offered
