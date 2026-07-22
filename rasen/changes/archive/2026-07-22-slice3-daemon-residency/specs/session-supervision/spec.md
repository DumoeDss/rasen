## MODIFIED Requirements

### Requirement: Foreground server shutdown reaps its sessions
Session reaping SHALL be bound to the process that owns the supervisor. The resident daemon owns supervision by default: its clean shutdown (stop command, interrupt, or termination signal) SHALL terminate all live supervised sessions via the tree-kill path with termination reason `server-shutdown` before exiting — while the exit of any consumer (such as `rasen ui` or its terminal) SHALL NOT reap the daemon's sessions. When supervision runs in a self-hosted foreground server (`rasen ui --no-daemon`), that process is the owner and SHALL reap its live sessions on clean exit exactly as the pre-residency behavior did. A force-killed owner can still orphan sessions; this SHALL remain documented rather than masked, with agent-written run-state files persisting for manual resume.

#### Scenario: Clean shutdown leaves no orphaned session processes
- **WHEN** the process owning the supervisor shuts down cleanly while sessions are running
- **THEN** each live session's process tree is terminated before the owner exits, with termination reason `server-shutdown`

#### Scenario: Consumer exit does not reap daemon sessions
- **WHEN** sessions run under the resident daemon and a consumer that adopted or spawned it exits
- **THEN** the sessions continue running and remain visible in the sessions listing
