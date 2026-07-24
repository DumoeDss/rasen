## ADDED Requirements

### Requirement: Themes use a versioned declarative manifest

Every selectable UI theme SHALL be represented by a versioned JSON manifest
with a stable identifier, user-facing metadata, a color-mode declaration,
recognized design-token values, and an optional set of recognized declarative
effects. Editorial and CRT SHALL be delivered through this same manifest
contract. A manifest SHALL NOT provide raw CSS, selectors, declarations,
scripts, imports, remote URLs, or arbitrary resource references.

#### Scenario: Built-in themes use the public manifest model

- **WHEN** the theme catalog is loaded on a clean installation
- **THEN** Editorial and CRT are available as valid version-1 manifests
- **AND** they use the same token and effect fields accepted from an imported
  theme

#### Scenario: Supported declarative theme is accepted

- **WHEN** a manifest uses the supported schema version, valid metadata,
  recognized typed tokens, and only allow-listed effects
- **THEN** validation returns the normalized manifest without interpreting any
  field as CSS source

#### Scenario: Executable or remote styling is rejected

- **WHEN** a manifest includes raw CSS, a selector, a declaration block, an
  import, a script, a URL, an unknown token, or an unknown effect
- **THEN** validation rejects the manifest with an actionable field-level error
- **AND** none of that content is applied or installed

#### Scenario: Unsupported version is rejected

- **WHEN** a manifest declares a schema version the running Rasen release does
  not support
- **THEN** validation rejects it with an error naming the unsupported and
  supported versions

### Requirement: User themes install safely into the machine theme library

The system SHALL validate an imported theme completely before atomically
installing its normalized manifest beneath the resolved Rasen machine-data
theme directory. Theme identifiers SHALL be portable, path-safe, and compared
case-insensitively; built-in identifiers and an already-installed identifier
SHALL NOT be overwritten. Invalid, oversized, conflicting, or interrupted
imports SHALL leave both the installed library and active preference unchanged.

#### Scenario: Valid theme is installed atomically

- **WHEN** the user imports a valid, supported manifest within the size limit
- **THEN** the normalized manifest appears in the theme catalog only after its
  complete file has been committed beneath the machine-data theme directory
- **AND** the previously selected theme remains selected

#### Scenario: Invalid import changes nothing

- **WHEN** validation of an imported manifest fails
- **THEN** no theme file is installed or partially retained
- **AND** the active and configured themes remain unchanged

#### Scenario: Existing or built-in identifier is protected

- **WHEN** an import uses an identifier matching Editorial, CRT, or an installed
  user theme, including a case-only variation
- **THEN** the import is rejected with an identifier-conflict error
- **AND** the existing theme is unchanged

#### Scenario: Cross-platform path containment

- **WHEN** a manifest is imported on Windows, macOS, or Linux with path
  separators, parent traversal, a drive prefix, or another invalid identifier
- **THEN** it is rejected before a path is constructed
- **AND** every successful install remains a direct JSON file beneath the
  resolved machine-data theme directory using native path handling

#### Scenario: Interrupted install leaves no visible partial theme

- **WHEN** persistence fails while installing an otherwise valid theme
- **THEN** the catalog does not report the theme
- **AND** temporary material is cleaned up without modifying another manifest

### Requirement: Theme activation is early, live, and fail-safe

The UI SHALL resolve the global `ui.theme` preference and activate its validated
manifest before rendering the application. Selecting another installed theme
SHALL update the current document without a page reload. If the preference or
manifest is absent, invalid, incompatible, or unavailable, the UI SHALL render
with the built-in Editorial theme, keep the Config page usable, surface a
recoverable warning there, and leave the saved preference unchanged.

#### Scenario: Configured theme is active at first render

- **WHEN** a valid installed theme is configured before the UI starts
- **THEN** the first rendered application frame uses that theme rather than
  briefly rendering Editorial

#### Scenario: Selection applies live

- **WHEN** the user selects another installed theme in Config
- **THEN** the global preference is saved and the current document applies the
  selected theme without navigation or reload

#### Scenario: Missing configured theme falls back

- **WHEN** `ui.theme` names a theme that is no longer available
- **THEN** the UI renders with Editorial and Config remains operable
- **AND** Config identifies the unavailable preference and offers installed
  themes without silently rewriting the saved value

#### Scenario: Theme service failure does not block the app

- **WHEN** the theme catalog or configured manifest cannot be loaded or decoded
- **THEN** the application finishes startup using Editorial
- **AND** the user can still open Config and recover by selecting an available
  theme

### Requirement: Theme application exposes only stable tokens and named effects

The UI SHALL translate validated manifest tokens through an explicit stable
token map and SHALL implement each allow-listed effect as application-owned
behavior. Theme activation SHALL clear all values and effects from the previous
theme before applying the next one, so manifests cannot depend on internal
component class names or leave styling residue.

#### Scenario: Token values cross only the stable map

- **WHEN** a valid theme is applied
- **THEN** only recognized semantic token values are mapped to their
  application-owned presentation properties
- **AND** no manifest key is treated as a selector or internal component name

#### Scenario: Effects are application-owned

- **WHEN** a theme enables scanlines, uppercase headings, terminal navigation,
  or another supported named effect
- **THEN** the UI activates its own implementation of that effect without
  evaluating theme-authored style text

#### Scenario: Switching does not retain prior theme state

- **WHEN** the user switches from a theme with extra tokens or effects to one
  without them
- **THEN** the omitted values resolve from the new theme's normalized baseline
  and the old effects are absent

