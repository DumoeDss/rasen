## MODIFIED Requirements

### Requirement: Resident daemon owns session supervision across terminal exits
The CLI SHALL provide a `rasen daemon` command group. `rasen daemon run` SHALL run the resident daemon in the foreground: the full management server (management API, config API, UI assets, and the Sessions route group) listening on a fixed default port (8791, overridable via `RASEN_DAEMON_PORT` or `--port`, and never 8890), owning both compatible one-shot supervision and all live hosted stream transports so Sessions continue across launching-terminal and driver exits. `rasen daemon start` SHALL spawn that same daemon as a detached background process — using the running CLI's own installation entry, never PATH — redirect its output to a log file, wait a bounded time for matching identity, reconcile the durable hosted Session registry before reporting readiness, and exit successfully only once those steps complete (killing the half-started child and reporting the log path on failure). Sessions launched through the daemon SHALL keep running when the terminal that started the daemon or any consumer exits.

#### Scenario: Sessions survive the launching terminal
- **WHEN** a Session is launched through a daemon started with `rasen daemon start` and the terminal that ran the start command exits
- **THEN** the daemon and Session keep running, and a later consumer sees the Session live in the Sessions listing

#### Scenario: Replacement driver uses the resident transport
- **WHEN** one CLI driver exits after a hosted Session becomes idle and a later CLI driver wakes the same Rasen Session id
- **THEN** the later driver routes through the existing daemon-owned transport rather than starting a duplicate backend Session

#### Scenario: Start returns only on verified readiness
- **WHEN** a user runs `rasen daemon start`
- **THEN** the command exits zero only after the daemon answers on its port with Rasen identity headers and durable hosted lifecycle reconciliation has completed, and on a bounded-wait failure it exits non-zero, terminates the half-started child, and prints the daemon log path

#### Scenario: Foreground form for debugging
- **WHEN** a user runs `rasen daemon run` in a terminal
- **THEN** the daemon serves in the foreground with logs on the terminal, owns hosted transports, and shuts down cleanly on interrupt

### Requirement: Daemon shutdown reaps its sessions; force-kill limitation is honest
On clean shutdown (`rasen daemon stop`, or interrupt/termination of `rasen daemon run`), the daemon SHALL record shutdown/cancel intent for every hosted generation, terminate live one-shot trees through their legacy supervisor path and hosted scopes through opaque ProcessScope authority with termination reason `server-shutdown`, await observed close, release exact writer ownership, publish the resulting recoverable/interrupted/terminal lifecycle, and then remove its daemon state file. A force-killed daemon may leave an unfinished request; native controller death SHALL close a hosted scope, while any unobserved authority SHALL remain visible in durable lifecycle facts. The next daemon SHALL terminate only a positively-identified surviving scope and SHALL never replay an ambiguous turn, while agent-written run-state files remain independently readable.

#### Scenario: Stop reaps live sessions
- **WHEN** `rasen daemon stop` terminates a daemon with live one-shot and hosted Sessions
- **THEN** each exact process tree is terminated before daemon exit, hosted cleanup state is published, writer claims are released after close, and the daemon state file is removed

#### Scenario: Clean stop preserves recoverable identity
- **WHEN** an idle hosted Session with a backend Session id is stopped with the daemon
- **THEN** its live process is reaped while its stable Rasen id, backend Session id, cwd, and recoverable lifecycle remain available to a later daemon

#### Scenario: Forced daemon death is reported without replay
- **WHEN** a daemon is force-killed during an unfinished hosted turn
- **THEN** the next daemon reports the turn as ambiguous or failed from durable facts, cleans any positively-owned survivor, and does not automatically send the input again

## ADDED Requirements

### Requirement: Daemon startup reconciles durable hosted lifecycle before accepting control
On startup the daemon SHALL read and validate the durable hosted Session registry, reconcile every nonterminal generation against exclusive writer tokens and opaque ProcessScope observation, and complete reconciliation before accepting Session mutation. Idle records with exact backend identity SHALL become recoverable without eager prompt replay; terminal retired records SHALL remain terminal; unfinished records SHALL become interrupted/ambiguous or failed according to durable request/backend identity. Invalid registry state SHALL fail hosted mutation clearly rather than being discarded.

#### Scenario: Idle record becomes lazily recoverable
- **WHEN** startup reads an idle Session with a valid backend Session id and no live old owner
- **THEN** it preserves the Session for exact resume on the next wake/restart and sends no prompt during startup

#### Scenario: Retired record remains terminal
- **WHEN** startup reads a retired Session
- **THEN** it remains inspectable and retired, and startup opens no process for it

#### Scenario: Foreign or uncertain scope is not reconstructed from PID
- **WHEN** ProcessScope reports a durable runtime ref as foreign or uncertain, including after PID reuse
- **THEN** the daemon does not signal or adopt a numeric process and reports the ownership uncertainty while retaining authority

#### Scenario: Registry failure does not produce false readiness
- **WHEN** the hosted registry cannot be validated or safely reconciled
- **THEN** the daemon reports the hosted lifecycle fault and refuses hosted mutation instead of claiming an empty, healthy Session set
