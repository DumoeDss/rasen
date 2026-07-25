## ADDED Requirements

### Requirement: General tab owns supported theme selection and import

In Global mode, Config > General > Appearance SHALL present the installed theme
catalog as a selector for `ui.theme` and SHALL offer a file-picker import
action with theme metadata, progress, success, and actionable validation or
installation errors. A successful import SHALL refresh the options without
changing the active selection; a successful selection SHALL use the config API
and apply the returned global preference live. Theme controls SHALL be absent
in Local mode. The fixed lower-corner test toggle and its browser-local value
SHALL no longer select the product theme.

#### Scenario: Global General tab offers themes

- **WHEN** the user opens Config in Global mode and selects General
- **THEN** Appearance contains the Editorial and CRT options plus each valid
  installed user theme
- **AND** the selector reflects the configured theme or marks it unavailable

#### Scenario: Local mode hides global theme controls

- **WHEN** the user switches Config to Local mode
- **THEN** the theme selector and import action are absent

#### Scenario: Successful import refreshes without selecting

- **WHEN** the user imports a valid new theme
- **THEN** a localized success state appears and the theme becomes selectable
- **AND** the active and configured themes remain unchanged until the user
  selects it

#### Scenario: Failed import is recoverable

- **WHEN** import rejects a file because of format, version, token, effect,
  identifier, size, or persistence
- **THEN** Config shows the localized actionable error beside the import action
- **AND** the selector and rest of Config remain usable

#### Scenario: Corner test toggle is gone

- **WHEN** the application shell renders
- **THEN** no fixed test theme toggle is present
- **AND** a stale browser-local test value does not override the global
  preference

## MODIFIED Requirements

### Requirement: The editor presents a coherent warm-editorial visual identity

The configuration editor SHALL present the built-in Editorial theme as its
default considered, coherent visual identity across every surface it renders,
including the app shell, configuration page and entries, and full-screen
notices. Editorial SHALL retain its parchment canvas, warm neutrals, restrained
terracotta accent, serif headlines, sans UI text, editorial spacing, and
ring-based depth. When another installed theme is active, those same surfaces
SHALL derive their presentation from that theme's validated stable design
tokens and application-owned effects rather than ad-hoc values or
theme-authored CSS.

#### Scenario: Editorial remains the compatibility default

- **WHEN** no valid non-default theme is configured
- **THEN** the editor renders the existing Editorial identity with its warm
  parchment canvas, ivory surfaces, warm neutrals, serif headlines, sans UI,
  and restrained terracotta accent

#### Scenario: Installed theme is coherent across surfaces

- **WHEN** another valid installed theme is active
- **THEN** the shell, pages, controls, dialogs, and notices consume the same
  normalized semantic tokens and enabled application-owned effects

#### Scenario: Token-driven consistency

- **WHEN** the same kind of element appears on more than one surface under any
  theme
- **THEN** it resolves through the same named design token so the treatment is
  consistent across the app

### Requirement: The visual identity adapts to light and dark color schemes

Each theme SHALL declare whether it is adaptive, light-only, or dark-only.
Editorial SHALL remain adaptive to the viewer's environment; an adaptive
installed theme SHALL select its light or dark token set from that environment,
while a fixed-mode theme SHALL consistently use its declared mode. Changing the
environment or active theme SHALL preserve behavior, contrast, and legibility.

#### Scenario: Adaptive theme follows the environment

- **WHEN** Editorial or another adaptive theme is active and the viewer's
  environment changes between light and dark
- **THEN** the editor uses the corresponding validated token set without
  changing layout or behavior

#### Scenario: Fixed dark theme remains dark

- **WHEN** CRT or another dark-only theme is active while the environment
  requests light
- **THEN** the editor keeps the theme's dark presentation and remains legible

#### Scenario: Light presentation remains the Editorial default

- **WHEN** Editorial is active and the viewer expresses no preference or
  requests light
- **THEN** the editor renders Editorial's light parchment presentation
