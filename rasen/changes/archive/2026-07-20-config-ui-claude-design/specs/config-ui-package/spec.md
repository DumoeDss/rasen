## ADDED Requirements

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
