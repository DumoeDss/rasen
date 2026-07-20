# management-ui-command Specification

## Purpose
Provide the public `rasen ui` CLI command — the sole management platform entry point — that launches a combined management API + config API + UI-asset server on loopback with a per-session bearer token, and shuts down cleanly.

## Requirements
### Requirement: Public management platform launch command
The CLI SHALL provide a public top-level `rasen ui` command, listed in `rasen --help`, that starts the management server on 127.0.0.1, mints a per-session bearer token, prints a URL of the form `http://127.0.0.1:<port>/#token=<token>` landing on the board (the platform home), and opens it in the default browser unless `--no-open` is given. The command SHALL support `--port <n>` to pin the listen port (ephemeral by default).

#### Scenario: Launch and land on the board
- **WHEN** a user runs `rasen ui` inside a Rasen project
- **THEN** the management server starts on a loopback ephemeral port, the platform URL with the token fragment is printed, and the default browser opens on the board view

#### Scenario: Listed in help
- **WHEN** a user runs `rasen --help`
- **THEN** the `ui` command is listed with a description identifying it as the management platform entry point

#### Scenario: Invalid port rejected
- **WHEN** a user runs `rasen ui --port abc` or a port outside 0-65535
- **THEN** the command exits non-zero with a clear error and starts no server

### Requirement: Combined serving of management API, config API, and UI assets
The server started by `rasen ui` SHALL serve the management endpoints, the existing config API endpoints, and the UI package's static assets from a single origin under a single session token, so the board page and the config page can both operate against it. When the UI package is not installed, the server SHALL still expose all API endpoints and serve an install-hint page for non-API paths.

#### Scenario: One origin, one token
- **WHEN** the board page fetches management endpoints and the config page fetches config endpoints on a server started by `rasen ui`
- **THEN** both succeed against the same origin using the same bearer token

#### Scenario: UI package missing
- **WHEN** `rasen ui` is run without the UI package installed
- **THEN** the command prints the install hint, API endpoints remain fully usable, and non-API paths serve the install-hint page

### Requirement: Clean shutdown
The `rasen ui` server SHALL shut down promptly on SIGINT/SIGTERM, force-closing idle keep-alive connections so the CLI process exits without hanging.

#### Scenario: Ctrl-C exit
- **WHEN** the user interrupts a running `rasen ui` with browser tabs still holding keep-alive connections
- **THEN** the process exits within the shutdown guard window without hanging on open sockets
