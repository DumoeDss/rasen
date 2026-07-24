# config-ui-package Specification

## Purpose

Deliver the Rasen visual configuration editor as a separately-installable, optional web UI package. The package is a pure static-asset front end that reads and writes exclusively through the config HTTP API, adds nothing the CLI config commands and API don't already expose, and stays independent of the root package. It provides a minimal platform shell (routing, layout, project switcher, typed API client) whose only module today is the configuration page, leaving room for future modules.
## Requirements
### Requirement: Installing the UI package unlocks a visual config editor
The web UI SHALL be delivered as a separately-installable package that is optional forever: installing it beside the CLI makes `rasen config ui` serve a visual configuration editor, and NOT installing it takes nothing away — every configuration capability the UI exposes SHALL remain available through the CLI config commands and the config HTTP API. The UI SHALL contain no configuration logic of its own: it never reads or writes configuration files, and every read and write flows through the config API.

#### Scenario: UI package installed beside the CLI
- **WHEN** the UI package is installed where the CLI's resolution probes find it and the user runs `rasen config ui`
- **THEN** the browser lands on the visual configuration editor instead of the install-hint page

#### Scenario: CLI-only users lose nothing
- **WHEN** a user never installs the UI package
- **THEN** every configuration key the UI can display or edit remains readable and writable via `rasen config` commands and the config API

#### Scenario: All UI edits flow through the API
- **WHEN** the user changes any configuration value in the UI
- **THEN** the change is applied via a config API write, and the updated effective value, source annotation, and scope values shown afterward come from the API's response

### Requirement: The package builds to pure static assets matching the CLI's serving contract
The UI package SHALL build, with a plain `pnpm build` run inside the package directory, to static assets under its `dist/` directory with `dist/index.html` as the entry — no server code and no runtime dependency on anything but the config API it is served with. The built assets SHALL work when served by the CLI at the server root on any port, including deep links to client-side routes served through the CLI's index fallback. The build and test scripts SHALL run on macOS, Linux, and Windows.

#### Scenario: Plain build produces the contracted output
- **WHEN** `pnpm install` and `pnpm build` are run inside the package directory
- **THEN** the build succeeds and `dist/index.html` exists, alongside the assets it references

#### Scenario: Deep link into a client-side route
- **WHEN** the user opens a client-side route path directly (or reloads on one) while the CLI is serving the installed package
- **THEN** the app loads and renders that route, with all assets resolving regardless of the path depth or the server's port

#### Scenario: Cross-platform developer build
- **WHEN** a developer runs the package's install, build, and test scripts on Windows
- **THEN** they behave the same as on macOS and Linux

### Requirement: The package stays independent of the root package
The UI package SHALL be self-contained under `packages/ui` with its own manifest and its own lockfile, leaving the root package's workflows untouched: root install, build, test, and packaging SHALL behave exactly as before, the CLI's published tarball SHALL NOT include any UI package files, and the root lockfile SHALL NOT change. The package SHALL carry its own version line, released independently of the CLI: no code SHALL hard-code or compare the UI package's version, the CLI SHALL locate an installed package by resolving its `dist/` rather than by matching a version, and bumping or publishing that version SHALL remain the user's decision.

#### Scenario: Root workflows unaffected
- **WHEN** root `pnpm run build` and the root pack checks run after the UI package is added
- **THEN** they pass with no change in behavior or tarball contents, and the root lockfile is unchanged

#### Scenario: Version lines stay decoupled
- **WHEN** an installed UI package's version differs from the CLI's version
- **THEN** the CLI serves that package's assets normally, having resolved it by location rather than by version, and nothing warns or fails on the mismatch

#### Scenario: Releasing the package remains the user's decision
- **WHEN** a change modifies the UI package
- **THEN** it does not bump the package version or publish it as a side effect; the release is a separate, explicit user decision

### Requirement: The app authenticates with the session token from the URL fragment
On load, the app SHALL take the session token from the URL fragment, keep it only in memory, and immediately remove it from the address bar; it SHALL never store the token persistently. Every API request SHALL carry the token as a bearer authorization header. When no token is present or the API answers unauthorized (a stale tab after a server restart), the app SHALL show a clear notice telling the user to re-launch via `rasen ui` rather than failing silently or retrying.

#### Scenario: Token consumed and scrubbed on load
- **WHEN** the browser opens the URL printed by the launch command (token in the fragment)
- **THEN** the app authenticates its API calls with that token
- **AND** the token no longer appears in the address bar or in the URL the user would copy

#### Scenario: Stale tab after server restart
- **WHEN** a previously-opened tab talks to a newly-restarted server (its token is no longer valid)
- **THEN** the app shows a notice instructing the user to re-launch `rasen ui`

### Requirement: Configuration page renders effective config with layer transparency across project and store spaces
The configuration page SHALL serve every planning space: a project space edits its project-layer values, and a store space edits that store's own values — no space type is deferred or stubbed. Every entry the API lists SHALL render with its description and effective value, annotated with where the value comes from (default, global, store, project, or environment override). When the page's local scope holds no value for a visible multi-scope key, the entry SHALL show an inherited-value line naming the providing layer and its value — the inherited store identified by its id when the store layer provides it, otherwise the global layer or the built-in default. When a narrower value shadows wider ones, the shadowed values SHALL remain revealed. A key whose effective value is inherited from a store SHALL render read-only with an affordance that navigates to that store space's configuration page, where the value is editable; in a space with no store inheritance, no store-related affordance SHALL appear anywhere. Entries whose on-disk value is invalid SHALL display the API's warning visibly, the UI SHALL never rewrite or auto-correct on-disk values, and environment-override values SHALL be displayed as read-only precedence.

#### Scenario: Store space edits its own configuration
- **WHEN** the user opens the configuration page in a store space
- **THEN** the page renders the store's entries with local writes targeting the store's own configuration, with no deferral notice

#### Scenario: Inherited-from-store line with store identified
- **WHEN** a project declaring a store pointer has no local value for a key the store sets
- **THEN** the entry shows an inherited-value line naming that store by id with the store's value, and the value annotation reflects the store layer

#### Scenario: Store-inherited row navigates to the store to edit
- **WHEN** the user activates the store-edit affordance on a store-inherited entry
- **THEN** the app switches to that store space's configuration page, where the same key is locally editable

#### Scenario: No store noise without inheritance
- **WHEN** the addressed project declares no store pointer
- **THEN** no inherited-from-store line, store navigation affordance, or store annotation renders on any entry

#### Scenario: Inherited-from-global line
- **WHEN** a multi-scope key has no local value and no store layer provides one
- **THEN** the entry shows an inherited-value line naming the global layer (or the built-in default) with its value, and remains locally editable

#### Scenario: Invalid on-disk value surfaces as a warning
- **WHEN** the API reports a warning for a hand-edited invalid value on disk
- **THEN** the entry displays the warning message and the value is not silently corrected

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

### Requirement: Continuous integration builds and tests the UI package
Every pull request SHALL build the UI package, run its tests, and verify the contracted build output exists; a failure SHALL block the merge gate. The UI package job SHALL be a single additional job feeding the existing CI gate, without widening the cross-platform test matrix.

#### Scenario: UI build failure blocks the gate
- **WHEN** a pull request breaks the UI package's build or tests
- **THEN** the CI gate fails and the pull request cannot merge

#### Scenario: Matrix unchanged
- **WHEN** the CI configuration is inspected after this change
- **THEN** the existing os/node/shell test matrix jobs are unchanged and the UI package builds in one additional job

### Requirement: The editor presents a coherent warm-editorial visual identity

The configuration editor SHALL present a considered, coherent visual identity across every surface it renders — the app shell (header, navigation, project switcher), the configuration page and its groups, each configuration entry (key, source annotation, description, warnings, scope chooser, edit controls, shadowed-value notes, errors, unset actions), and the full-screen relaunch notice. The visual language SHALL be warm and editorial: a parchment-toned page canvas (never pure white), warm-toned neutrals throughout (no cool blue-grays outside the accessibility focus ring), a single terracotta brand accent reserved for the highest-signal action, serif headlines paired with sans UI text, generous editorial spacing, and ring-based depth rather than heavy drop shadows. Every visible value SHALL be driven by named design tokens (color, type scale, spacing, radius, elevation) rather than ad-hoc values, so the identity is consistent across all surfaces.

#### Scenario: Warm parchment canvas and warm neutrals

- **WHEN** the editor loads on any surface
- **THEN** the page background is a warm parchment tone rather than pure white, elevated surfaces use a warm ivory, and text and borders use warm-toned neutrals — with no cool blue-gray anywhere except the keyboard focus ring

#### Scenario: Serif headlines, sans UI, single terracotta accent

- **WHEN** the editor renders headings and interactive controls
- **THEN** headings use a serif type family and UI/body text uses a sans type family, and the terracotta accent is applied only to the primary action, not spread across the interface

#### Scenario: Token-driven consistency

- **WHEN** the same kind of element (a card surface, a body-text color, a control radius) appears on more than one surface
- **THEN** it resolves to the same named design token, so the treatment is identical across the app shell, the config page, and the relaunch notice

### Requirement: The visual identity adapts to light and dark color schemes

The editor SHALL render a light theme as its primary presentation and a dark theme when the viewer's environment requests a dark color scheme, both drawn from the same design-token set so the two themes stay in visual lockstep. Switching between schemes SHALL require no user action and SHALL preserve all behavior, contrast, and legibility.

#### Scenario: Dark scheme requested by the environment

- **WHEN** the viewer's operating system or browser requests a dark color scheme
- **THEN** the editor renders its dark theme — warm dark surfaces and parchment-tinted light text — with the same layout, controls, and behavior as the light theme

#### Scenario: Light scheme as the default

- **WHEN** the viewer expresses no preference or requests a light color scheme
- **THEN** the editor renders the light (parchment) theme

### Requirement: Styling assets are fully self-contained with no runtime network fetches

The editor's visual identity SHALL be delivered entirely by assets bundled into the package's static build: it SHALL NOT fetch webfonts, stylesheets, icons, or any other styling asset from a CDN or remote host at runtime, and SHALL rely on system font stacks (a system serif for headlines, a system sans for UI) rather than downloaded typefaces. The restyle SHALL add no new runtime dependency to the package.

#### Scenario: No external requests for styling

- **WHEN** the CLI serves the built editor and the page loads
- **THEN** all fonts and styles resolve from the served static assets with no request to any external host, so the editor renders identically offline

#### Scenario: Restyle adds no runtime dependency

- **WHEN** the package's dependencies are inspected after the restyle
- **THEN** no new runtime dependency has been added and the build remains a pure static-asset front end

### Requirement: The configuration page is organized into four scope-filtered tabs

The configuration page SHALL present its keys in exactly four tabs mapped from the registry's group metadata: General (Profile, Appearance, and Behavior groups), Project (Project and Archive groups), Privacy (Telemetry group), and Advanced (the Advanced group). The Workflow, Autopilot, and Pipelines groups SHALL NOT render on the configuration page — their keys and family entries belong to the Pipelines page. A tab none of whose keys are visible in the active scope mode SHALL not be shown; a key whose group maps to no tab and is not claimed by another surface SHALL still be reachable in a trailing bucket rather than hidden. Each entry SHALL title on a human-readable label with its dot-path key as secondary text.

#### Scenario: Four tabs, pipeline-surface groups absent

- **WHEN** the configuration page loads
- **THEN** it offers at most General, Project, Privacy, and Advanced tabs, and no key of the Workflow, Autopilot, or Pipelines groups renders anywhere on the page

#### Scenario: Empty tab is absent

- **WHEN** the active mode leaves a tab with no visible keys
- **THEN** that tab is not offered until the mode changes

#### Scenario: Unclaimed unmapped group stays reachable

- **WHEN** an entry's group matches no tab mapping and no other surface claims it
- **THEN** the entry still renders in a trailing bucket rather than disappearing

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

### Requirement: Telemetry payload disclosure on the Privacy surface

Beside the `telemetry.enabled` entry, the configuration page SHALL offer a help affordance disclosing exactly what an enabled telemetry setting sends: the five fields of the actual payload, verbatim — the command name, the CLI version, an anonymous randomly generated UUID, the operating system platform, and the Node.js version — with no field omitted and none added. The disclosure SHALL also state that the key is global-only (one setting for the machine) and that environment opt-outs (`RASEN_TELEMETRY=0`, `DO_NOT_TRACK=1`, and CI environments) always win over the configured value. The disclosure is informational only: it never changes the setting, and its field list SHALL be kept in lockstep with the sending code so the two cannot drift silently.

#### Scenario: The five fields are listed verbatim

- **WHEN** the user opens the telemetry help affordance
- **THEN** it lists exactly the command name, the CLI version, an anonymous random UUID, the OS platform, and the Node.js version as the payload — nothing more, nothing less

#### Scenario: Scope and environment precedence are stated

- **WHEN** the disclosure renders
- **THEN** it states the key is global-only and that the environment opt-outs always override the configured value

#### Scenario: Disclosure cannot drift from the payload

- **WHEN** the test suite runs
- **THEN** a test pins the disclosed field list against the telemetry sending code's actual payload fields, failing on any drift in either direction

#### Scenario: Disclosure changes nothing

- **WHEN** the user opens and closes the disclosure
- **THEN** no configuration write is issued and the toggle's value is unchanged

### Requirement: Configuration values render readably, never as raw JSON walls

Configuration values SHALL be presented in a human-readable form appropriate to their shape: list values (such as an installed-workflows selection) render as a wrapping list of individual item chips — collapsed behind an item count with an explicit disclosure when the list is long — and structured object values render as labeled fields, while primitive values render as plain text. Raw serialized JSON SHALL NOT be the user-facing presentation of any value. Layer-transparency annotations ("inherited from", "shadowed by") SHALL summarize list values by their item count with the full list available on demand, rather than repeating the entire serialized value a second time. These are display rules only — edit controls and write behavior are unchanged.

#### Scenario: A list value renders as items, not JSON

- **WHEN** the user views a key whose value is a list of workflow ids
- **THEN** the value renders as individual readable items (collapsed to a count with a disclosure when long), not as a bracketed JSON array string

#### Scenario: Inherited list values are summarized

- **WHEN** a list-valued key is inherited from a wider layer and the entry shows an inherited-from annotation
- **THEN** the annotation names the providing layer with the list summarized by item count and expandable on demand, instead of duplicating the serialized list

#### Scenario: Object values render as labeled fields

- **WHEN** the user views a read-only value that is a structured object (for example a remaining-tokens threshold)
- **THEN** it renders as labeled name/value fields rather than a raw JSON object string

### Requirement: The Local Project tab selects the space's workflow profile

At a project space in Local mode, the Project tab SHALL present a Profile selector as its first item, above the tab's config groups. The selector SHALL offer "Follow global profile", `full`, `core`, and every saved profile, and SHALL reflect the space's current state from the enablement read: the governing mode and, when locked, the locked profile's name. When the space carries its own workflow selection override, the selector SHALL display that state honestly as a non-selectable "custom (this space's own selection)" value — the override state is visible in the control itself, not merely in surrounding text — and SHALL keep offering the existing reset-to-profile action.

Choosing a value in the selector SHALL only stage a draft: no write and no apply happens on selection. The real switch SHALL be performed by an explicit Update action, which writes and applies through the enablement API — installing and removing workflows to match. Staging "Follow global profile" and activating Update SHALL, for a space governed by a profile lock, clear the lock so the space follows the user-wide profile; for a space that instead carries its own workflow selection override, staging "Follow global profile" and activating Update SHALL first require a dedicated confirmation — distinct from the profile-replacement confirmation — whose copy states the space will follow the global profile and its own selection will be removed, and then remove BOTH the override and the lock in one write (the enablement follow-global mutation), because clearing the lock alone would leave the override still governing. While a staged draft differs from the applied state, the selector SHALL show an inline unapplied-change reminder naming the staged profile, and the Update action SHALL be enabled; when no draft is staged (or it equals the applied state) Update SHALL be disabled. When the space carries its own selection override and the user stages a saved profile, the Update action SHALL require the existing explicit confirmation whose copy states the space's own selection will be replaced, before switching. While a switch is applying, the selector SHALL prevent a second submission; failures SHALL surface the apply's own error message with the space's actual resulting state.

Leaving with an unapplied draft SHALL ask first: switching the page-level scope mode, switching the section tab, or navigating away from the Config route with a staged draft SHALL open a confirmation dialog (the app's existing dialog convention) offering to discard the draft and proceed, or stay; discarding SHALL never perform the apply. Store spaces SHALL NOT render the selector.

#### Scenario: Picking a profile switches the space

- **WHEN** the user picks saved profile `my-set` in the Project tab's Profile selector at a project space with no override
- **THEN** nothing is written or installed yet, an unapplied-change reminder names `my-set`, and only activating Update writes the space's profile lock and applies it, after which the selector shows the space locked to `my-set`

#### Scenario: Unapplied draft reminder and disabled Update

- **WHEN** the user has staged a profile pick without applying, and then re-picks the currently applied value
- **THEN** the reminder shows while the draft differs from the applied state and clears when it no longer does, with Update disabled whenever there is nothing to apply

#### Scenario: Override replacement requires confirmation

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

