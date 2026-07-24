# config-ui-package Delta Specification

## MODIFIED Requirements

### Requirement: Editing is constraint-driven with a page-level scope mode
Edit controls SHALL be rendered from each entry's serialized constraints — toggles for booleans, selection lists for enumerations, bounded numeric inputs for ranged numbers, a form-picker plus bounded numeric input for dual-form thresholds, text inputs for strings — unchanged. The scope of every write SHALL be selected by a single page-level Global / Local segmented control, not per row: Global targets the global scope; Local targets the current space's own scope — the project layer at a project space, the store layer at a store space. The page SHALL open in Global mode, so entering Config lands on the machine-wide configuration with the space's own scope one click away. The active mode SHALL also filter visibility: only keys settable in the active mode's scope are shown, and a key not settable there is simply absent rather than badged; in Local mode the Profile group's raw keys (the profile and workflow-selection entries) SHALL NOT render as rows — the space's profile is chosen through the Project tab's Profile selector instead, while Global mode keeps those rows. Every write and unset SHALL carry the active mode's explicit scope, and the unset action SHALL be offered only when the active mode's scope holds a value. Client-side validation gives immediate feedback, but the API's verdict is authoritative: API errors SHALL be surfaced with their message and fix guidance at the level they apply — on the field for value and scope errors, on the page for space-resolution errors — and a successful write SHALL update the entry's displayed value and annotations from the API's re-resolved response. Switching modes SHALL re-target writes and re-filter the visible keys without a reload.

#### Scenario: Config opens on Global

- **WHEN** the user navigates to a space's Config page
- **THEN** the page opens in Global mode, and switching to Local is a single click that re-filters without a reload

#### Scenario: Mode selects the write target
- **WHEN** the user edits a dual-scope key in Global mode and then the same key in Local mode at a project space
- **THEN** the first write carries the global scope and the second the project scope, with no per-row scope control involved

#### Scenario: Local mode at a store space writes store scope
- **WHEN** the user edits a key in Local mode at a store space
- **THEN** the write carries the store scope and lands in that store's own configuration

#### Scenario: Mode filters visibility
- **WHEN** the user switches from Global to Local mode
- **THEN** keys settable only globally disappear, keys settable only locally appear, and no reload occurs

#### Scenario: Local mode hides the raw profile rows

- **WHEN** the user switches to Local mode at a project space
- **THEN** the profile and workflow-selection entries render nowhere as config rows (the General tab disappears when it has no other locally settable keys), while Global mode still shows them

#### Scenario: Unset follows the mode
- **WHEN** a key has a value in the active mode's scope and the user unsets it
- **THEN** the unset carries that scope and the entry re-renders showing the value now inherited from the wider layers

#### Scenario: Control types follow constraints
- **WHEN** the page renders a boolean key, an enum key, and a ranged numeric key
- **THEN** they render as a toggle, a selection list, and a bounded numeric input respectively

#### Scenario: Invalid scope surfaces the API's guidance
- **WHEN** a write is rejected by the API as invalid for its scope
- **THEN** the field shows the API's message and its guidance naming where the key is settable

## ADDED Requirements

### Requirement: The Local Project tab selects the space's workflow profile

At a project space in Local mode, the Project tab SHALL present a Profile selector as its first item, above the tab's config groups. The selector SHALL offer "Follow global profile", `full`, `core`, and every saved profile, and SHALL reflect the space's current state from the enablement read: the governing mode and, when locked, the locked profile's name. Choosing a profile SHALL perform the real switch through the enablement API — writing the space's profile lock and applying it, so workflows are installed and removed to match — and choosing "Follow global profile" SHALL clear the lock and apply. When the space carries its own workflow selection override, the selector SHALL say the space uses its own selection, and choosing a profile SHALL require an explicit confirmation whose copy states the space's own selection will be replaced; the selector SHALL also offer the existing reset-to-profile action for the override. While a switch is applying, the selector SHALL prevent a second submission; failures SHALL surface the apply's own error message with the space's actual resulting state. Store spaces SHALL NOT render the selector.

#### Scenario: Picking a profile switches the space

- **WHEN** the user picks saved profile `my-set` in the Project tab's Profile selector at a project space with no override
- **THEN** the space's profile lock is written and applied, and the selector re-renders showing the space locked to `my-set`

#### Scenario: Override replacement requires confirmation

- **WHEN** the space carries its own workflow selection override and the user picks a profile
- **THEN** the selector states the space uses its own selection and asks for explicit confirmation that it will be replaced before switching

#### Scenario: Follow global clears the lock

- **WHEN** a space is locked to a profile and the user chooses "Follow global profile"
- **THEN** the lock is cleared and applied, and the selector shows the space following the user-wide profile

#### Scenario: Selector sits atop the Project tab only

- **WHEN** the user views the Local Project tab at a project space, then switches to Global mode or another tab
- **THEN** the selector renders first in the Local Project tab and nowhere else
