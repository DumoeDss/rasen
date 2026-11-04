## ADDED Requirements

### Requirement: Every Project exposes a transitional Issues onboarding surface

Project navigation SHALL offer an Issues entry at `/p/<projectId>/issues`. That Project route SHALL explain and resolve the Project-to-Store relationship needed for Issues, while the Issue Board and Issue Detail SHALL remain Store-owned surfaces at `/s/<storeId>/issues[/:issueId]`. The Project route SHALL preserve the Project Board as the Project's canonical home and SHALL NOT render an Issue Board or Issue Detail.

#### Scenario: Project navigation opens onboarding

- **WHEN** a viewer follows Issues from any Project space
- **THEN** the viewer lands on that Project's `/issues` onboarding surface
- **AND** the page identifies the current Project and the Store-owned Issue destination

#### Scenario: Project Issues is not a read-surface alias

- **WHEN** a viewer opens `/p/<projectId>/issues`
- **THEN** neither the Issue Board nor an Issue Detail is mounted under the Project URL
- **AND** the Project's canonical home remains `/p/<projectId>/board`

#### Scenario: Store Issues remains canonical

- **WHEN** onboarding resolves or establishes a Store membership
- **THEN** Issue reading continues at that Store's `/s/<storeId>/issues` route
- **AND** no Project-prefixed Issue Detail route is created

### Requirement: Store membership routing is derived from the current spaces catalog

The onboarding surface SHALL refresh and read the shared spaces catalog, and SHALL derive the current Project's Store memberships by comparing Project identities with the Store authority's canonical trim-and-lowercase equality rule. This canonical comparison SHALL apply only to membership equality; the current Project route token and Store ids SHALL remain unchanged for URLs and membership mutation input. The surface SHALL recompute that relationship from catalog entries when the catalog changes and SHALL persist no Project-to-Store lookup, preferred Store, or membership cache. It SHALL make no automatic routing decision while the catalog read is unresolved or failed.

#### Scenario: One membership enters its Store automatically

- **WHEN** a successful settled catalog read shows the current Project in exactly one Store
- **THEN** onboarding replace-navigates to that Store's canonical `/issues` route
- **AND** it does not leave the transitional Project URL in browser history

#### Scenario: Canonical-equivalent Project ids resolve one membership

- **WHEN** the current Project row or route uses an uppercase or padded Project id and a Store member records the trim-and-lowercase equivalent id
- **THEN** onboarding treats them as the same Project membership
- **AND** any later membership mutation still receives the current Project id and selected Store id without rewriting either token

#### Scenario: Multiple memberships require an explicit choice

- **WHEN** the catalog shows the current Project in more than one Store
- **THEN** onboarding lists those member Stores and waits for the viewer to select one
- **AND** no Store is chosen from catalog order, prior navigation, or display name

#### Scenario: Zero memberships offers joining paths

- **WHEN** the catalog shows no Store containing the current Project
- **THEN** onboarding offers explicit selection from the listed Stores and an action to create a Store
- **AND** it does not present any Store as an existing membership

#### Scenario: Catalog failure does not guess a destination

- **WHEN** the catalog refresh fails before a routing decision is established
- **THEN** onboarding remains on the Project route with an actionable error and retry
- **AND** it does not auto-navigate from a stale row or a partial list

#### Scenario: Catalog change replaces the derived relationship

- **WHEN** a retry or catalog publication changes the Store member entries for the current Project
- **THEN** the visible membership choices and zero/one/many behavior are rebuilt from the new entries
- **AND** no client invalidation of a Project-to-Store cache is required

### Requirement: A Project with no membership can explicitly join an existing Store

When a viewer selects a listed Store for a Project with no membership, onboarding SHALL submit the unchanged current `projectId` and selected `storeId` through the Project-to-Store membership operation. Canonicalization used to compare Project memberships SHALL NOT rewrite either mutation token. The operation SHALL submit no filesystem path or planning-Store option, and SHALL leave the Project's planning Store and all Issue records unchanged. A successful response SHALL become the shared catalog observation before onboarding starts a background catalog revalidation and replace-navigates to the returned Store's canonical Issue Board.

#### Scenario: Join an empty Store

- **WHEN** a viewer selects a listed Store with no members and confirms joining
- **THEN** onboarding requests membership for exactly the current Project id and selected Store id
- **AND** success enters the returned Store's `/issues` route without rebinding Project planning

#### Scenario: Successful membership is visible during navigation

- **WHEN** the membership operation returns a fresh Store entry containing the Project
- **THEN** that returned entry is published to shared space consumers before navigation
- **AND** a catalog revalidation begins without delaying entry to the Store Issue Board

#### Scenario: Membership failure remains retryable

- **WHEN** the membership operation fails or its outcome is not confirmed
- **THEN** onboarding stays on the Project route, reports the actionable failure, and preserves the selected Store
- **AND** retry submits the same explicit Project and Store ids through the idempotent membership operation

#### Scenario: A different Store can be selected after failure

- **WHEN** an existing-Store membership attempt fails and other Stores remain listed
- **THEN** the viewer can select a different Store instead of retrying the failed target
- **AND** the next request uses only that newly selected Store id

### Requirement: Store creation hands off to recoverable membership establishment

A Project with no Store membership SHALL be able to open Store creation directly from onboarding. The creation dialog SHALL be fixed to Store creation, and after successful creation SHALL return the fresh Store to onboarding instead of performing its normal standalone navigation. Onboarding SHALL then establish the current Project's membership through the same explicit membership operation used for an existing Store. The general Spaces-page dialog SHALL retain its existing create/register choices and canonical post-success navigation when no onboarding success handoff is supplied.

#### Scenario: Create a Store and join it

- **WHEN** a viewer successfully creates a Store from Project Issues onboarding
- **THEN** the created Store becomes the selected membership target
- **AND** onboarding requests membership for the current Project and that Store before entering its Issue Board

#### Scenario: Creation succeeds but membership fails

- **WHEN** Store creation succeeds and the following membership request fails
- **THEN** onboarding reports that the Store exists while membership is still pending
- **AND** it preserves the created Store as the retry target without deleting or recreating it

#### Scenario: Retry after partial success

- **WHEN** a viewer retries after Store creation succeeded but membership did not
- **THEN** onboarding retries only the membership operation against the already-created Store
- **AND** successful retry enters that Store's canonical Issue Board

#### Scenario: Standalone space creation remains unchanged

- **WHEN** a viewer creates or registers a space from the general Spaces page
- **THEN** all existing operation choices remain available
- **AND** success still publishes, refreshes, and navigates to that space's canonical home

### Requirement: Onboarding state and interactions belong to the current Project attempt

Every onboarding loading state, selection, error, creation result, membership result, and navigation SHALL belong to the full Project selector and the current submission attempt. A Project route change or unmount SHALL invalidate prior work before it can publish, render, or navigate. While a membership attempt is active, duplicate submission SHALL be disabled; after failure, controls SHALL return to a retryable state.

#### Scenario: Project transition clears interaction state

- **WHEN** one mounted onboarding route changes from Project A to Project B
- **THEN** Project A's Store selection, partial-success notice, errors, and busy state never appear under Project B
- **AND** Project B resolves membership from its own catalog facts

#### Scenario: Late success cannot navigate a newer owner

- **WHEN** Project A's membership request settles after the route has changed to Project B or the page has unmounted
- **THEN** the late response neither publishes on behalf of the newer page nor changes its route

#### Scenario: Duplicate submission is bounded

- **WHEN** a membership request is already in progress
- **THEN** the join controls prevent a second concurrent submission for that page attempt
- **AND** a failed request re-enables an explicit retry

### Requirement: Onboarding explains the Project-to-Store topology accessibly

The onboarding surface SHALL use the existing application typography, color tokens, controls, and focus treatment. It SHALL present one semantic topology rail identifying the current Project, the Store selection or creation relationship, and the canonical Issues destination. The rail SHALL describe relationships rather than completion steps, SHALL remain understandable without color or arrows, SHALL stack vertically on narrow screens, and SHALL introduce no decorative animation. All new visible copy and accessible names SHALL be available in English, Japanese, and Simplified Chinese.

#### Scenario: Topology communicates ownership

- **WHEN** onboarding requires a Store choice or creation
- **THEN** the page text identifies the current Project, the membership relationship, and Store Issues as the canonical destination
- **AND** it does not imply that Issue data will be created inside the Project

#### Scenario: Keyboard navigation remains visible

- **WHEN** a keyboard user traverses Store choices, retry actions, creation, cancel, and confirmation controls
- **THEN** focus follows document order and each interactive control uses the existing visible focus treatment

#### Scenario: Narrow layout preserves the relationship

- **WHEN** the page is rendered at the application's narrow-screen breakpoint
- **THEN** the topology nodes and connectors stack vertically without horizontal clipping
- **AND** relationship labels remain present as text

#### Scenario: Locale catalogs cover onboarding

- **WHEN** the UI locale is English, Japanese, or Simplified Chinese
- **THEN** every onboarding heading, state, error label, action, topology label, and accessible name resolves from that locale's catalog
