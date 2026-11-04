## ADDED Requirements

### Requirement: Pipeline stages declare credential-free inference intent
The version 1 Pipeline stage schema SHALL accept an optional `inference` object with broker `omnicross` and an upstream discriminated union of `provider`, `account`, `account-group`, or `account-pool`. The declaration SHALL contain stable resource identifiers only and SHALL use the stage's existing effective model resolution; it SHALL reject route tokens, Provider credentials, control credentials, arbitrary ingress formats, and transformer settings. Omitting `inference` SHALL preserve existing Pipeline parsing and execution behavior.

#### Scenario: Stage selects a Provider upstream
- **WHEN** a stage declares `inference.broker: omnicross` and upstream `{ kind: provider, providerId: deepseek-api }`
- **THEN** the registry SHALL preserve that typed inference declaration with the stage
- **AND** the stage's effective model SHALL continue to resolve through the existing model precedence chain

#### Scenario: Stage selects a subscription account group
- **WHEN** a stage declares an `account-group` upstream with a Provider id and group name
- **THEN** the registry SHALL preserve both identifiers without reducing the target to a Provider-only value

#### Scenario: Stage declares routing secrets
- **WHEN** a Pipeline inference declaration includes a token, API key, credential, custom base URL, arbitrary ingress, or transformer field
- **THEN** validation SHALL reject the Pipeline with an actionable closed-schema diagnostic

#### Scenario: Legacy stage omits inference
- **WHEN** a valid Pipeline written before this capability is parsed
- **THEN** its normalized stage and execution behavior SHALL remain unchanged

### Requirement: Execution inspection exposes effective inference without secrets
The execution view returned by `rasen pipeline show --for-execution --json` SHALL report each stage's resolved inference intent together with the effective runtime and model that will be frozen. It SHALL report absence explicitly for unconfigured stages and SHALL fail execution preflight when an OmniCross-routed stage has no non-empty effective model. Human and management projections SHALL expose only the broker and credential-free upstream identifiers.

#### Scenario: Routed stage is inspected
- **WHEN** execution inspection resolves a Codex stage with an OmniCross Provider target and an effective model
- **THEN** the stage output SHALL identify broker `omnicross`, the safe upstream target, runtime `codex`, and the effective model with its existing source
- **AND** SHALL contain no daemon control credential or route token

#### Scenario: Routed stage has no effective model
- **WHEN** an OmniCross-routed stage reaches execution preflight without a non-empty effective model
- **THEN** preflight SHALL fail before dispatch with a diagnostic naming the stage and missing model
