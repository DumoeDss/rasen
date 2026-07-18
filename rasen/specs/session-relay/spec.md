# session-relay Specification

## Purpose
Defines the session-relay protocol: after a session-level handoff document is written and the user authorizes relay, the workflow launches a successor Claude Code session seeded with a quote-safe bootstrap prompt pointing at the handoff document and the resume command. Relays happen only at stage boundaries (no worker in flight), carry a generation number bounded by a relay cap, and always degrade to a printed manual relay command when spawning fails or the user declines.

## Requirements
### Requirement: Authorized session relay
When a session-level handoff document has been written and the user authorizes relay, the workflow SHALL launch a successor Claude Code session in the change's working directory — a visible interactive terminal window seeded with a bootstrap prompt directing it to read the handoff document, run `rasen pipeline resume <change>` (with `--store <id>` when the change lives in a store), and continue from the documented next action. Because relay is authorized for unattended continuation, the successor SHALL be launched with full permissions (`claude --dangerously-skip-permissions`) so it does not stall on a permission prompt with no human present; the manual-fallback launch command SHALL carry the same flag so a user-launched successor is equivalent to a spawned one. The predecessor SHALL remain available until the successor is launched, then end its turn telling the user the predecessor window can be closed.

#### Scenario: Relay launches a successor session
- **WHEN** the user authorizes relay after `handoff/lead-<n>.md` is written and run-state's `sessionHandoff` is updated
- **THEN** a new interactive Claude Code session SHALL open in the working directory with a bootstrap prompt naming the handoff document path and the resume command
- **AND** the successor SHALL be launched with `claude --dangerously-skip-permissions` so the authorized unattended relay proceeds without a permission prompt blocking it
- **AND** the predecessor SHALL spawn the successor only after the handoff document and run-state are on disk, and SHALL tell the user the predecessor can be closed

#### Scenario: Manual fallback carries the same permissions
- **WHEN** the successor window cannot be spawned and the workflow prints the manual launch command instead
- **THEN** the printed command SHALL include `--dangerously-skip-permissions`, so a user who runs it obtains a successor with the same full permissions as a spawned one

#### Scenario: User declines relay
- **WHEN** the user declines the relay offer
- **THEN** behavior SHALL match the pre-existing manual flow: the handoff document and `sessionHandoff` pointer remain on disk and the user is told how to resume in a fresh session manually

### Requirement: Cross-platform successor launch permissions
The successor launch SHALL bypass permission prompts on every supported platform and for a Codex-hosted relay LEAD, so an authorized unattended relay is never blocked by an approval prompt regardless of host. For a Claude Code successor the launch SHALL use `claude --dangerously-skip-permissions` on Windows, macOS, and Linux (the flag placed before shell quoting/encoding so the delivered command is `claude --dangerously-skip-permissions "$(<bootstrap prompt>)"`). For a future Codex-hosted relay LEAD, the interactive resume/fork relay primitives SHALL carry the verified full-access flag `--dangerously-bypass-approvals-and-sandbox` (accepted by `codex resume` and `codex fork`), documented as the Codex analogue of `--dangerously-skip-permissions`.

The successor launch SHALL ALSO deliver the bootstrap prompt free of character-encoding corruption and produce a window that renders CJK output correctly, regardless of the machine's ANSI codepage or user profile. On Windows the launch command SHALL read the bootstrap prompt as UTF-8 (not the system ANSI codepage) and SHALL set the successor console to UTF-8 before starting the CLI — both applied inline in the launched command so they hold even when the shell is started without loading a user profile. This same UTF-8 console setup SHALL apply to a future Codex-hosted relay window on Windows, keeping the two host recipes consistent.

#### Scenario: Each platform launch bypasses permission prompts
- **WHEN** a relay spawns a Claude Code successor on Windows, macOS, or Linux
- **THEN** the platform launch command SHALL invoke `claude --dangerously-skip-permissions`, with the flag applied before any base64 (`-EncodedCommand`) or shell-quote wrapping so the successor actually receives it

#### Scenario: Codex-hosted relay guidance
- **WHEN** the workflow documents the relay primitives for a future Codex-hosted LEAD
- **THEN** it SHALL record that `codex resume`/`codex fork` carry `--dangerously-bypass-approvals-and-sandbox` for the same unattended full-permissions outcome, as the documented Codex equivalent of the Claude flag

#### Scenario: Windows successor receives CJK bootstrap prompt intact
- **WHEN** a relay spawns a Windows successor on a machine whose ANSI codepage is not UTF-8 (e.g. a Chinese-locale machine at codepage 936) and the bootstrap prompt contains CJK text
- **THEN** the launch command SHALL read the prompt as UTF-8 so the successor receives the intact CJK text rather than mojibake produced by decoding UTF-8 bytes as the ANSI codepage

#### Scenario: Windows successor console renders CJK output
- **WHEN** a Windows successor window is launched and the successor CLI emits CJK output
- **THEN** the launch command SHALL have set the successor console to UTF-8 inline (without depending on a user profile, since the shell is launched with the profile suppressed) so that CJK output renders correctly

#### Scenario: Encoding fix holds without a user profile
- **WHEN** the Windows relay shell is started with its user profile suppressed
- **THEN** the UTF-8 read encoding and console setup SHALL still take effect because they are carried inline in the launched command rather than relying on profile configuration

### Requirement: Quote-safe bootstrap prompt delivery
The bootstrap prompt SHALL reach the successor session intact — including non-ASCII text — by being delivered through a quote-safe channel: written to a file under the change's resolved `handoff/` directory (inside the work directory per the `change-work-dir` capability, or the change directory under its sticky-legacy fallback) and read by the spawn command, or passed via an encoding that survives shell re-parsing (e.g. PowerShell `-EncodedCommand`). Spawn instructions SHALL NOT interpolate the prompt as a bare quoted string.

#### Scenario: Non-ASCII prompt arrives intact
- **WHEN** a relay spawns a successor with a bootstrap prompt containing non-ASCII characters
- **THEN** the successor SHALL receive the complete prompt text, not a truncation produced by nested shell quote parsing

#### Scenario: Cross-platform delivery
- **WHEN** the relay runs on Windows, macOS, or Linux
- **THEN** the workflow SHALL use a delivery form documented for that platform, with file-based delivery available as the platform-neutral fallback

### Requirement: Relay only at stage boundaries
Session relay SHALL occur only when no worker is in flight: every dispatched worker has returned `DONE` or `HANDOFF` and run-state is persisted. Before the relay, any warm reuse candidate the LEAD is holding across the session boundary — a worker that returned `DONE` but was retained for cross-child reuse rather than dismissed — SHALL first write its knowledge digest document — which IS a handoff document: the same rasen-handoff template, written to `handoff/<role>-<n>.md` in the change's resolved handoff location (work directory per the `change-work-dir` capability, change directory under its fallback) with reason `retired-between-children`, so the successor's document-first resume ladder finds it — because its cross-change knowledge would otherwise be lost with its session-scoped agent handle. Subagents are never resumed across sessions; the successor re-creates workers through the existing cold-resume ladder (handoff document, then recorded worker transcript, then change-directory reconstruction).

#### Scenario: Probe fires while a worker is in flight
- **WHEN** the LEAD's context probe meets the session threshold while a worker has not yet returned
- **THEN** the relay SHALL wait for the worker's structured return and run-state persistence before offering or performing the handoff-plus-relay sequence

#### Scenario: Held warm reuse candidate writes its digest before relay
- **WHEN** the LEAD is holding a warm reuse candidate (a `DONE`-returned worker retained for a dependent child) and a session relay is about to occur
- **THEN** that candidate SHALL write its knowledge digest document before the successor session is launched, so its cross-change knowledge survives the boundary via the document rather than dying with its agent handle

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
