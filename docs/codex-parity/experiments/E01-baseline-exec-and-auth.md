# E01 — Baseline `codex exec`, real flag surface, and an environment auth trap

**Codex CLI version:** 0.144.1 (`codex --version`)

## Purpose

Establish the real, version-verified flag surface of `codex exec` (the playbook's app-server
method names were unverified fiction; this experiment starts from ground truth), get one
successful non-interactive round trip, and locate the resulting session on disk.

## Commands

```
codex --help
codex exec --help
```

Baseline call (throwaway git repo at `$SCRATCH/e01`):

```
codex exec --json -m gpt-5-mini -c model_reasoning_effort=low --skip-git-repo-check \
  -o /tmp/last-msg-e01.txt "Reply with exactly the single word: PONG. ..." < /dev/null
```

## Real flag surface (`codex exec --help`, trimmed to load-bearing flags)

```
-c, --config <key=value>       dotted-path TOML override, e.g. -c model="o3"
-m, --model <MODEL>
-p, --profile <CONFIG_PROFILE_V2>   layer $CODEX_HOME/<name>.config.toml
-s, --sandbox <read-only|workspace-write|danger-full-access>
--dangerously-bypass-approvals-and-sandbox
-C, --cd <DIR>                 working root
--add-dir <DIR>                 extra writable dirs
--skip-git-repo-check
--ephemeral                     don't persist session files to disk
--ignore-user-config             don't load $CODEX_HOME/config.toml (auth still uses CODEX_HOME)
--output-schema <FILE>          JSON Schema for the final response
--json                          print events to stdout as JSONL
-o, --output-last-message <FILE>
codex exec resume [SESSION_ID|--last] [PROMPT]   (subcommand, see E02)
codex exec review ...
```

Note: `codex exec` has **no** `-a/--ask-for-approval` flag (unlike the top-level `codex` and
`codex resume`) — passing it errors `unexpected argument '-a' found`. `exec` mode approval
behavior is implicit/non-interactive; failures return to the model rather than blocking on a
human.

## Finding 1 (hygiene bug in my own test): a positional PROMPT + inherited stdin hangs forever

First attempt ran the command with `| tee` in a way that left stdin attached to the parent shell.
Output showed:
```
Reading additional input from stdin...
```
and the process hung (never reached `turn.started`). Per `codex exec --help`: *"If stdin is piped
and a prompt is also provided, stdin is appended as a `<stdin>` block."* When stdin is not closed
(no `< /dev/null` and no explicit EOF), `codex exec` blocks waiting for EOF even though a prompt
arg was already supplied. **Reproduction / avoidance:** always pipe `< /dev/null` (or an explicit
heredoc) into `codex exec` invocations from a script/automation context, or it hangs.

## Finding 2 (environment-specific, high severity): this machine's `OPENAI_API_KEY`/`OPENAI_BASE_URL` are NOT honored by the default `openai` model_provider

This machine has global env vars:
```
OPENAI_BASE_URL=https://code.newcli.com/codex/v1
OPENAI_API_KEY=sk-ant-oat01-...   (an Anthropic-OAuth-shaped token, used as a bearer token
                                    for a third-party OpenAI-compatible reverse proxy)
```
and `~/.codex/auth.json` is `{"auth_mode":"apikey","OPENAI_API_KEY":"sk-ant-oat01-..."}` (the
same key persisted). `codex doctor` reports `"auth is configured"`, `"model provider": "openai"`.

Running `codex exec` with **only** `-m`/`-c` overrides (no explicit `model_provider`) always
failed:
```
2026-07-12T06:27:22Z ERROR ... failed to connect to websocket: HTTP error: 401 Unauthorized,
  url: wss://api.openai.com/v1/responses
{"type":"error","message":"Reconnecting... 2/5 (unexpected status 401 Unauthorized: Incorrect
  API key provided: sk-ant-o...BeAA. ... url: wss://api.openai.com/v1/responses ...)"}
... (5 retries on wss, then falls back to HTTPS, which ALSO hits api.openai.com directly)
{"type":"turn.failed","error":{"message":"unexpected status 401 Unauthorized: ... url:
  https://api.openai.com/v1/responses ..."}}
```
This happened **even with `OPENAI_BASE_URL` exported** in the parent shell — the built-in
`openai` model_provider's websocket transport (and its HTTPS fallback) both hit
`api.openai.com` literally, ignoring the env var override. This is not a rasen bug; it is how
this codex install's built-in provider is wired.

**Fix (session-scoped, no file mutation):** define a custom `model_providers.<name>` via `-c`
flags and select it, forcing the base_url and env_key explicitly:
```
codex exec --json --skip-git-repo-check \
  -c 'model_providers.proxy.name="proxy"' \
  -c 'model_providers.proxy.base_url="https://code.newcli.com/codex/v1"' \
  -c 'model_providers.proxy.wire_api="responses"' \
  -c 'model_providers.proxy.env_key="OPENAI_API_KEY"' \
  -c 'model_provider="proxy"' \
  -o /tmp/last-msg-e01.txt "Reply with exactly the single word: PONG. ..." < /dev/null
```
Result: `EXIT:0`, `/tmp/last-msg-e01.txt` = `PONG`, JSONL:
```
{"type":"thread.started","thread_id":"019f5504-86db-7cf1-9b59-5cdcf0f70672"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"PONG"}}
{"type":"turn.completed","usage":{"input_tokens":8053,"cached_input_tokens":7680,"output_tokens":6,"reasoning_output_tokens":0}}
```
All subsequent experiments in this dossier use this `-c model_providers.proxy.*` override
(`$CODEXW_ARGS` shell array). **This is purely an environment quirk of this dev machine's
API-key routing setup — it is not part of the rasen↔Codex parity design surface** and would not
apply to a normal ChatGPT-auth or standard-OpenAI-key codex install. It's recorded here because
any automation wrapping `codex exec` on a machine with a similar custom-proxy auth setup will hit
the identical 401 unless it (a) knows to override `model_providers`, or (b) the user fixes
`~/.codex/config.toml` once with a `[model_providers.x]` block + `model_provider = "x"`.

## Session file location

`codex exec --json` prints `thread_id` in the `thread.started` event. The corresponding rollout
JSONL is at:
```
~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<ISO-timestamp>-<thread_id>.jsonl
```
confirmed: `grep -rl "019f5504-86db-7cf1-9b59-5cdcf0f70672" ~/.codex/sessions` →
`~/.codex/sessions/2026/07/12/rollout-2026-07-12T14-29-47-019f5504-86db-7cf1-9b59-5cdcf0f70672.jsonl`.

## Plain (non-`--json`) output also exposes the session id

```
codex exec --skip-git-repo-check <CODEXW_ARGS> "Reply with exactly: PLAIN_OK" < /dev/null
```
prints a human header block before the transcript:
```
OpenAI Codex v0.144.1
--------
workdir: .../e01
model: gpt-5.6-sol
provider: proxy
approval: never
sandbox: read-only
reasoning effort: low
reasoning summaries: none
session id: 019f550d-a8fd-7a21-8782-cf82bce061fd
--------
user
Reply with exactly: PLAIN_OK
codex
PLAIN_OK
tokens used
2,059
```
So the session id is recoverable from either `--json`'s `thread.started` event or plain output's
`session id:` header line — either mode is a valid identity-capture strategy.

## Reproduction

Run any of the commands above from a throwaway git-initialized directory with
`CODEXW_ARGS=(-c 'model_providers.proxy.name="proxy"' -c 'model_providers.proxy.base_url="https://code.newcli.com/codex/v1"' -c 'model_providers.proxy.wire_api="responses"' -c 'model_providers.proxy.env_key="OPENAI_API_KEY"' -c 'model_provider="proxy"')`
prepended, and `< /dev/null` on stdin.
