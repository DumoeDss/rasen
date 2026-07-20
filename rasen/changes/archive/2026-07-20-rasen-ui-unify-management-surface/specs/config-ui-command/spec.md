## ADDED Requirements

### Requirement: `rasen config ui` is a deprecated alias for the management platform
The CLI SHALL keep `rasen config ui` working as a deprecated alias: it starts the same unified management server as `rasen ui` (management endpoints, config endpoints, and UI assets on one origin under one session token), resolves the launch project from the working directory (nullable when outside a Rasen project), prints the server URL with the session token in the fragment landing on the config view, and opens the user's default browser to it. It SHALL print a one-line deprecation notice naming `rasen ui` as the replacement. A `--no-open` flag SHALL suppress the browser launch, and a `--port <n>` flag SHALL pin the listen port (ephemeral by default); a port collision SHALL fail with a clear message naming the port, and an invalid port SHALL exit non-zero without starting a server. Every config API endpoint SHALL behave identically to the previous config-only server — same paths, same auth model, same error-code semantics.

#### Scenario: Alias launch lands on the config view
- **WHEN** the user runs `rasen config ui` inside a Rasen project
- **THEN** the unified management server starts on 127.0.0.1 with an ephemeral port
- **AND** the printed URL carries the session token in the fragment and opens on the config view
- **AND** a deprecation notice pointing at `rasen ui` is printed

#### Scenario: Config API contracts preserved
- **WHEN** a client exercises any `/api/v1/config*` endpoint against a server started by `rasen config ui`
- **THEN** paths, authentication, response shapes, and error-code semantics match the contract from before the unification

#### Scenario: --no-open suppresses the browser
- **WHEN** the user runs `rasen config ui --no-open`
- **THEN** the server starts and the URL is printed
- **AND** no browser process is spawned

#### Scenario: Port collision
- **WHEN** the user runs `rasen config ui --port <n>` and the port is already in use
- **THEN** the command fails with an error naming the port and suggesting an alternative
- **AND** exits non-zero

## REMOVED Requirements

### Requirement: `rasen config ui` starts the config server
**Reason**: The config-only server launch is superseded — the command now launches the unified management server as a deprecated alias of `rasen ui`, preserving all flags, error behavior, and every config API contract (see the ADDED requirement above).
**Migration**: Users run `rasen config ui` exactly as before and land on the same config editor; the URL's entry path changes, which is safe because session URLs carry a per-session token and are never durable. New usage should prefer `rasen ui`.
