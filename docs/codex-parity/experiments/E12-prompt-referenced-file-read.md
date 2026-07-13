# E12 — Does a Codex worker actually READ a prompt-referenced file path?

**Codex CLI version:** 0.144.1

## Purpose

Round-1 solution 11 recommended passing rasen's per-change context (`rasen/changes/<name>/`) "by
prompt reference" (mention the path in the dispatch prompt, tell the worker to read it) rather
than relying on AGENTS.md auto-discovery, but this was never live-verified — round 1 only tested
AGENTS.md's own auto-injection (E09), not whether a worker genuinely opens a path it's merely told
about in its prompt. Round-2 gap: prove the worker actually reads the file (doesn't hallucinate
plausible-sounding content).

## Setup

Throwaway git repo mimicking rasen's real layout, with a distinguishable, unguessable token:
```
$SCRATCH/e12-fileread/rasen/changes/fake-change/proposal.md:
CONTEXT_TOKEN: FLAMINGO-42
```

## Command

```
cd $SCRATCH/e12-fileread
codex exec --json --skip-git-repo-check $CODEXW_ARGS \
  -o /tmp/e12-last.txt \
  "Read the file rasen/changes/fake-change/proposal.md and report exactly the CONTEXT_TOKEN value it contains." \
  < /dev/null
```

## Result

```
EXIT:0
FLAMINGO-42
```
JSONL confirms this was a **real file read, not a hallucination**:
```json
{"type":"item.started","item":{"id":"item_1","type":"command_execution",
  "command":"/bin/zsh -lc 'rg -n \"CONTEXT_TOKEN\" rasen/changes/fake-change/proposal.md'",
  "aggregated_output":"","exit_code":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution",
  "command":"/bin/zsh -lc 'rg -n \"CONTEXT_TOKEN\" rasen/changes/fake-change/proposal.md'",
  "aggregated_output":"1:CONTEXT_TOKEN: FLAMINGO-42\n","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"FLAMINGO-42"}}
```
The worker chose `rg -n "CONTEXT_TOKEN" <path>` (a targeted grep, not even a full `cat`) to
retrieve the value — this is the model's own tool-use decision, further evidence it's genuinely
consulting the filesystem rather than pattern-matching the prompt text (the token `FLAMINGO-42`
never appeared anywhere in the prompt itself, only in the referenced file).

One transient blip during the same turn, unrelated to the file-read result (recorded honestly):
```json
{"type":"error","message":"Reconnecting... 1/5 (stream disconnected before completion: Transport error: network error: error decoding response body)"}
```
followed by a duplicate `item.completed agent_message "FLAMINGO-42"` — a mid-stream reconnect that
re-emitted the final item once already produced; the correct answer was unaffected, but a
production JSONL consumer should de-duplicate `item.completed` by `id` rather than assume each
appears exactly once.

## Verdict for item 11 (extends solution 11)

Confirmed live: a Codex worker dispatched with a bare path reference in its prompt (no AGENTS.md
involvement, no special context-injection mechanism) reliably opens and reads that file via a real
shell command, and correctly reports content that could not have been guessed. This directly
validates the "pass per-change context by prompt reference" recommendation from round-1 solution
11 — it is not just a plausible design, it is now live-verified behavior.

## Reproduction

Place a token in a file at a path different from the prompt text itself, reference only the path
in the prompt, dispatch `codex exec`, and confirm the token comes back correctly and a
`command_execution` item touching that path appears in the JSONL.
