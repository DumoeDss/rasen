## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Cross-platform successor launch permissions
The successor launch SHALL bypass permission prompts on every supported platform and for a Codex-hosted relay LEAD, so an authorized unattended relay is never blocked by an approval prompt regardless of host. For a Claude Code successor the launch SHALL use `claude --dangerously-skip-permissions` on Windows, macOS, and Linux (the flag placed before shell quoting/encoding so the delivered command is `claude --dangerously-skip-permissions "$(<bootstrap prompt>)"`). For a future Codex-hosted relay LEAD, the interactive resume/fork relay primitives SHALL carry the verified full-access flag `--dangerously-bypass-approvals-and-sandbox` (accepted by `codex resume` and `codex fork`), documented as the Codex analogue of `--dangerously-skip-permissions`.

#### Scenario: Each platform launch bypasses permission prompts
- **WHEN** a relay spawns a Claude Code successor on Windows, macOS, or Linux
- **THEN** the platform launch command SHALL invoke `claude --dangerously-skip-permissions`, with the flag applied before any base64 (`-EncodedCommand`) or shell-quote wrapping so the successor actually receives it

#### Scenario: Codex-hosted relay guidance
- **WHEN** the workflow documents the relay primitives for a future Codex-hosted LEAD
- **THEN** it SHALL record that `codex resume`/`codex fork` carry `--dangerously-bypass-approvals-and-sandbox` for the same unattended full-permissions outcome, as the documented Codex equivalent of the Claude flag
