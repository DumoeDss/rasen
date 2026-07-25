## MODIFIED Requirements

### Requirement: The Defaults section offers a keepalive beat control

The Pipelines page's Defaults section SHALL offer a keepalive control for the `keepalive.enabled` and `keepalive.beatSeconds` configuration keys, rendering each setting only when its key is visible in the active scope mode. The control SHALL show the effective enabled value and source, allow the user to write or unset it in Global mode or in Local mode for a project space, and SHALL NOT offer a Local write in a store space. The beat control SHALL offer one built-in preset — 270 seconds (economy, the default) — plus a custom numeric input bounded to 90–280; activating the preset or committing a custom value SHALL write `keepalive.beatSeconds` through the config API exactly like other Defaults keys, and the control SHALL reflect the effective value on load and after each write (270 selects the economy preset, any other value presents as custom). The control SHALL display an informational derived tool-timeout hint of the effective beat plus 50 seconds, clearly presented as guidance for the shell tool timeout rather than a written setting. Unset SHALL be offered per key under the page's existing scope-mode rules, returning that key to its inherited or registry-default value. Labels, descriptions, state text, and accessible names for the enabled switch SHALL use the active UI locale.

#### Scenario: Preset writes the key

- **WHEN** the user activates the 270-second economy preset in Global mode
- **THEN** a config API write sets `keepalive.beatSeconds` to 270 at the global scope, and the control re-renders from the re-resolved response with the economy preset selected

#### Scenario: Custom value within bounds

- **WHEN** the user commits a custom value of 180
- **THEN** the write carries 180, and the control presents as custom with the derived tool-timeout hint showing 230 seconds

#### Scenario: Out-of-range custom value is rejected client-side and by the API

- **WHEN** the user enters 300 in the custom input
- **THEN** the control surfaces the 90–280 constraint and no successful write occurs

#### Scenario: Hint is informational only

- **WHEN** the user changes the beat value
- **THEN** the tool-timeout hint updates to beat + 50 seconds and no configuration key other than `keepalive.beatSeconds` is written

#### Scenario: Effective enabled state is visible

- **WHEN** the effective `keepalive.enabled` value is `false` from the global layer
- **THEN** the keepalive control presents the switch as off and identifies the global source without changing the retained beat value

#### Scenario: Project-local switch overrides global

- **WHEN** a user turns keepalive on in Local mode for a project whose inherited global value is off
- **THEN** the config API writes `keepalive.enabled: true` at project scope and the re-resolved control presents the switch as on with source `project`

#### Scenario: Unsetting the project switch restores inheritance

- **WHEN** a project-local `keepalive.enabled` value is unset
- **THEN** the control re-renders from the inherited global value and source returned by the config API

#### Scenario: Store-local mode does not offer the switch

- **WHEN** the Pipelines page is in Local mode for a store space
- **THEN** `keepalive.enabled` is not rendered as an editable setting because the key has no store scope

#### Scenario: Enabled copy follows the active locale

- **WHEN** the active UI locale changes among English, Japanese, and Simplified Chinese
- **THEN** the enabled label, description, on/off state text, and accessible name update without remounting the page
