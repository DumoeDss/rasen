# OmniCross real compatibility smoke (opt-in, non-CI)

Run this only against a released OmniCross daemon implementing Rasen's versioned Route Lease contract. It intentionally uses real Claude Code/Codex binaries but local mock upstreams, so Provider charges are not required. Paid-provider validation remains a manual operator decision.

Prerequisites:

1. Start OmniCross on an HTTP loopback origin and configure two local mock upstreams: one Anthropic Messages target and one OpenAI Responses target. Each mock should record model, headers, request body, and tool-call round trips without recording route tokens.
2. Export the OmniCross Admin token through the environment variable named by `omnicross.controlTokenEnv`.
3. Point Rasen at the daemon with the four `omnicross.*` settings.
4. Record SHA-256, size, and mtime for Codex `config.toml`/`auth.json` and Claude settings/credential files. Do not print their contents.

Procedure:

1. Create a temporary Pipeline with one routed Claude stage and one routed Codex stage, each with an explicit model and distinct upstream.
2. Run `rasen pipeline show <name> --for-execution --json`; confirm both stages show `exec-bridge` and credential-free inference only.
3. Dispatch each stage fresh, then exact-resume its returned session/thread using a new `rasen.inference/1` attempt file. Confirm OmniCross issued a different route token while runtime/upstream/model stayed fixed.
4. Ask each local mock to return one tool call and then a final structured result. Confirm both CLIs complete the tool round trip through the expected format transformer.
5. Run two stages concurrently with different upstreams/models. Release one and confirm the other remains active.
6. Stop or invalidate one lease during a held child process. Confirm Rasen kills the process tree and returns a route-lost receipt without a login fallback.
7. Recompute the four user-file hashes/sizes/mtimes and require exact equality. Scan receipts and temporary ephemera for the Admin token, route tokens, `launch`, and Provider credentials; require no matches. Confirm no persistent downstream key or binding was created.

Record the exact OmniCross release/API version with the smoke result. The minimum version is intentionally **unassigned** until OmniCross publishes the matching endpoints; do not claim compatibility from the in-process fake alone.
