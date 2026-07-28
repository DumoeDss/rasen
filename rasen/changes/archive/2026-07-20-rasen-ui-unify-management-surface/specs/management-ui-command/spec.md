## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Hidden experimental launch command starts the management server
**Reason**: `rasen ui` graduates from hidden/experimental to the public, sole management platform entry point; hiding it from help and guaranteeing `rasen config ui` stays untouched are both superseded (the config command becomes a deprecated alias of the same server, governed by the `config-ui-command` spec).
**Migration**: Users run the same `rasen ui` command — it is now visible in help and lands on the board at `/`. Scripts relying on the printed `/board#token=` URL shape keep working: `/board` remains a valid route for the board view.
