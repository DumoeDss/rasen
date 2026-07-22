# management-ui-command Specification

## Purpose
Provide the public `rasen ui` CLI command — the sole management platform entry point — that launches a combined management API + config API + UI-asset server on loopback with a per-session bearer token, and shuts down cleanly.
## Requirements
### Requirement: Combined serving of management API, config API, and UI assets
The server started by `rasen ui` SHALL serve the management endpoints, the existing config API endpoints, and the UI package's static assets from a single origin under a single session token, so the board page and the config page can both operate against it. When the UI package is not installed, the server SHALL still expose all API endpoints and serve an install-hint page for non-API paths.

#### Scenario: One origin, one token
- **WHEN** the board page fetches management endpoints and the config page fetches config endpoints on a server started by `rasen ui`
- **THEN** both succeed against the same origin using the same bearer token

#### Scenario: UI package missing
- **WHEN** `rasen ui` is run without the UI package installed
- **THEN** the command prints the install hint, API endpoints remain fully usable, and non-API paths serve the install-hint page

### Requirement: Public management platform launch command (adopt-or-spawn)
The CLI SHALL provide a public top-level `rasen ui` command, listed in `rasen --help`, that reaches the management platform by adopting or spawning the resident daemon (per the daemon-residency capability's classification rules): it probes the daemon port, adopts a same-version daemon, replaces a stale one, spawns a fresh daemon when nothing listens, and fails with a clear reason — touching nothing — when a foreign process owns the port. On success it SHALL print a URL of the form `http://127.0.0.1:<port>/#token=<token>` (the daemon's port and token) landing on the board, and open it in the default browser unless `--no-open` is given. `rasen ui --no-daemon` SHALL instead start a self-hosted foreground server exactly as before residency existed: loopback, ephemeral port by default, `--port <n>` to pin it, per-invocation token, sessions supervised by this foreground process. `--port` SHALL apply to the self-hosted form; invalid values are rejected with a clear error and no server or daemon action.

#### Scenario: Launch adopts a running daemon
- **WHEN** a user runs `rasen ui` while a same-version daemon is running
- **THEN** no new server process starts, and the printed URL carries the running daemon's port and token, landing on the board

#### Scenario: Launch spawns the daemon when absent
- **WHEN** a user runs `rasen ui` with nothing listening on the daemon port
- **THEN** the daemon is spawned, the command waits for verified readiness, and the browser opens against the daemon's URL

#### Scenario: Foreign listener fails the launch without harm
- **WHEN** a user runs `rasen ui` while a non-rasen process listens on the daemon port
- **THEN** the command exits non-zero explaining the foreign listener and the port override, sends no signal to the listener, and suggests `--no-daemon` as a fallback

#### Scenario: Self-hosted fallback preserved
- **WHEN** a user runs `rasen ui --no-daemon`
- **THEN** a foreground server starts on a loopback ephemeral port with a fresh token, exactly as the pre-residency command behaved

#### Scenario: Listed in help
- **WHEN** a user runs `rasen --help`
- **THEN** the `ui` command is listed with a description identifying it as the management platform entry point

#### Scenario: Invalid port rejected
- **WHEN** a user runs `rasen ui --no-daemon --port abc` or a port outside 0-65535
- **THEN** the command exits non-zero with a clear error and starts no server

### Requirement: Clean shutdown under daemon residency
Exiting `rasen ui` SHALL leave an adopted or spawned daemon — and every session it supervises — running; the command itself SHALL exit promptly once the URL is delivered. In `--no-daemon` (self-hosted) form, the server SHALL shut down promptly on SIGINT/SIGTERM, force-closing idle keep-alive connections so the CLI process exits without hanging, and SHALL reap its own supervised sessions per the session-supervision capability's owner-shutdown rule.

#### Scenario: UI exit leaves the daemon running
- **WHEN** a user runs `rasen ui` (daemon adopted or spawned) and the command exits or the terminal closes
- **THEN** the daemon keeps running and its supervised sessions are unaffected

#### Scenario: Ctrl-C exit of the self-hosted form
- **WHEN** the user interrupts a running `rasen ui --no-daemon` with browser tabs still holding keep-alive connections
- **THEN** the process exits within the shutdown guard window without hanging on open sockets

