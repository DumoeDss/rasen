# session-relay Specification (delta)

## MODIFIED Requirements

### Requirement: Quote-safe bootstrap prompt delivery

The bootstrap prompt SHALL reach the successor session intact — including non-ASCII text — by being delivered through a quote-safe channel: written to a file under the change's resolved `handoff/` directory (inside the work directory per the `change-work-dir` capability, or the change directory under its sticky-legacy fallback) and read by the spawn command, or passed via an encoding that survives shell re-parsing (e.g. PowerShell `-EncodedCommand`). Spawn instructions SHALL NOT interpolate the prompt as a bare quoted string.

#### Scenario: Non-ASCII prompt arrives intact

- **WHEN** a relay spawns a successor with a bootstrap prompt containing non-ASCII characters
- **THEN** the successor SHALL receive the complete prompt text, not a truncation produced by nested shell quote parsing

#### Scenario: Cross-platform delivery

- **WHEN** the relay runs on Windows, macOS, or Linux
- **THEN** the workflow SHALL use a delivery form documented for that platform, with file-based delivery available as the platform-neutral fallback

### Requirement: Relay only at stage boundaries

Session relay SHALL occur only when no worker is in flight: every dispatched worker has returned `DONE` or `HANDOFF` and run-state is persisted. Before the relay, any warm reuse candidate the LEAD is holding across the session boundary — a worker that returned `DONE` but was retained for cross-child reuse rather than dismissed — SHALL first write its knowledge digest document — which IS a handoff document: the same openspec-handoff template, written to `handoff/<role>-<n>.md` in the change's resolved handoff location (work directory per the `change-work-dir` capability, change directory under its fallback) with reason `retired-between-children`, so the successor's document-first resume ladder finds it — because its cross-change knowledge would otherwise be lost with its session-scoped agent handle. Subagents are never resumed across sessions; the successor re-creates workers through the existing cold-resume ladder (handoff document, then recorded worker transcript, then change-directory reconstruction).

#### Scenario: Probe fires while a worker is in flight

- **WHEN** the LEAD's context probe meets the session threshold while a worker has not yet returned
- **THEN** the relay SHALL wait for the worker's structured return and run-state persistence before offering or performing the handoff-plus-relay sequence

#### Scenario: Held warm reuse candidate writes its digest before relay

- **WHEN** the LEAD is holding a warm reuse candidate (a `DONE`-returned worker retained for a dependent child) and a session relay is about to occur
- **THEN** that candidate SHALL write its knowledge digest document before the successor session is launched, so its cross-change knowledge survives the boundary via the document rather than dying with its agent handle

#### Scenario: Successor re-engages a role

- **WHEN** the successor session needs a worker for a stage the predecessor had staffed
- **THEN** it SHALL seed a fresh worker via the existing resume ladder rather than attempting to address the predecessor's worker
