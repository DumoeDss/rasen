## ADDED Requirements

### Requirement: The Defaults section offers a keepalive beat control

The Pipelines page's Defaults section SHALL offer a keepalive control for the `keepalive.beatSeconds` configuration key, rendered only when the key is visible in the active scope mode (the key is global-scope). The control SHALL offer two built-in presets — 100 seconds (fast, compatible with the host shell tool's default timeout) and 270 seconds (economy, the default) — plus a custom numeric input bounded to 90–280; activating a preset or committing a custom value SHALL write `keepalive.beatSeconds` through the config API exactly like other Defaults keys, and the control SHALL reflect the effective value on load and after each write (100 selects the fast preset, 270 the economy preset, any other value presents as custom). The control SHALL display an informational derived tool-timeout hint of the effective beat plus 50 seconds, clearly presented as guidance for the shell tool timeout rather than a written setting. Unset SHALL be offered under the page's existing scope-mode rules, returning the control to the registry default.

#### Scenario: Preset writes the key

- **WHEN** the user activates the 100-second preset in Global mode
- **THEN** a config API write sets `keepalive.beatSeconds` to 100 at the global scope, and the control re-renders from the re-resolved response with the fast preset selected

#### Scenario: Custom value within bounds

- **WHEN** the user commits a custom value of 180
- **THEN** the write carries 180, and the control presents as custom with the derived tool-timeout hint showing 230 seconds

#### Scenario: Out-of-range custom value is rejected client-side and by the API

- **WHEN** the user enters 300 in the custom input
- **THEN** the control surfaces the 90–280 constraint and no successful write occurs

#### Scenario: Hint is informational only

- **WHEN** the user changes the beat value
- **THEN** the tool-timeout hint updates to beat + 50 seconds and no configuration key other than `keepalive.beatSeconds` is written
