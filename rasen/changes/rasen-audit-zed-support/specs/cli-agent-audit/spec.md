## ADDED Requirements

### Requirement: Zed runtime support
The command SHALL analyze a Zed session's token spend as well as Claude Code transcripts and Codex rollouts, selected with an explicit `--runtime zed` flag. It SHALL read the session from Zed's local thread database and SHALL include the audited thread together with its descendant threads (the child threads Zed records as spawned from it), entirely on the user's own machine under the same pull-model, zero-upload, user-owned-output contract stated for the other runtimes. A bare id with no `--runtime` flag SHALL continue to resolve as a Claude session (the existing default is unchanged); resolving an id against Zed SHALL require `--runtime zed`.

#### Scenario: Analyze a Zed session by thread id
- **WHEN** a user runs `rasen agent audit <threadId> --runtime zed`
- **THEN** the CLI SHALL locate that thread and its descendant threads in Zed's thread database
- **AND** SHALL write a report summarizing token totals per thread, using the same output and `--out`/`--open` conventions as a Claude or Codex session

#### Scenario: Descendant Zed threads are included; external tools are not
- **WHEN** a Zed session recorded one or more descendant threads, and separately launched Claude or Codex processes as external tools
- **THEN** the report SHALL include each descendant Zed thread's usage, identified by its recorded thread title/summary
- **AND** SHALL NOT include the externally launched Claude/Codex processes, which Zed's thread database does not link to the audited thread

#### Scenario: Bare id without runtime flag still defaults to Claude
- **WHEN** a user runs `rasen agent audit <id>` without `--runtime`
- **THEN** the CLI SHALL resolve `<id>` as a Claude session id (existing behavior), not attempt Zed resolution

### Requirement: Zed session identification by id or first command
For a Zed session, the command SHALL let a user identify the session two ways: by its thread id (a prefix is sufficient) or by the user's first command — the text of the session's first user message. When more than one Zed thread matches the supplied first-command text, the command SHALL exit non-zero listing the candidate threads (their id, title, and start time) and SHALL NOT guess a single winner.

#### Scenario: Identify a Zed session by thread id prefix
- **WHEN** a user runs `rasen agent audit <threadId-prefix> --runtime zed` and exactly one thread in the database starts with that prefix
- **THEN** the CLI SHALL resolve and audit that thread

#### Scenario: Identify a Zed session by its first command
- **WHEN** a user runs `rasen agent audit --runtime zed` supplying the text of the session's first user command as the match target and exactly one thread's first user message matches
- **THEN** the CLI SHALL resolve and audit that thread

#### Scenario: Ambiguous first-command match is not guessed
- **WHEN** the supplied first-command text matches more than one Zed thread
- **THEN** the CLI SHALL exit non-zero with an error listing the matching threads' id, title, and start time
- **AND** SHALL NOT pick one automatically

### Requirement: Zed report presents Zed-appropriate accounting
For a Zed session, the report SHALL be a first-class Zed report — its runtime identifier is `zed`, not an impersonation of another runtime — presenting the token totals Zed actually stores: uncached input, cache-read (cached) input, and output, per thread and in total, plus a cache-effectiveness signal (the ratio of cached to total input tokens). Because Zed does not retain enough per-request detail to reconstruct a per-request or per-turn timeline, each thread SHALL be represented by a single aggregate entry. The report SHALL also surface, per thread and where the database provides it, the additional context Zed records: the thread title/summary, the working directory, the model, and the session's first user command.

#### Scenario: Report is a first-class Zed report
- **WHEN** a Zed session's report is generated
- **THEN** the report's runtime identifier SHALL be `zed`, not `codex` or `claude`

#### Scenario: Zed-stored token totals and cache-effectiveness are present
- **WHEN** a Zed session's report is generated
- **THEN** the report SHALL present uncached input, cached input, and output totals per thread and in total
- **AND** SHALL present a cache-effectiveness ratio (cached input over total input) per thread and in total

#### Scenario: Each thread is one aggregate entry
- **WHEN** a Zed session's report is generated
- **THEN** each thread SHALL appear as a single aggregate entry, and the report SHALL NOT fabricate a per-request timeline Zed cannot support

#### Scenario: Additional Zed context is surfaced when available
- **WHEN** a Zed thread's database record and decoded payload carry a title, working directory, model, or first user command
- **THEN** the report SHALL include those fields for that thread
- **AND** SHALL omit (not guess) any of them the data does not provide

### Requirement: Zed data limits are disclosed
Because Zed's thread database is an internal, undocumented format that stores only partial usage detail, a Zed report SHALL explicitly disclose its limits so the numbers are not misread: that Zed does not store reasoning-output or cache-write totals (any such field is a compatibility zero, not observed zero usage), that request counts are retained-entry counts that can undercount after a compaction, and that only Zed-linked descendant threads are included while externally launched Claude/Codex tools are not. The command SHALL disclose that Zed support is experimental — an internal format a Zed update can change — in its help text and documentation. When the database is absent, or a thread's stored payload is in a shape the command does not recognize, the command SHALL fail gracefully with an actionable message and a non-zero exit, without an unhandled stack trace, and SHALL NOT silently substitute guessed values.

#### Scenario: Limits are disclosed in the report
- **WHEN** a Zed session's report is generated
- **THEN** the report SHALL carry explicit caveats naming the partial and unavailable dimensions (reasoning-output/cache-write absence, retained-entry request counts, and descendant-only scope)

#### Scenario: Compatibility zeros are labeled, not read as observed zero usage
- **WHEN** a Zed report includes fields Zed does not store (reasoning-output or cache-write totals)
- **THEN** those fields SHALL be presented as compatibility zeros with an accompanying caveat, not as observed zero usage

#### Scenario: Unrecognized payload fails soft
- **WHEN** a targeted Zed thread's stored payload is in a shape the command does not recognize, or the thread database is absent
- **THEN** the CLI SHALL exit non-zero with an actionable message identifying the problem
- **AND** SHALL NOT print a raw stack trace or substitute guessed token values

#### Scenario: Experimental status in help text
- **WHEN** a user runs `rasen agent audit --help`
- **THEN** the help text SHALL state that Zed support parses an internal Zed thread format that may change with Zed updates

### Requirement: Zed database access is local and cross-platform
The command SHALL locate Zed's thread database at its per-operating-system default location and SHALL accept an explicit override path, resolving paths with the platform's native separators. Reading the database and decompressing its stored thread payloads SHALL happen locally and SHALL NOT require any external command-line tools to be installed on the user's machine.

#### Scenario: Default database location resolves per OS
- **WHEN** the command resolves Zed's thread database without an override on Windows, macOS, or Linux
- **THEN** it SHALL use that platform's native default location and path separators

#### Scenario: Override database path
- **WHEN** a user supplies an explicit path to a Zed thread database
- **THEN** the command SHALL read from that path instead of the default location

#### Scenario: No external tools required
- **WHEN** the command reads and decompresses a Zed thread on a machine with no `sqlite3` or `zstd` command-line tools installed
- **THEN** it SHALL still produce the report, using its own bundled read/decompress path

### Requirement: Zed report rendering in the viewer
The shipped viewer SHALL render a `runtime: "zed"` report using Zed-appropriate fields — its stored token totals, cache-effectiveness ratio, per-thread aggregate entries, and disclosed limits — rather than assuming the Claude- or Codex-specific fields are present. Opening a Zed report SHALL display its disclosed limits visibly alongside the data.

#### Scenario: Viewer renders a Zed report
- **WHEN** a user opens a `runtime: "zed"` report in the viewer
- **THEN** the viewer SHALL render its stored token totals, cache-effectiveness ratio, and per-thread aggregate entries without assuming Claude/Codex-only fields are present

#### Scenario: Viewer shows the Zed limits
- **WHEN** a Zed report is opened in the viewer
- **THEN** the viewer SHALL display the report's disclosed limits alongside the rendered data, not hide them
