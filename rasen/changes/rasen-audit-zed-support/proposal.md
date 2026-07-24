## Why

`rasen agent audit` can audit Claude Code and Codex CLI sessions, but it has no supported path for sessions run through Zed's agent panel — a growing IDE-native workflow. The only Zed audit today is an experimental, unshipped local script (`local_docs/audit/`) that reads Zed's `threads.db`, was generated against an older audit version, and impersonates a Codex report (`runtime: "codex"`) purely to reuse the viewer, which misrepresents most Codex-specific fields as observed zeros. Users who work in Zed cannot answer "what did this session cost" with a first-class, current-version tool.

## What Changes

- Add a first-class **Zed runtime** to `rasen agent audit`, selectable with `--runtime zed`, that reads a Zed thread and its descendant threads from Zed's local `threads.db` and produces a report — entirely on the user's machine, no upload, same pull-model contract as the Claude/Codex paths.
- Identify a Zed session **two ways**: by thread id (`session_id`, a prefix is sufficient) **or** by the user's first command (matching the stored first user message). An ambiguous first-command match lists the candidates and never guesses.
- Emit a first-class `runtime: "zed"` report (not the Codex-impersonation) that **honestly labels Zed's data limits**: Zed exposes uncached input, cache-read input, and output totals, but not reasoning-output or cache-write totals; request counts are retained-entry counts that can undercount after compaction; each thread is represented by one aggregate pseudo-turn; descendant Zed threads are included, but Claude/Codex processes launched as external tools are not linked in `threads.db` and are excluded.
- Surface the **additional useful signals** Zed's database and decoded payload provide (working directory, model, thread title/summary, first user message) where they aid identification and interpretation, after confirming which columns and payload fields are reliably present.
- Extend the shipped viewer to render a `runtime: "zed"` report using Zed-appropriate fields, rather than assuming Claude/Codex-specific fields are present.
- Upgrade the `rasen-audit` skill so it guides a user to identify a Zed session (by id or first command), route to `--runtime zed`, and interpret the report in Zed's own honest terms.
- Add pure-JS dependencies to read SQLite and decompress zstd locally, so no external CLI tools are required and behavior stays cross-platform (macOS, Linux, Windows).

## Capabilities

### New Capabilities
<!-- Zed support extends the existing audit contract; no new capability spec is introduced. -->

### Modified Capabilities
- `cli-agent-audit`: adds the Zed runtime — runtime selection now accepts `--runtime zed`; a Zed session is resolvable by thread id or by first-command match; the report is a first-class `runtime: "zed"` shape with explicitly disclosed Zed data limits and the extra Zed signals; the viewer renders the Zed runtime.
- `workflow-audit-command`: the `rasen-audit` skill now covers Zed — helping a user identify a Zed session by id or first command, routing to `--runtime zed`, and interpreting the Zed report in its own vocabulary and limits.

## Impact

- **Code**: `src/core/token-audit/` (new Zed database-read + payload-parse + family-discovery + report-build modules; `audit.ts` runtime dispatch; `types.ts` gains `ZedAuditResult` and `runtime: "zed"`), `src/core/agent-context.ts` (`TranscriptKind`/detection), `src/commands/agent.ts` (runtime validation, summary line), `src/cli/index.ts` (`--runtime` help text), `viewer/audit.html` (Zed render branch), `src/core/templates/workflows/audit.ts` (skill body — regenerates `rasen-audit` SKILL.md).
- **Dependencies**: add a pure-JS zstd decoder and a pure-JS/WASM SQLite reader → `package.json`, `pnpm-lock.yaml`, and a Nix hash regeneration (`bash scripts/update-flake.sh`, CI-validated). Native (node-gyp) SQLite is avoided to keep install friction low.
- **Tests**: new `test/core/token-audit/zed/` coverage (DB read, payload parse, family discovery, dual identification, report shape, data-limit caveats), viewer rendering, workflow template parity, locale catalog parity (any new user-facing strings), and refreshed help/parity golden hashes.
- **Docs**: `docs/` audit references updated to mention the Zed runtime and its limits; retire or supersede the stale `local_docs/audit/` reference material once the capability ships.
- **Platform**: Zed's `threads.db` location is OS-specific; the default path SHALL be resolved cross-platform and overridable, consistent with the CLI's existing path conventions.
