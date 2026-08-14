## ADDED Requirements

### Requirement: Claude bridge consumes a validated OmniCross turn binding
The Claude runner and `rasen agent dispatch --runtime claude` bridge SHALL accept an optional validated OmniCross turn binding for one agent attempt. Fresh and exact-session continuation invocations SHALL merge only the allowlisted OmniCross base URL, route-token authentication, optional non-secret sentinel, and frozen model variables into the child environment. A dispatch without the binding SHALL retain existing behavior, and no binding SHALL modify Claude settings or credential files.

#### Scenario: Fresh Claude turn uses an OmniCross lease
- **WHEN** a fresh Claude dispatch is given a valid OmniCross binding
- **THEN** the child environment SHALL contain the resident proxy base URL, this lease's route token, the frozen model, and only the permitted sentinel when required
- **AND** the route token SHALL not appear in argv

#### Scenario: Exact Claude session receives a replacement lease
- **WHEN** an exact Claude session resumes after the previous lease was released or lost
- **THEN** the continuation SHALL use a new binding for the same frozen upstream and model while retaining the exact session id and cwd

#### Scenario: Claude dispatch is not routed
- **WHEN** no OmniCross binding is supplied
- **THEN** the runner SHALL preserve its existing environment and invocation behavior

### Requirement: Claude route secrets remain child-scoped and redacted
An OmniCross-routed Claude dispatch SHALL reject launch descriptors containing unrecognized environment keys, upstream credentials, or a token in argv. The route token SHALL exist only in the in-memory lease binding and spawned child's environment, and shared diagnostics SHALL redact it if the child or process launcher echoes it. Rasen SHALL NOT read or modify Claude credentials or settings as part of routing.

#### Scenario: Descriptor includes an upstream API key
- **WHEN** a purported Claude binding contains a Provider API key or an environment key outside the allowlist
- **THEN** Rasen SHALL reject the binding before spawning Claude

#### Scenario: Claude failure echoes the route token
- **WHEN** Claude output or a spawn error contains the route token
- **THEN** the returned receipt and persisted diagnostics SHALL contain a redaction marker instead of the token

#### Scenario: User Claude files are present
- **WHEN** a routed Claude turn runs on a machine with existing settings and credential files
- **THEN** Rasen SHALL leave their bytes and metadata unchanged
