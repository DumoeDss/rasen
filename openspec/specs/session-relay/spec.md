# session-relay Specification

## Purpose
Defines the session-relay protocol: after a session-level handoff document is written and the user authorizes relay, the workflow launches a successor Claude Code session seeded with a quote-safe bootstrap prompt pointing at the handoff document and the resume command. Relays happen only at stage boundaries (no worker in flight), carry a generation number bounded by a relay cap, and always degrade to a printed manual relay command when spawning fails or the user declines.

## Requirements
### Requirement: Authorized session relay
When a session-level handoff document has been written and the user authorizes relay, the workflow SHALL launch a successor Claude Code session in the change's working directory — a visible interactive terminal window seeded with a bootstrap prompt directing it to read the handoff document, run `openspec pipeline resume <change>` (with `--store <id>` when the change lives in a store), and continue from the documented next action. The predecessor SHALL remain available until the successor is launched, then end its turn telling the user the predecessor window can be closed.

#### Scenario: Relay launches a successor session
- **WHEN** the user authorizes relay after `handoff/lead-<n>.md` is written and run-state's `sessionHandoff` is updated
- **THEN** a new interactive Claude Code session SHALL open in the working directory with a bootstrap prompt naming the handoff document path and the resume command
- **AND** the predecessor SHALL spawn the successor only after the handoff document and run-state are on disk, and SHALL tell the user the predecessor can be closed

#### Scenario: User declines relay
- **WHEN** the user declines the relay offer
- **THEN** behavior SHALL match the pre-existing manual flow: the handoff document and `sessionHandoff` pointer remain on disk and the user is told how to resume in a fresh session manually

### Requirement: Quote-safe bootstrap prompt delivery
The bootstrap prompt SHALL reach the successor session intact — including non-ASCII text — by being delivered through a quote-safe channel: written to a file under the change's `handoff/` directory and read by the spawn command, or passed via an encoding that survives shell re-parsing (e.g. PowerShell `-EncodedCommand`). Spawn instructions SHALL NOT interpolate the prompt as a bare quoted string.

#### Scenario: Non-ASCII prompt arrives intact
- **WHEN** a relay spawns a successor with a bootstrap prompt containing non-ASCII characters
- **THEN** the successor SHALL receive the complete prompt text, not a truncation produced by nested shell quote parsing

#### Scenario: Cross-platform delivery
- **WHEN** the relay runs on Windows, macOS, or Linux
- **THEN** the workflow SHALL use a delivery form documented for that platform, with file-based delivery available as the platform-neutral fallback

### Requirement: Relay only at stage boundaries
Session relay SHALL occur only when no worker is in flight: every dispatched worker has returned `DONE` or `HANDOFF` and run-state is persisted. Subagents are never resumed across sessions; the successor re-creates workers through the existing cold-resume ladder (handoff document, then recorded worker transcript, then change-directory reconstruction).

#### Scenario: Probe fires while a worker is in flight
- **WHEN** the LEAD's context probe meets the session threshold while a worker has not yet returned
- **THEN** the relay SHALL wait for the worker's structured return and run-state persistence before offering or performing the handoff-plus-relay sequence

#### Scenario: Successor re-engages a role
- **WHEN** the successor session needs a worker for a stage the predecessor had staffed
- **THEN** it SHALL seed a fresh worker via the existing resume ladder rather than attempting to address the predecessor's worker

### Requirement: Relay generation cap
Each session handoff SHALL carry a generation number, and automatic relay SHALL stop at the resolved relay cap — the workflow escalates to the user with the relay history instead of spawning another successor, because repeated session relays signal work that should be decomposed.

#### Scenario: Generation below cap
- **WHEN** a relay is authorized and the current generation is below the resolved `maxRelays`
- **THEN** the successor SHALL be spawned and the new `sessionHandoff` record SHALL carry the incremented generation

#### Scenario: Generation reaches cap
- **WHEN** the generation reaches the resolved `maxRelays`
- **THEN** the workflow SHALL NOT auto-spawn and SHALL present the relay history to the user with decomposition as the recommended next step

### Requirement: Manual fallback always available
When a successor window cannot be launched (unsupported terminal, spawn failure), the workflow SHALL degrade to printing the exact manual relay command — the same bootstrap content the spawn would have used — so the user can start the successor themselves.

#### Scenario: Spawn fails
- **WHEN** the spawn attempt errors or the platform terminal form is unknown
- **THEN** the workflow SHALL print the working directory, the bootstrap prompt (or its file path), and the command to launch the successor manually
