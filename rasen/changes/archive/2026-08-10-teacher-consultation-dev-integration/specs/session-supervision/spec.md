## MODIFIED Requirements

### Requirement: Foreground server shutdown reaps its sessions

Session reaping SHALL be bound to the process that owns each management session lane. The resident daemon owns supervision by default: its clean shutdown (stop command, interrupt, or termination signal) SHALL terminate all live reusable/supervised sessions, ordinary hosted Sessions, and exact-Teacher Sessions through their owning lifecycle paths with termination reason `server-shutdown` before exiting, and SHALL report failure if any present owner does not produce a successful bounded drain. The exit of any consumer (such as `rasen ui` or its terminal) SHALL NOT reap the daemon's sessions. When supervision runs in a self-hosted foreground server (`rasen ui --no-daemon`), that process is the owner and SHALL reap its live sessions on clean exit exactly as the pre-residency behavior did. A force-killed owner can still orphan sessions; this SHALL remain documented rather than masked, with durable session and agent-written run-state files persisting for recovery or manual resume.

#### Scenario: Clean shutdown leaves no orphaned session processes
- **WHEN** the process owning the supervisor shuts down cleanly while sessions are running
- **THEN** each live session's process tree is terminated before the owner exits, with termination reason `server-shutdown`

#### Scenario: Consumer exit does not reap daemon sessions
- **WHEN** sessions run under the resident daemon and a consumer that adopted or spawned it exits
- **THEN** the sessions continue running and remain visible in the sessions listing

#### Scenario: Clean shutdown drains every present management lane
- **WHEN** reusable sessions, ordinary hosted Sessions, and an exact-Teacher Session are all owned by one management server during clean shutdown
- **THEN** the server SHALL invoke and await each lane's owning bounded shutdown path before reporting a clean stop
- **AND** the reusable owner SHALL remain the sole owner of supervisor shutdown while ordinary and exact SessionHosts retain their distinct lifecycle authority

#### Scenario: One failed drain does not skip the other owners
- **WHEN** any reusable, ordinary hosted, exact-Teacher, or auxiliary shutdown path times out, rejects, or retains unresolved authority
- **THEN** every other present owner SHALL still be asked to drain and its outcome SHALL be observed
- **AND** the server SHALL report shutdown failure while preserving the durable state required to reconcile the unresolved lane
