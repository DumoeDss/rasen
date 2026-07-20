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
The UI package SHALL be self-contained under `packages/ui` with its own manifest and its own lockfile, leaving the root package's workflows untouched: root install, build, test, and packaging SHALL behave exactly as before, the CLI's published tarball SHALL NOT include any UI package files, and the root lockfile SHALL NOT change. The package SHALL remain unpublished (marked private) until the user decides to publish it, and nothing in this change SHALL assert or embed a release version.

#### Scenario: Root workflows unaffected
- **WHEN** root `pnpm run build` and the root pack checks run after the UI package is added
- **THEN** they pass with no change in behavior or tarball contents, and the root lockfile is unchanged

#### Scenario: Publishing remains the user's decision
- **WHEN** the change is implemented and merged
- **THEN** no publish of the UI package has occurred and no version number has been bumped or hard-coded anywhere in the change

### Requirement: The app authenticates with the session token from the URL fragment
On load, the app SHALL take the session token from the URL fragment, keep it only in memory, and immediately remove it from the address bar; it SHALL never store the token persistently. Every config API request SHALL carry the token as a bearer authorization header. When no token is present or the API answers unauthorized (a stale tab after a server restart), the app SHALL show a clear notice telling the user to re-launch via `rasen config ui` rather than failing silently or retrying.

#### Scenario: Token consumed and scrubbed on load
- **WHEN** the browser opens the URL printed by `rasen config ui` (token in the fragment)
- **THEN** the app authenticates its API calls with that token
- **AND** the token no longer appears in the address bar or in the URL the user would copy

#### Scenario: Stale tab after server restart
- **WHEN** a previously-opened tab talks to a newly-restarted server (its token is no longer valid)
- **THEN** the app shows a notice instructing the user to re-launch `rasen config ui`

### Requirement: Platform shell scoped to routing, layout, and API client
The app SHALL provide a platform shell — client-side routing, an application layout with navigation and a project switcher, and a typed API client mirroring the config API's wire shapes — with the configuration page as its only module. The shell SHALL NOT pre-build task, kanban, or session-supervision modules or their state management; future modules extend the shell.

#### Scenario: Config page is the sole module
- **WHEN** the user explores the app's navigation
- **THEN** the configuration page is the only functional module offered

#### Scenario: Project switcher
- **WHEN** the user opens the project switcher
- **THEN** it lists the machine's registered projects from the API and defaults to the project the server was launched from
- **AND** selecting a project reloads the configuration view for that project

#### Scenario: Launched outside a project
- **WHEN** the server was launched outside any Rasen project and no project is selected
- **THEN** the app shows global configuration, and project-scope editing is disabled with an explanation until a project is selected

### Requirement: Configuration page renders the effective config with source transparency
The configuration page SHALL render every configuration entry the API lists, grouped by the registry's group metadata with each key's description visible. Each entry SHALL show its effective value, an annotation of where that value comes from (default, global, project, or environment override), and the underlying per-scope values when a narrower scope shadows a wider one. Entries whose on-disk value is invalid SHALL display the API's warning visibly, and the UI SHALL never rewrite or auto-correct on-disk values. Environment-override values SHALL be displayed as read-only precedence, not offered for editing.

#### Scenario: Grouped rendering with descriptions
- **WHEN** the configuration page loads
- **THEN** entries appear grouped by their registry groups, each with its description and effective value

#### Scenario: Shadowed value transparency
- **WHEN** a key has both a global and a project value
- **THEN** the entry shows the effective value with a project source annotation and reveals the shadowed global value

#### Scenario: Invalid on-disk value surfaces as a warning
- **WHEN** the API reports a warning for a hand-edited invalid value on disk
- **THEN** the entry displays the warning message and the value is not silently corrected

### Requirement: Editing is constraint-driven and scope-explicit
Edit controls SHALL be rendered from each entry's serialized constraints — toggles for booleans, selection lists for enumerations, bounded numeric inputs for ranged numbers, a form-picker plus bounded numeric input for dual-form thresholds, text inputs for strings. Every write and unset SHALL carry an explicit scope; when a key is settable in more than one scope, the user chooses the scope. Client-side validation gives immediate feedback, but the API's verdict is authoritative: API errors SHALL be surfaced with their message and fix guidance at the level they apply — on the field for value and scope errors (including an invalid-scope answer naming the correct scope), on the page for project-resolution errors — and a successful write SHALL update the entry's displayed value and source from the API's re-resolved response.

#### Scenario: Control types follow constraints
- **WHEN** the page renders a boolean key, an enum key, and a ranged numeric key
- **THEN** they render as a toggle, a selection list, and a bounded numeric input respectively

#### Scenario: Dual-form threshold control lets the user pick either form
- **WHEN** the page renders a `threshold`-typed key (e.g. `handoff.threshold`)
- **THEN** it offers a choice between the fraction form and the absolute `{ remainingTokens: N }` form, with a bounded numeric input for whichever form is selected
- **AND** the current value's form (fraction or absolute) is pre-selected

#### Scenario: Scope-explicit write
- **WHEN** the user edits a key settable in both scopes
- **THEN** the UI requires a scope choice and the write is sent with that explicit scope

#### Scenario: Invalid scope surfaces the API's guidance
- **WHEN** the user attempts a write the API rejects as invalid for that scope
- **THEN** the field shows the API's message and its guidance naming the scope where the key is settable

#### Scenario: Unset returns a scope value to inherited
- **WHEN** the user unsets a key's project value
- **THEN** the unset is sent with the explicit project scope and the entry re-renders showing the value now inherited from global or default

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
