# E10 — `--output-schema`: forcing structured DONE/HANDOFF-shaped JSON

**Codex CLI version:** 0.144.1

## Purpose

Item 8: reliable capture of a machine-readable DONE/HANDOFF contract, or an evaluate-gate
`{satisfied, gaps}`-shaped JSON, from a Codex worker's final message.

## Setup

```
schema.json:
{
  "type": "object",
  "properties": {
    "status": {"type": "string", "enum": ["DONE", "HANDOFF"]},
    "gaps": {"type": "array", "items": {"type": "string"}}
  },
  "required": ["status", "gaps"],
  "additionalProperties": false
}
```

## Command

```
codex exec --json --skip-git-repo-check $CODEXW_ARGS \
  --output-schema schema.json -o /tmp/e08s-last.txt \
  "You evaluated a piece of work and found 2 gaps: 'missing tests' and 'no docs'. Report status HANDOFF."
```

## Result

```
EXIT:0
{"gaps":["missing tests","no docs"],"status":"HANDOFF"}
```
JSONL: `{"type":"item.completed","item":{"id":"item_0","type":"agent_message",
"text":"{\"gaps\":[\"missing tests\",\"no docs\"],\"status\":\"HANDOFF\"}"}}` — the agent's final
message *is* the strict-schema JSON (no prose wrapper, no markdown fence), and `-o` writes exactly
that string to the output-last-message file. `additionalProperties: false` and `required` were
both honored — the response contains only the two declared keys, nothing extra.

## Verdict for item 8

`--output-schema <file>` (a standard JSON Schema file) is the reliable capture mechanism: define a
DONE/HANDOFF schema (or an evaluate-gate `{satisfied: bool, gaps: string[]}` schema) once, pass it
on every dispatch, and parse `-o`'s output file (or the JSONL's final `item.completed
agent_message` text) as strict JSON — no prompt-convention parsing/regex needed, unlike Claude
Code's current DONE/HANDOFF-marker-in-prose convention. **Recommended for any Codex-worker
integration**: always pass `--output-schema` with a rasen-defined contract schema, rather than
asking the model to emit a DONE/HANDOFF marker in free text.

## Reproduction

Any `codex exec --output-schema <schema-file>` call with a prompt asking for schema-conformant
data; inspect `-o`'s output file.
