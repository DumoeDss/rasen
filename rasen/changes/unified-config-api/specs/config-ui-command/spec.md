# config-ui-command Specification

## ADDED Requirements

### Requirement: `rasen config ui` starts the config server
The CLI SHALL provide a `rasen config ui` subcommand that starts the localhost config API server, resolves the launch project from the working directory (nullable when outside a Rasen project), prints the server URL including the session token, and opens the user's default browser to it. A `--no-open` flag SHALL suppress the browser launch, and a `--port <n>` flag SHALL pin the listen port (ephemeral by default); a port collision SHALL fail with a clear message naming the port.

#### Scenario: Default launch
- **WHEN** the user runs `rasen config ui` inside a Rasen project
- **THEN** the server starts on 127.0.0.1 with an ephemeral port
- **AND** the printed URL carries the session token in the URL fragment
- **AND** the default browser is opened to that URL

#### Scenario: --no-open suppresses the browser
- **WHEN** the user runs `rasen config ui --no-open`
- **THEN** the server starts and the URL is printed
- **AND** no browser process is spawned

#### Scenario: Port collision
- **WHEN** the user runs `rasen config ui --port <n>` and the port is already in use
- **THEN** the command fails with an error naming the port and suggesting an alternative
- **AND** exits non-zero

### Requirement: Optional UI package resolution and static serving
The command SHALL attempt to resolve the optional UI package from the CLI's own install location (covering global side-by-side installs and package-manager layouts where siblings are off the resolution path). When resolved, the package's static assets SHALL be served at `/` with an index fallback for client-side routes. When absent, the API SHALL still start and be fully usable, `/` SHALL serve a minimal built-in page carrying the install hint, and the CLI SHALL print a clear install instruction naming the UI package. The UI package name SHALL be declared in a single constant so later renames touch one place.

#### Scenario: UI package installed
- **WHEN** the UI package is resolvable from the CLI's install location
- **THEN** `GET /` serves the package's built static entry page
- **AND** unknown non-`/api/` paths fall back to that entry page

#### Scenario: UI package absent
- **WHEN** the UI package is not resolvable
- **THEN** the server still starts and all `/api/v1/` endpoints work
- **AND** `GET /` serves a page containing the install hint
- **AND** the CLI prints an install instruction naming the UI package

### Requirement: Clean shutdown without hanging the process
The server SHALL shut down cleanly on interrupt or terminate signals: stop accepting connections AND force-close all live sockets (including idle keep-alive connections held by browsers), so process exit is never blocked by open sockets. A short guard timer SHALL back-stop shutdown. In-flight configuration writes complete within their request handler before the response is sent, so shutdown never truncates a write.

#### Scenario: Ctrl+C exits promptly
- **WHEN** the user interrupts `rasen config ui` while a browser tab holds open keep-alive connections
- **THEN** the process exits promptly (within the guard interval, not after a multi-second socket timeout)

#### Scenario: Browser opener does not hold the event loop
- **WHEN** the browser is launched
- **THEN** the opener child process is detached and never prevents the CLI process from exiting
