## ADDED Requirements

### Requirement: Local session audit command
The CLI SHALL provide `rasen agent audit <sessionId|path>` that analyzes a Claude Code session's token spend — the main transcript plus every subagent transcript it spawned — entirely on the user's own machine: no data leaves the machine, and the report is written to a file the user controls. The command SHALL accept either a session id (a prefix is sufficient, resolved the same way `agent context` resolves transcripts) or a direct path to a transcript file, and SHALL accept a `--projects-dir <dir>` override for the Claude projects directory the session id is resolved against. (This requirement describes the Claude-transcript path; the Codex-rollout counterpart, selected via `--runtime codex`, is covered by the "Codex rollout support" requirement below, and shares the pull-model/local-only contract stated here.)

The report SHALL deduplicate usage by each request's underlying message id (a transcript records one line per content block and repeats the full usage total on each, so counting lines overstates spend), and SHALL price cache-write tokens using the tier appropriate to each transcript (the main session's writes at the longer TTL rate; a subagent's writes at the shorter TTL rate) so the reported total reflects what was actually billed rather than a single blended estimate.

#### Scenario: Analyze a session by id prefix
- **WHEN** a user runs `rasen agent audit c4a16986` from within the project the session belongs to
- **THEN** the CLI SHALL locate the matching main transcript and its subagent transcripts automatically
- **AND** SHALL write a report file summarizing total requests, output tokens, cache read/write tokens, and a billed-input-equivalent total, broken down per agent in activation order

#### Scenario: Analyze a session from an explicit transcript path
- **WHEN** a user runs `rasen agent audit <path/to/transcript.jsonl>`
- **THEN** the CLI SHALL analyze that transcript (and its subagent transcripts, if any are discoverable alongside it) without requiring a session id lookup

#### Scenario: Ambiguous session id prefix
- **WHEN** a user runs `rasen agent audit <prefix>` and more than one transcript in the resolved projects directory starts with that prefix
- **THEN** the CLI SHALL exit non-zero with an error naming the ambiguous matches, and SHALL NOT guess

#### Scenario: Requests deduplicated by message id
- **WHEN** a transcript contains multiple lines carrying the same underlying request's usage totals (one per content block)
- **THEN** the report SHALL count that request exactly once toward every total

#### Scenario: Cache-write pricing tier by transcript role
- **WHEN** a report includes both the main session's transcript and at least one subagent transcript
- **THEN** the billed-input-equivalent total SHALL price the main session's cache-write tokens at its longer-TTL rate and each subagent's cache-write tokens at its shorter-TTL rate, and the report SHALL make each transcript's role (main vs. subagent) visible in its per-agent breakdown

### Requirement: Cache-churn visibility
The report SHALL surface cache-churn events — points where a request's cache read collapsed instead of continuing warm from the previous request — as a distinct, itemized part of the output, each tagged with a cause category (idle timeout, a conversation-branch/injection reset, a context-shrinking event such as compaction, or unattributed) so a user can see not just how much was spent but why re-work happened.

#### Scenario: Churn events are itemized with cause
- **WHEN** a session's report is generated and it contains one or more cache-churn events
- **THEN** each event SHALL appear in the report with its cause category and the token cost of the resulting cache rewrite
- **AND** the report SHALL include a total churn cost broken down by cause category

### Requirement: Experimental status is disclosed
Because the command parses Claude Code's internal, undocumented session-transcript format, the CLI SHALL disclose that this is experimental functionality that a future harness update can break, both in the command's own help text and in its documentation, so a user is never surprised by a failure mode this command is known to have.

#### Scenario: Help text discloses experimental status
- **WHEN** a user runs `rasen agent audit --help`
- **THEN** the help text SHALL state that the command parses an internal transcript format that may change with harness updates

### Requirement: Fail-soft on transcript format drift
When the analyzed transcript does not match the format the command expects — because the underlying harness changed its session log format — the command SHALL fail gracefully: it SHALL print a friendly, actionable message stating that the transcript format was not recognized and that a harness update may be the cause, and SHALL exit non-zero without an unhandled exception or stack trace. A single unparseable line (malformed JSON) SHALL be skipped rather than treated as a format-drift failure, matching how a single corrupt line has always been handled. On a Claude transcript, an assistant entry whose `message.usage` is entirely absent SHALL likewise be skipped, not treated as drift — the analyzer has always tolerated a usage-free assistant line as non-billing, and preserving that tolerance is part of this migration's "proven logic, not a rewrite" mandate.

#### Scenario: Recognized format drift produces a friendly error
- **WHEN** a transcript's assistant entries carry a usage object with a value the accounting relies on recorded in an unexpected shape (e.g. a token count recorded as text instead of a number)
- **THEN** the CLI SHALL exit non-zero with a message stating the transcript format was not recognized, naming the offending file, and suggesting a harness update as a likely cause
- **AND** SHALL NOT print a raw stack trace

#### Scenario: Format drift in JSON mode
- **WHEN** the same drift is hit while running with `--json`
- **THEN** the CLI SHALL emit a single JSON object indicating the report is unavailable and the reason, mirroring the shape used elsewhere in the `agent` command group for an unavailable result

#### Scenario: A stray malformed line does not abort the audit
- **WHEN** a transcript contains one line that fails to parse as JSON but the surrounding lines are well-formed
- **THEN** the CLI SHALL skip that line and continue producing a report from the rest of the transcript

#### Scenario: An assistant entry with no usage object does not abort the audit
- **WHEN** a Claude transcript contains an assistant entry whose `message.usage` is entirely absent, alongside other well-formed usage-bearing entries
- **THEN** the CLI SHALL treat that entry as contributing no billable request and continue producing a report from the rest of the transcript, without exiting non-zero or reporting format drift

### Requirement: Report output location
By default, the command SHALL write its report into the user's Rasen machine-data directory under an `analytics` subdirectory — a location the user owns, that survives no update, and that can be deleted at any time without affecting the tool. A `--out <path>` flag SHALL override the destination with an explicit file path.

#### Scenario: Default output location
- **WHEN** a user runs `rasen agent audit <session>` without `--out`
- **THEN** the report SHALL be written under the user's Rasen machine-data directory's `analytics` subdirectory, using a filename that includes the session id
- **AND** the resolved path SHALL be printed so the user knows where to find it

#### Scenario: Explicit output path
- **WHEN** a user runs `rasen agent audit <session> --out <path>`
- **THEN** the report SHALL be written to `<path>` instead of the default location

#### Scenario: Output location resolution is cross-platform
- **WHEN** the command resolves its default output directory on Windows, macOS, or Linux
- **THEN** the resolved path SHALL use the platform's native path separators and SHALL honor the same machine-home override the rest of the CLI's machine data respects

### Requirement: Codex rollout support
The command SHALL analyze Codex CLI session rollouts as well as Claude Code transcripts, selected the same way `agent context` selects a runtime: an explicit `--runtime codex` flag wins outright; otherwise a direct transcript path is detected from its filename or content. A bare session/thread id with no `--runtime` flag SHALL be resolved as a Claude session id (the existing default is unchanged) — resolving a bare id as a Codex thread SHALL require `--runtime codex`.

#### Scenario: Analyze a Codex session by thread id
- **WHEN** a user runs `rasen agent audit <threadId> --runtime codex`
- **THEN** the CLI SHALL locate that thread's rollout file and any rollouts belonging to subagent threads it spawned
- **AND** SHALL write a report summarizing token totals per agent/thread, using the same command and output conventions as a Claude session

#### Scenario: Analyze a Codex rollout from an explicit path
- **WHEN** a user runs `rasen agent audit <path/to/rollout-....jsonl>`
- **THEN** the CLI SHALL detect it as a Codex rollout from its filename or content without requiring `--runtime codex`

#### Scenario: Codex subagent discovery without a subagents directory
- **WHEN** a Codex session spawned one or more subagent threads (each persisted as its own separate rollout file elsewhere in the sessions store, not alongside the main rollout)
- **THEN** the report SHALL include those subagent threads' token usage, identified by their recorded agent name, without requiring the user to name each subagent rollout individually

#### Scenario: Codex per-turn accounting derived from cumulative counters
- **WHEN** a Codex rollout reports its token usage as a running cumulative total that updates multiple times per turn
- **THEN** the report SHALL attribute token spend to individual turns by the change in the cumulative total, not by summing every reported update (which would overcount)

#### Scenario: Codex report omits Claude-specific accounting
- **WHEN** a report is generated for a Codex session
- **THEN** the report SHALL present raw token totals (input, cached input, cache-write, output, reasoning output) per agent/turn rather than Claude's cache-write-TTL-based billed-equivalent figure, and SHALL NOT present a cache-churn cause classification (ttl-expiry/rebase/context-drop), since neither concept applies to Codex's cache/pricing model
- **AND** the report SHALL still surface a cache-effectiveness signal (the ratio of cached to total input tokens) so a Codex user retains visibility into cache usage despite the different model

#### Scenario: Bare id without runtime flag defaults to Claude
- **WHEN** a user runs `rasen agent audit <id>` without `--runtime`
- **THEN** the CLI SHALL resolve `<id>` as a Claude session id (existing behavior), not attempt Codex resolution

### Requirement: Viewer integration
The command SHALL ship an interactive, self-contained HTML viewer capable of rendering the generated report, and SHALL support a `--open` flag that opens that viewer pre-loaded with the report just generated, using the user's default browser.

#### Scenario: Opening the viewer after analysis
- **WHEN** a user runs `rasen agent audit <session> --open`
- **THEN** the CLI SHALL generate the report as normal
- **AND** SHALL open the shipped viewer in the user's default browser, loaded with that report
- **AND** SHALL print the report's file path regardless, so the user can open the viewer manually if the browser did not launch

#### Scenario: Viewer works without the CLI
- **WHEN** a user opens the shipped viewer directly (not via `--open`) and provides it a previously generated report file
- **THEN** the viewer SHALL render the same report without requiring a network connection

#### Scenario: Viewer renders both runtimes
- **WHEN** a user opens a Codex-session report in the viewer
- **THEN** the viewer SHALL render it using the Codex-appropriate fields (raw token totals and cache-effectiveness ratio) rather than assuming the Claude-specific billed-equivalent and churn-cause fields are present
