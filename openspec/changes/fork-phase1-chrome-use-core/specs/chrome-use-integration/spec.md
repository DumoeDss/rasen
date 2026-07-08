## ADDED Requirements

### Requirement: Executable Skill Sidecars Install With Their Skill

The system SHALL install a skill's executable helper scripts (`.mjs` and `.js` files) alongside the skill, in addition to the `.md` and `.sh` sidecars already supported, so that a skill whose behavior depends on bundled scripts is functional after `openspec init`/`update`.

#### Scenario: Executable script installs as a sidecar

- **WHEN** a packaged skill directory contains a script file ending in `.mjs` or `.js` beside its `SKILL.md`
- **THEN** that script is copied into the installed skill directory, preserving its subdirectory location (for example `scripts/`)

#### Scenario: Template sources are still excluded

- **WHEN** a packaged skill directory contains a `.tmpl` file or a `SKILL.md`
- **THEN** neither is copied as a sidecar (the `SKILL.md` is generated separately and `.tmpl` sources remain build-only)

#### Scenario: Sidecar subdirectory structure is preserved cross-platform

- **WHEN** sidecars are copied on macOS, Linux, or Windows
- **THEN** the installed paths are built with the platform path separator (never hardcoded slashes) and nested directories such as `scripts/` and `references/` are recreated under the installed skill directory

### Requirement: chrome-use Proxy Is Vendored Into the Package

The system SHALL include the chrome-use CDP proxy as vendored skill sidecars at `skills/experts/chrome-use/`, containing `scripts/cdp-proxy.mjs`, `scripts/check-deps.mjs`, `scripts/match-site.mjs`, and `references/cdp-api.md`, so the fork is self-contained and requires no external skill directory.

#### Scenario: Vendored proxy scripts exist in the package

- **WHEN** the OpenSpec package is inspected
- **THEN** `skills/experts/chrome-use/scripts/` contains `cdp-proxy.mjs`, `check-deps.mjs`, and `match-site.mjs`

#### Scenario: Vendored proxy installs with the chrome-use skill

- **WHEN** a user runs `openspec init` or `openspec update`
- **THEN** the chrome-use proxy scripts and `references/cdp-api.md` are copied into the installed `openspec-chrome-use` skill directory so `check-deps.mjs` can launch the proxy

### Requirement: chrome-use Is Registered as an Expert Skill

The system SHALL register a `chrome-use` expert skill (installed as the `openspec-chrome-use` skill directory) that is always installed with the expert skill set, replacing browse as the browser-driving expert.

#### Scenario: chrome-use skill is generated

- **WHEN** the skill templates are generated
- **THEN** a skill named for chrome-use is produced with directory `openspec-chrome-use` and workflow id `chrome-use`, and is included regardless of workflow filter (like other expert skills)

#### Scenario: SETUP guides browser prerequisites

- **WHEN** the chrome-use skill body is read
- **THEN** its SETUP section instructs running `check-deps.mjs`, states the Chrome / Node 22+ / remote-debugging prerequisites, warns that the first CDP connection triggers a Chrome "Allow" permission popup, and documents the sticky-proxy and per-`targetId` tab lifecycle conventions

#### Scenario: chrome-use skill is self-contained relative to browse

- **WHEN** the chrome-use expert template is built
- **THEN** it does not depend on browse's shared `_shared.ts` browse constants (`BROWSE_SETUP`, `SNAPSHOT_FLAGS`, `COMMAND_REFERENCE`), leaving those for independent rewrite by the sibling expert-templates change

### Requirement: Interactive DOM Snapshot Endpoint

The chrome-use proxy SHALL expose a `/snapshot` endpoint that returns a serialized interactive DOM tree (clickable elements, ARIA roles, and text) for a target tab, with a diff mode that reports what changed since the previous snapshot, providing parity with browse `snapshot -i`/`-C`/`-D`.

#### Scenario: Interactive snapshot returns clickable elements

- **WHEN** `/snapshot` is requested for a loaded target tab in interactive mode
- **THEN** the response enumerates interactive/clickable elements with stable references, their roles, and their text

#### Scenario: Snapshot diff reports changes

- **WHEN** `/snapshot` is requested in diff mode after a prior snapshot of the same target
- **THEN** the response reports the difference between the current interactive tree and the stored baseline

### Requirement: Performance Metrics Endpoint

The chrome-use proxy SHALL expose a `/perf` endpoint that returns page performance metrics (LCP, FCP, CLS, resource timing, and long tasks) for a target tab, providing parity with the browse daemon `perf` command.

#### Scenario: Perf endpoint returns core web vitals and timing

- **WHEN** `/perf` is requested for a loaded target tab
- **THEN** the response includes paint/layout metrics (such as LCP, FCP, CLS), resource timing, and long-task information

### Requirement: Viewport and Responsive Emulation Endpoints

The chrome-use proxy SHALL expose `/viewport` and `/responsive` endpoints that emulate device viewport dimensions per tab via CDP device-metrics override, without resizing the user's real Chrome window, so responsive audits do not regress relative to browse.

#### Scenario: Viewport override applies to a tab

- **WHEN** `/viewport` is requested for a target tab with width and height parameters
- **THEN** subsequent operations and screenshots on that tab reflect the emulated dimensions, and the real browser window is not resized

#### Scenario: Responsive endpoint covers multiple breakpoints

- **WHEN** `/responsive` is requested for a target tab
- **THEN** the tab is emulated across mobile, tablet, and desktop breakpoints so a responsive audit can be performed

#### Scenario: New endpoints are discoverable

- **WHEN** an unknown endpoint is requested and the proxy returns its endpoint help
- **THEN** `/snapshot`, `/perf`, `/viewport`, and `/responsive` are listed among the available endpoints
