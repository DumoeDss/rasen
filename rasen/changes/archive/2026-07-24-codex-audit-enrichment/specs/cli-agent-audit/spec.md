## ADDED Requirements

### Requirement: Codex cache-rebuild visibility with honest attribution
For a Codex session, the report SHALL surface cache-rebuild events — requests whose cached-input reading collapsed instead of continuing warm from the previous request — as a distinct, itemized part of the output. Each event SHALL carry a cause backed by evidence the Codex data actually provides: a context-shrinking event (the runtime's own compaction or rollback record, or an observed context collapse), an injected user message between requests, an idle-gap cause (presented as a TTL approximation, since the Codex runtime publishes no cache TTL), or "unattributed" when no evidence supports a cause. Causes with direct event evidence SHALL take precedence over the idle-gap approximation. The report SHALL NOT claim a conversation-branch (message-chain fork) cause — the one attribution the Codex data cannot evidence; that remains exclusive to the Claude path and is disclosed as unsupported.

#### Scenario: Rebuild events are itemized with evidenced causes
- **WHEN** a Codex session's report is generated and at least one request's cached-input reading collapsed relative to the previous request's cached prefix
- **THEN** each such event SHALL appear in the report with its timestamp, idle gap, cause, and the cache-write cost of the rebuild
- **AND** the report SHALL include rebuild totals broken down by cause

#### Scenario: Compaction and rollback are attributed from the runtime's own events
- **WHEN** the rollout records a compaction or rollback event between two requests and the later request's cached-input reading collapsed
- **THEN** that rebuild SHALL be attributed to the context-shrinking cause, not to the idle-gap approximation and not left unattributed

#### Scenario: Injected user message is attributed
- **WHEN** the rollout records a user message arriving between two requests and the later request's cached-input reading collapsed
- **THEN** that rebuild SHALL be attributed to injection, and the report/viewer copy SHALL present it as injection (not as a message-chain fork, which Codex data cannot evidence)

#### Scenario: Idle-gap cause is presented as an approximation
- **WHEN** a rebuild event is attributed to an idle gap
- **THEN** the report and viewer SHALL present that cause as an approximation derived from request spacing, not as a confirmed cache-TTL expiry

### Requirement: Codex per-request timeline
For a Codex session, the report SHALL include a per-request timeline — each derived request's timestamp, owning turn/agent, input, cached-input, cache-write, output, and reasoning-output token deltas, and its warm/rebuild classification — rather than only turn-level aggregates. The report SHALL also cluster each agent's requests into activity bursts separated by idle gaps, each burst labeled by how it resumed (initial spawn, warm continuation, or cache rebuild), matching the burst visibility a Claude report provides.

#### Scenario: Per-request rows are present
- **WHEN** a Codex session's report is generated
- **THEN** the report SHALL contain one row per derived request with its timestamp, agent, token deltas, and classification, ordered by time across all threads in the family

#### Scenario: Bursts per agent
- **WHEN** a Codex agent's requests contain an idle gap long enough to split activity clusters
- **THEN** that agent's report entry SHALL list the resulting bursts, each with its span, request count, and how it resumed

### Requirement: Codex per-request accounting prefers the runtime's own increments
When a Codex rollout carries the runtime's own per-request usage increments alongside the cumulative counters, the report SHALL derive each request's token figures from those increments — the runtime's own statement of what the request cost — falling back to cumulative-counter differencing only for events that predate the increments (older CLI versions). The report SHALL cross-check the summed increments against the cumulative endpoint totals and disclose any disagreement beyond a small tolerance as a caveat naming the affected fields, rather than silently trusting either source. Absence of the increments on any event SHALL be tolerated without a caveat and without being treated as format drift.

#### Scenario: Increments drive per-request figures
- **WHEN** a rollout's usage events carry per-request increments
- **THEN** each derived request's token figures SHALL come from those increments rather than from cumulative differencing

#### Scenario: Older events without increments still contribute
- **WHEN** some events in a rollout lack per-request increments (recorded by an older CLI version)
- **THEN** those requests SHALL be derived from cumulative-counter differencing, the report SHALL still be produced, and no error or caveat SHALL result from the absence alone

#### Scenario: Disagreement is disclosed
- **WHEN** the summed per-request increments disagree with the cumulative endpoint totals beyond tolerance
- **THEN** the report SHALL include a caveat naming which token fields disagree and by how much

### Requirement: Codex aborted turns are accounted
When a Codex rollout records that a turn was aborted rather than completed, the report SHALL treat the abort as that turn's end boundary: the turn appears in the report marked as aborted, with the requests recorded up to the abort attributed to it rather than left dangling.

#### Scenario: Aborted turn is closed and marked
- **WHEN** a rollout contains a turn that started and was then aborted
- **THEN** the report SHALL include that turn with its end set at the abort, marked as aborted, and its requests attributed to it

### Requirement: Codex context-window occupancy
When a Codex rollout reports the model's context-window size, the report SHALL show how full each agent's context ran — at minimum the peak context size relative to the window. When the rollout does not report a window size, the occupancy dimension SHALL be explicitly shown as unavailable rather than omitted or guessed.

#### Scenario: Occupancy shown when the window is known
- **WHEN** a Codex rollout carries the model context-window size
- **THEN** the report SHALL include each agent's peak context and its occupancy relative to that window

#### Scenario: Missing window size is labeled, not guessed
- **WHEN** a Codex rollout does not carry a context-window size
- **THEN** the report SHALL state that occupancy is unavailable for that reason, and SHALL NOT invent a window size
- **AND** the absence SHALL NOT be treated as transcript format drift

### Requirement: Unsupported Codex dimensions are disclosed
A Codex report SHALL explicitly enumerate the analysis dimensions the Codex rollout data cannot support (at minimum: conversation-branch/message-chain fork attribution, and billed-input-equivalent pricing), each with a short reason, so the difference from a Claude report reads as a documented data limitation rather than a gap. The viewer SHALL present this disclosure visibly when rendering a Codex report.

#### Scenario: Disclosure present in the JSON report
- **WHEN** a Codex session's report is generated
- **THEN** the report SHALL contain an explicit list of unsupported dimensions with reasons

#### Scenario: Disclosure visible in the viewer
- **WHEN** a Codex report is opened in the viewer
- **THEN** the viewer SHALL display the unsupported-dimensions disclosure alongside the rendered data, not hide it

## MODIFIED Requirements

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
- **AND** when the rollout also carries the runtime's own per-request increments, those SHALL drive the per-request figures per the "Codex per-request accounting prefers the runtime's own increments" requirement

#### Scenario: Codex report presents runtime-appropriate accounting
- **WHEN** a report is generated for a Codex session
- **THEN** the report SHALL present raw token totals (input, cached input, cache-write, output, reasoning output) per agent/turn rather than Claude's cache-write-TTL-based billed-equivalent figure, which does not apply to Codex's pricing model
- **AND** the report SHALL surface a cache-effectiveness signal (the ratio of cached to total input tokens) per agent and in total
- **AND** cache-rebuild visibility SHALL follow the "Codex cache-rebuild visibility with honest attribution" requirement — evidenced causes (context shrink, injection, idle-gap approximation) with everything else explicitly unattributed, and no message-chain-fork claims

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

#### Scenario: Viewer renders the enriched Codex dimensions
- **WHEN** a user opens a Codex report that carries the per-request timeline, rebuild events, bursts, occupancy, and aborted-turn data
- **THEN** the viewer SHALL render a multi-thread request timeline, an itemized rebuild-events view, per-agent bursts, occupancy, and aborted-turn marking, alongside the unsupported-dimensions disclosure

#### Scenario: Viewer tolerates older Codex reports
- **WHEN** a user opens a previously generated Codex report that predates the enriched fields
- **THEN** the viewer SHALL still render the totals and cache-effectiveness views without error, treating each enriched dimension as absent
