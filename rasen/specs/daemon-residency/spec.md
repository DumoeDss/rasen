# daemon-residency Specification

## Purpose
Host session supervision in a resident daemon that survives terminal exits, discoverable and authenticated through a runtime state file, with identity-based adopt/replace-stale/never-touch-foreign classification, shutdown that reaps its own sessions, and first-class daemon CLI commands.
## Requirements
### Requirement: Resident daemon owns session supervision across terminal exits
The CLI SHALL provide a `rasen daemon` command group. `rasen daemon run` SHALL run the resident daemon in the foreground: the full management server (management API, config API, UI assets, and the sessions route group) listening on a fixed default port (8791, overridable via `RASEN_DAEMON_PORT` or `--port`, and never 8890), owning the session supervisor so that supervised sessions continue running after any launching terminal exits. `rasen daemon start` SHALL spawn that same daemon as a detached background process — using the running CLI's own installation entry, never PATH — redirect its output to a log file, wait a bounded time for the daemon to answer with matching identity, and exit successfully only once it does (killing the half-started child and reporting the log path on failure). Supervised sessions launched through the daemon SHALL keep running when the terminal that started the daemon or any consumer exits.

#### Scenario: Sessions survive the launching terminal
- **WHEN** a session is launched through a daemon started with `rasen daemon start` and the terminal that ran the start command exits
- **THEN** the daemon and the session keep running, and a later consumer sees the session live in the sessions listing

#### Scenario: Start returns only on verified readiness
- **WHEN** a user runs `rasen daemon start`
- **THEN** the command exits zero only after the daemon answers on its port with rasen identity headers, and on a bounded-wait failure it exits non-zero, terminates the half-started child, and prints the daemon log path

#### Scenario: Foreground form for debugging
- **WHEN** a user runs `rasen daemon run` in a terminal
- **THEN** the daemon serves in the foreground with logs on the terminal and shuts down cleanly on interrupt

### Requirement: Daemon runtime state file for discovery and authentication
Once listening, the daemon SHALL write a runtime state file under the per-user rasen home (`daemon/daemon.json`) containing its version, process id, port, session token, and start time, with owner-only permissions, and SHALL delete it on clean shutdown. Consumers SHALL use the state file only as a port hint and token source; liveness and identity SHALL always come from probing the port itself. The state file SHALL hold daemon runtime metadata only — never workspace, change, or pipeline state — and a stale state file (daemon died uncleanly) SHALL be harmless: probing its port finds no listener and the next spawn overwrites it.

#### Scenario: Consumer authenticates via the state file
- **WHEN** a consumer adopts a running same-version daemon
- **THEN** it reads the session token from the state file and reaches the daemon's API with it

#### Scenario: Stale state file self-heals
- **WHEN** the daemon was force-killed leaving a state file behind and a consumer runs adopt-or-spawn
- **THEN** the probe finds no listener, a fresh daemon is spawned, and the state file is overwritten with the new daemon's facts

### Requirement: Identity-based classification — adopt, replace stale, never touch foreign
A consumer needing the daemon SHALL classify what listens on the daemon port using the rasen identity headers present on every management-server response (no token required to classify): a same-version rasen daemon SHALL be adopted without spawning; a rasen daemon of a different version SHALL be terminated by its reported process id (tree termination) and replaced with a freshly spawned daemon; a listener that does not present rasen identity headers SHALL be treated as foreign — the consumer SHALL fail with a clear reason naming the port and the override, and SHALL NOT adopt it, send it any signal, or spawn over it. An adopted daemon SHALL never be killed by a consumer's exit. `rasen daemon status` SHALL report the classification (running rasen daemon with version/pid, foreign listener, or absent) without acting on it. `rasen daemon stop` SHALL terminate only a positively-identified rasen daemon (any version) and remove the state file once the process is gone; against a foreign listener it SHALL refuse with the same never-touch explanation.

#### Scenario: Same-version daemon adopted
- **WHEN** adopt-or-spawn probes the port and finds a rasen daemon reporting the consumer's own version
- **THEN** the consumer adopts it — no spawn, no kill — and proceeds against its API

#### Scenario: Stale daemon replaced
- **WHEN** the probe finds a rasen daemon reporting a different version
- **THEN** the consumer terminates that daemon's process tree via its reported pid, waits for the port to free, and spawns a fresh daemon of its own version

#### Scenario: Foreign listener never touched
- **WHEN** the probe finds a listener without rasen identity headers on the daemon port
- **THEN** the consumer reports failure with the port and override instructions, sends no signal to the listener, and spawns nothing on that port

#### Scenario: Stop refuses foreign listeners
- **WHEN** a user runs `rasen daemon stop` while a foreign process listens on the daemon port
- **THEN** the command refuses to send any signal and explains that only identified rasen daemons are ever terminated

### Requirement: Daemon shutdown reaps its sessions; force-kill limitation is honest
On clean shutdown (`rasen daemon stop`, or interrupt/termination of `rasen daemon run`), the daemon SHALL terminate all live supervised sessions through the supervisor's tree-kill path with termination reason `server-shutdown` before exiting, and then remove its state file. A force-killed daemon may orphan sessions and leave a stale state file; this limitation SHALL be documented rather than masked, and the stale file self-heals per the state-file requirement while agent-written run-state files remain readable for manual resume.

#### Scenario: Stop reaps live sessions
- **WHEN** `rasen daemon stop` terminates a daemon with live sessions
- **THEN** each session's process tree is terminated with termination reason `server-shutdown` before the daemon exits, and the state file is removed

### Requirement: Daemon commands are first-class CLI citizens
The `daemon` command group and every new flag SHALL be listed in `rasen --help`, registered in the shell-completions registry, and localized in both English and Japanese locale files, matching the project's double-seam convention for new command surface.

#### Scenario: Completions and locales cover the daemon group
- **WHEN** the completions registry and both locale files are inspected after this change
- **THEN** `daemon start`, `daemon stop`, `daemon status`, `daemon run`, and their flags are present in the registry and have entries in both `en` and `ja` locales

