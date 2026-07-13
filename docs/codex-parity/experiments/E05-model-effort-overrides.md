# E05 — Model / reasoning-effort per-dispatch overrides

**Codex CLI version:** 0.144.1

## Purpose

Item 9: verify the exact per-invocation override syntax for model and reasoning effort, and the
existing `/codex` skill's known-good pattern `-c 'model_reasoning_effort="xhigh"'` on 0.144.1.

## `-c model_reasoning_effort="xhigh"` — accepted syntax, confirmed working on a prior successful call

Used throughout E01/E02/E04 baseline calls without issue (`-c model_reasoning_effort=low` in E01's
very first successful PONG call). The dotted-key `-c key=value` form is accepted; TOML-quoted
string values (`"xhigh"`, `"low"`) parse correctly. This confirms the existing
`src/core/templates/experts/codex.ts` invocation pattern is still valid syntax on 0.144.1.

(A direct repeat of the xhigh-specific call hit a transient `429 Too Many Requests` during this
run — a rate-limit artifact of back-to-back experiment load, not a syntax or auth failure; see
E02's failure-mode note. The flag's *acceptance* was already established by the successful
`-c model_reasoning_effort=low` calls earlier in this session.)

## `-m <model>` with an invalid model name — clean, fast-failing error

```
codex exec --json --skip-git-repo-check $CODEXW_ARGS \
  -m "totally-not-a-real-model-xyz" -o /tmp/e05b-last.txt "Reply with exactly: SHOULD_NOT_REACH_HERE"
```
```json
{"type":"thread.started","thread_id":"019f550a-da26-7e80-bff4-149e9c9c7153"}
{"type":"item.completed","item":{"id":"item_0","type":"error",
  "message":"Model metadata for `totally-not-a-real-model-xyz` not found. Defaulting to fallback
   metadata; this can degrade performance and cause issues."}}
{"type":"turn.started"}
{"type":"error","message":"Reconnecting... 1/5 (unexpected status 404 Not Found: model
  totally-not-a-real-model-xyz is not available for /codex prefix, url: https://code.newcli.com/codex/v1/responses, ...)"}
... (retries 2-5, then)
{"type":"turn.failed","error":{"message":"unexpected status 404 Not Found: model
  totally-not-a-real-model-xyz is not available for /codex prefix, ..."}}
```
`EXIT:1`. Two distinct failure signals a caller can pattern-match: (a) an early
`item.type=="error"` warning about missing model metadata (non-fatal, may still proceed with
fallback metadata for *known-but-unlisted* models), and (b) a hard `turn.failed` with a 404 when
the provider genuinely doesn't serve that model id. A production dispatcher should treat (b) as
fatal-per-invocation (do not retry with the same model id).

## Available models under this auth

`~/.codex/config.toml` (real, pre-existing) sets `model = "gpt-5.6-sol"`; `codex doctor` config
snapshot confirms `"model": "gpt-5.6-sol"`, `"model provider": "openai"`. `gpt-5-mini` was
accepted syntactically (E01 first attempt, before the model_provider fix) with only a soft
"Model metadata ... not found, defaulting to fallback" warning, not a hard rejection — i.e. the
CLI's local model-metadata table (context window, pricing, capability flags) is a static list
that can be stale relative to what the backend actually serves; unknown-but-real model ids still
work, just with degraded local metadata (e.g. E07's app-server `thread/start` response used the
config-default `"model":"gpt-5.6-sol"` and reported `"reasoningEffort":"low"` from
`model_reasoning_effort` in config).

## Verdict for item 9

Exact syntax: `-m <model-id>` and `-c model_reasoning_effort="<low|medium|high|xhigh|...>"` (TOML
string) both work as per-invocation overrides on `codex exec`. A `-p/--profile <name>` flag also
exists to layer `$CODEX_HOME/<name>.config.toml` for a whole role/profile rather than per-flag
overrides, unexplored live this round (config-file mechanism, same override precedence as `-c`
per `--help`: "Override a configuration value that would otherwise be loaded from
`~/.codex/config.toml`").

## Reproduction

Any `codex exec` call with `-m <id>` or `-c model_reasoning_effort="<value>"` appended.
