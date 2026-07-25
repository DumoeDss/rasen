## MODIFIED Requirements

### Requirement: The sessions column surfaces the Task's runs with live control

The Task detail page SHALL show, in a right column, the supervised sessions belonging to the Task — those whose linked change is one of the Task's children — with live sessions ordered before ended ones. Each session SHALL expose an expandable output tail and, while it is still live, a kill control that confirms before terminating. The page SHALL offer a Launch run action that starts a supervised run attributed to the page's space and pre-associated with the Task's change context. For a Store page, the launch flow SHALL require the user to choose a current member project or explicitly choose planning-only; the member list is advisory UI data and the server remains authoritative at submission. Member inventory request state SHALL be distinct from the last successful member list: a failed request SHALL preserve the last successful choices and show a retryable localized error, while the zero-member state SHALL be shown only after a successful response.

#### Scenario: Live sessions are shown first

- **WHEN** the sessions column renders a Task that has both live and ended sessions
- **THEN** the live sessions appear before the ended ones

#### Scenario: Only the Task's own sessions appear

- **WHEN** the space has sessions linked to changes outside this Task
- **THEN** the sessions column shows only the sessions whose linked change is one of this Task's children

#### Scenario: Killing a live session confirms first

- **WHEN** a user clicks kill on a live session and confirms
- **THEN** the session is terminated and the column refreshes to reflect its ended state

#### Scenario: Launch run carries space and change context

- **WHEN** a user launches a run from a single-item Task detail page in project space `X`
- **THEN** the launch is submitted with space `X` and the Task's change pre-filled as the run's linked change, with no execution selector required

#### Scenario: Sole Store member is preselected but submitted explicitly

- **WHEN** a Store Task detail page has exactly one current member and the user opens Launch run
- **THEN** that member is preselected and submission includes `execution=project:<server-listed-member-root>` rather than relying on a server-side one-member guess

#### Scenario: Same-id Store clones remain distinct

- **WHEN** two current Store members have the same project id but different registered roots
- **THEN** the launch flow renders distinct choices keyed by root and submits the selected member's server-listed root as the project selector

#### Scenario: Multi-member Store requires a choice

- **WHEN** a Store has multiple current members and the user opens Launch run
- **THEN** no member or Store root is selected by default, submission remains unavailable until the user chooses an execution target, and choosing member A submits member A explicitly

#### Scenario: Inventory expansion cannot turn an automatic default into consent

- **WHEN** a sole Store member is automatically preselected and the live inventory adds another member before submission
- **THEN** the automatic selection is synchronously ineffective in that render, the controls show no selected execution target, and submission remains unavailable without waiting for passive effect reconciliation
- **AND** an explicit project or planning-only choice survives later inventory refreshes only while that project choice remains valid

#### Scenario: Planning-only is an explicit Store option

- **WHEN** a user intentionally chooses planning-only in the Store launch flow
- **THEN** the request submits `execution=planning` and the UI does not present that choice as the default member execution mode

#### Scenario: Store with no members does not invent an execution project

- **WHEN** a Store's current member list is empty
- **THEN** the launch flow offers no project default and requires the user to choose planning-only or cancel

#### Scenario: Member inventory failure is not an empty Store

- **WHEN** loading or polling the Store member inventory fails
- **THEN** the launch flow shows a localized retry action, preserves any last successful member choices, does not show the authoritative zero-member message, and still permits an explicit planning-only choice

#### Scenario: Server validation error remains actionable

- **WHEN** a selected member becomes stale or invalid before the launch request is processed
- **THEN** the dialog stays open and displays the server's validation message verbatim so the user can choose again
