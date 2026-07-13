# 8 — Structured worker returns (DONE/HANDOFF contract; evaluate gate `{satisfied, gaps}` JSON)

**Status: live-verified**

## Experiments

E10 (`--output-schema` forcing strict-schema JSON final output).

## Solution

`codex exec --output-schema <schema-file>` accepts a standard JSON Schema file and forces the
agent's final `agent_message` to be strict-schema-conformant JSON (no prose wrapper, no markdown
fence). Live-verified with a `{status: "DONE"|"HANDOFF", gaps: string[]}`-shaped schema
(`required`, `enum`, and `additionalProperties: false` all honored exactly): the final message was
`{"gaps":["missing tests","no docs"],"status":"HANDOFF"}`, nothing else. `-o <file>` (
`--output-last-message`) writes exactly that string to a file for the caller to read/parse.

**This is strictly better than Claude Code's current convention** (a DONE/HANDOFF marker
embedded in free prose, parsed by regex/pattern-matching) — define the contract schema once per
role family (e.g. one schema for leaf-worker DONE/HANDOFF, one for the evaluate-gate
`{satisfied: boolean, gaps: string[]}` shape) and pass `--output-schema` on every Codex
dispatch of that role; parsing becomes `json.loads(open(output_file).read())`, no prose-parsing
heuristics needed.

## Recommended contract schemas

```json
// leaf-worker DONE/HANDOFF
{"type":"object","required":["status"],"properties":{
  "status":{"type":"string","enum":["DONE","HANDOFF"]},
  "summary":{"type":"string"},
  "handoffReason":{"type":"string"}
}, "additionalProperties": false}

// evaluate gate
{"type":"object","required":["satisfied","gaps"],"properties":{
  "satisfied":{"type":"boolean"},
  "gaps":{"type":"array","items":{"type":"string"}}
}, "additionalProperties": false}
```

## Resume/identity handle

Same thread id as any dispatch (solution 03); `--output-schema` composes with `resume` calls too
(not separately re-tested, but no reason to expect otherwise — `--output-schema` is a
final-response-shaping constraint orthogonal to thread continuity).

## Failure modes

None observed in E10's single test. Untested this round: what happens if the model's natural
response genuinely cannot satisfy the schema (e.g. asked for `enum: ["DONE","HANDOFF"]` but the
actual state is ambiguous) — whether Codex retries internally, errors, or degrades gracefully is
an open round-2 question. Recommend the schema always include an escape-hatch field (e.g. a free
`summary` string) so the model has somewhere to put nuance without breaking strict-schema
compliance.
