## ADDED Requirements

### Requirement: Codex bridge consumes a validated OmniCross turn binding
The Codex runner and `rasen agent dispatch --runtime codex` bridge SHALL accept an optional validated OmniCross turn binding consisting of a dedicated route-token environment value and the allowlisted custom-provider configuration derived from a Route Lease. Fresh and resumed invocations SHALL select the reserved OmniCross Provider per invocation, set `wire_api` to `responses`, select the dedicated `env_key`, and disable response storage without writing or reading user Codex configuration or authentication files. A dispatch without the binding SHALL retain existing behavior.

#### Scenario: Fresh Codex turn uses an OmniCross lease
- **WHEN** a fresh Codex dispatch is given a valid OmniCross binding
- **THEN** the child SHALL receive the route token only through `OMNICROSS_CODEX_ROUTE_TOKEN`
- **AND** its argv SHALL contain the allowlisted per-invocation `model_provider` and `model_providers.omnicross` overrides

#### Scenario: Existing Codex thread receives a replacement lease
- **WHEN** an exact Codex thread resumes with a newly acquired binding for its frozen logical route
- **THEN** the resume invocation SHALL apply that binding while preserving the thread identity and creation-time sandbox semantics

#### Scenario: Codex dispatch is not routed
- **WHEN** no OmniCross binding is supplied
- **THEN** the runner SHALL emit no OmniCross provider override or route-token environment variable

### Requirement: Codex route binding cannot depend on OpenAI login state
An OmniCross-routed Codex dispatch SHALL use the descriptor's dedicated environment key and SHALL reject bindings that request `requires_openai_auth`, use `OPENAI_API_KEY` for the route token, place the token in argv, or attempt to mutate `config.toml` or `auth.json`. Runtime diagnostics SHALL redact the dedicated token even if Codex echoes it.

#### Scenario: Descriptor requests OpenAI authentication
- **WHEN** a purported OmniCross binding contains `requires_openai_auth` or uses `OPENAI_API_KEY` as its token environment
- **THEN** Rasen SHALL reject the binding before spawning Codex

#### Scenario: Codex stderr echoes the route token
- **WHEN** a failing Codex child prints its route token in captured stderr
- **THEN** the bridge receipt SHALL replace the token with a redaction marker

#### Scenario: User Codex files are present
- **WHEN** a routed Codex turn runs on a machine with existing `config.toml` and `auth.json`
- **THEN** Rasen SHALL leave their bytes and metadata unchanged
