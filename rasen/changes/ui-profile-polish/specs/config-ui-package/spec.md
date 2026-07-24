# config-ui-package Delta

## MODIFIED Requirements

### Requirement: Platform shell scoped to space-aware routing, layout, and API client
The app SHALL provide a platform shell — client-side routing, an application layout with navigation and a dual-namespace space switcher, and a typed API client mirroring the served APIs' wire shapes — whose navigation offers the platform's views within the selected planning space: the board (the space home), an archive view, and the configuration page. The shell SHALL derive the active planning space from the URL (per the management-ui-shell capability) rather than from an in-memory selection store. The space switcher SHALL list registered projects and stores as two type-tagged groups and SHALL always address a real space — the shell SHALL NOT offer a "no space" / global-only shell state. The shell SHALL NOT provide a top-level Sessions page; live runs surface only through the header's running-run summary. Navigation active-state SHALL be exclusive and truthful: exactly the entry for the current route is marked active — on a space-agnostic route (the Workflows or Profiles page), no space-scoped entry (Board, Archive, Config, Pipelines) is marked active, even though those entries remain rendered and reachable via the most recently visited space. Future task and archive modules extend the shell.

#### Scenario: Navigation offers the platform views
- **WHEN** the user explores the app's navigation within a space
- **THEN** it offers the board, the archive view, and the configuration page for the current space, with the active view indicated
- **AND** no top-level Sessions page is offered

#### Scenario: Space switcher lists both namespaces
- **WHEN** the user opens the space switcher
- **THEN** it lists the machine's registered projects and stores from the spaces API as two type-tagged groups, with the current route's space selected
- **AND** selecting a space navigates to that space's route for the current section, re-scoping the view

#### Scenario: The shell always addresses a real space
- **WHEN** the shell resolves the active space
- **THEN** it addresses a concrete project or store from the URL, and offers no "no project / global only" shell state; when no space is registered it shows a hint to run `rasen ui` inside a Rasen project

#### Scenario: Space-agnostic routes highlight only themselves
- **WHEN** the user is on the Profiles page (or the Workflows page) with a recently visited space keeping the space-scoped nav entries rendered
- **THEN** only the Profiles (respectively Workflows) entry is marked active, and Board, Archive, Config, and Pipelines carry no active marking

### Requirement: Editing is constraint-driven with a page-level scope mode
Edit controls SHALL be rendered from each entry's serialized constraints — toggles for booleans, selection lists for enumerations, bounded numeric inputs for ranged numbers, a form-picker plus bounded numeric input for dual-form thresholds, text inputs for strings — unchanged. An enumeration whose allowed values differ by scope SHALL render the value list for the scope the active mode writes to (for example, the Global profile dropdown offers `full`, `core`, `custom`, and every saved profile name), not a single static list; when the entry's current value is absent from the active scope's list (for example a saved profile that was deleted after being set), the control SHALL still display that value, annotated as not found, rather than hiding it or silently snapping to a different value. The scope of every write SHALL be selected by a single page-level Global / Local segmented control, not per row: Global targets the global scope; Local targets the current space's own scope — the project layer at a project space, the store layer at a store space. The page SHALL open in Global mode, so entering Config lands on the machine-wide configuration with the space's own scope one click away. The active mode SHALL also filter visibility: only keys settable in the active mode's scope are shown, and a key not settable there is simply absent rather than badged; in Local mode the Profile group's raw keys (the profile and workflow-selection entries) SHALL NOT render as rows — the space's profile is chosen through the Project tab's Profile selector instead, while Global mode keeps those rows. Every write and unset SHALL carry the active mode's explicit scope, and the unset action SHALL be offered only when the active mode's scope holds a value. Client-side validation gives immediate feedback, but the API's verdict is authoritative: API errors SHALL be surfaced with their message and fix guidance at the level they apply — on the field for value and scope errors, on the page for space-resolution errors — and a successful write SHALL update the entry's displayed value and annotations from the API's re-resolved response. Switching modes SHALL re-target writes and re-filter the visible keys without a reload.

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

#### Scenario: Global profile dropdown offers saved profiles
- **WHEN** the user opens the profile entry's dropdown in Global mode while saved profiles exist
- **THEN** the list offers `full`, `core`, `custom`, and every saved profile name, and selecting a saved name writes it to the global scope successfully

#### Scenario: A vanished value stays visible, annotated
- **WHEN** the global profile is set to a saved name whose profile no longer exists
- **THEN** the dropdown still shows that name as the current value, annotated as not found, and the other options remain selectable

### Requirement: The Local Project tab selects the space's workflow profile

At a project space in Local mode, the Project tab SHALL present a Profile selector as its first item, above the tab's config groups. The selector SHALL offer "Follow global profile", `full`, `core`, and every saved profile, and SHALL reflect the space's current state from the enablement read: the governing mode and, when locked, the locked profile's name. When the space carries its own workflow selection override, the selector SHALL display that state honestly as a non-selectable "custom (this space's own selection)" value — the override state is visible in the control itself, not merely in surrounding text — and SHALL keep offering the existing reset-to-profile action.

Choosing a value in the selector SHALL only stage a draft: no write and no apply happens on selection. The real switch SHALL be performed by an explicit Update action, which writes and applies through the enablement API — installing and removing workflows to match. Staging "Follow global profile" and activating Update SHALL, for a space governed by a profile lock, clear the lock so the space follows the user-wide profile; for a space that instead carries its own workflow selection override, staging "Follow global profile" and activating Update SHALL first require a dedicated confirmation — distinct from the profile-replacement confirmation — whose copy states the space will follow the global profile and its own selection will be removed, and then remove BOTH the override and the lock in one write (the enablement follow-global mutation), because clearing the lock alone would leave the override still governing. While a staged draft differs from the applied state, the selector SHALL show an inline unapplied-change reminder naming the staged profile, and the Update action SHALL be enabled; when no draft is staged (or it equals the applied state) Update SHALL be disabled. When the space carries its own selection override and the user stages a saved profile, the Update action SHALL require the existing explicit confirmation whose copy states the space's own selection will be replaced, before switching. While a switch is applying, the selector SHALL prevent a second submission; failures SHALL surface the apply's own error message with the space's actual resulting state.

Leaving with an unapplied draft SHALL ask first: switching the page-level scope mode, switching the section tab, or navigating away from the Config route with a staged draft SHALL open a confirmation dialog (the app's existing dialog convention) offering to discard the draft and proceed, or stay; discarding SHALL never perform the apply. Store spaces SHALL NOT render the selector.

#### Scenario: Picking a profile stages a draft, Update applies it

- **WHEN** the user picks saved profile `my-set` in the Project tab's Profile selector at a project space with no override
- **THEN** nothing is written or installed yet, an unapplied-change reminder names `my-set`, and only activating Update writes the space's profile lock and applies it, after which the selector shows the space locked to `my-set`

#### Scenario: Unapplied draft reminder and disabled Update

- **WHEN** the user has staged a profile pick without applying, and then re-picks the currently applied value
- **THEN** the reminder shows while the draft differs from the applied state and clears when it no longer does, with Update disabled whenever there is nothing to apply

#### Scenario: Override replacement requires confirmation at Update time

- **WHEN** the space carries its own workflow selection override and the user stages a profile and activates Update
- **THEN** the selector states the space uses its own selection and asks for explicit confirmation that it will be replaced before switching

#### Scenario: Tab or mode switch with a staged draft asks first

- **WHEN** the user has an unapplied profile draft and switches to Global mode or to another section tab
- **THEN** a confirmation dialog offers to discard the draft and switch, or stay; choosing stay leaves the draft and the page untouched, and choosing discard switches without applying anything

#### Scenario: Leaving the Config route with a staged draft asks first

- **WHEN** the user has an unapplied profile draft and navigates to another page of the app
- **THEN** the same confirmation dialog intervenes, and only an explicit discard proceeds with the navigation

#### Scenario: Override state is visible in the control

- **WHEN** the space carries its own workflow selection override
- **THEN** the selector itself displays "custom (this space's own selection)" as the current, non-selectable state — not "Follow global profile" — and the reset-to-profile action remains offered

#### Scenario: Follow global clears the lock

- **WHEN** a space is locked to a profile and the user stages "Follow global profile" and activates Update
- **THEN** the lock is cleared and applied, and the selector shows the space following the user-wide profile

#### Scenario: Follow global from an override confirms and removes both layers

- **WHEN** a space carries its own workflow selection override and the user stages "Follow global profile" and activates Update
- **THEN** a dedicated confirmation — distinct from the profile-replacement one — states the space will follow the global profile and its own selection will be removed, and only on confirming does the selector remove both the override and any lock in one write and apply, after which the selector shows the space following the user-wide profile

#### Scenario: Selector sits atop the Project tab only

- **WHEN** the user views the Local Project tab at a project space, then switches to Global mode or another tab
- **THEN** the selector renders first in the Local Project tab and nowhere else
