# config-ui-package Delta Specification

> Deliberately ADDED-only: this delta touches no requirement the pending `ui-config-redesign-config-page` (W2) or `ui-config-redesign-pipelines-page` (W3) deltas to this spec remove or add, so it is order-independent with both.

## ADDED Requirements

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
