# Claude resident protocol premise

Observed on the implementation host on 2026-08-04:

```text
$ claude --version
2.1.220 (Claude Code)

$ claude --help
--input-format <format>   Input format (only works with --print)
--output-format <format> Output format (only works with --print)
-p, --print              Print response and exit
-r, --resume [value]     Resume a conversation by session ID
```

The production adapter requires all four help tokens before spawn and returns
`backend-protocol-unsupported` if any is absent. Its resident argv is the named
constant `CLAUDE_SESSION_STREAM_ARGS`:

```text
-p --input-format stream-json --output-format stream-json --verbose
```

Recovery appends only `--resume <exact backend Session id>`. Prompt content is
not an argv/environment element; it is a structured user message on stdin.

Automated evidence:

- `test/core/session-host/claude-backend.test.ts` pins direct spawn options,
  missing-protocol rejection before spawn, exact resume, resident multi-turn,
  per-turn bounds, duplicate-terminal poisoning, and real no-network process
  execution.
- `test/fixtures/session-host/replay-claude.{mjs,cmd,sh}` implements the same
  version/help and stream-json surface for deterministic tests.
