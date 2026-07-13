# 9 — Model / reasoning-effort per-dispatch overrides

**Status: live-verified**

## Experiments

E05 (model/effort override syntax, invalid-model error shape), E01 (first successful use of
`-c model_reasoning_effort=low`), E07 Step 3 (live `model/list` enumeration, round 2).

## Solution

Two flags, both usable per-invocation on `codex exec`:
- `-m <model-id>` — e.g. `-m gpt-5.6-sol`. An unrecognized-but-real model id produces a soft
  warning (`item.type=="error"`, "Model metadata ... not found, defaulting to fallback metadata")
  but may still work; a genuinely-unserved model id produces a hard `turn.failed` with
  `404 Not Found: model <id> is not available for /codex prefix` (E05) — exit code 1.
- `-c model_reasoning_effort="<value>"` — TOML-quoted string, e.g. `"low"`, `"xhigh"`. Confirmed
  working syntax on 0.144.1 (used successfully throughout this dossier's baseline calls),
  validating the existing `/codex` skill's known-good pattern
  (`src/core/templates/experts/codex.ts`).
- `-p/--profile <name>` also exists (layers `$CODEX_HOME/<name>.config.toml`) for a whole
  role/profile rather than per-call flags — not live-tested this round, but documented in
  `codex exec --help` with the same override precedence as `-c`.

## Which models are available under this auth (live-enumerated, round 2)

Called the app-server's `model/list` method live (E07 Step 3) — this auth serves **7 models**:

| id | display name | default effort | max effort | notes |
|---|---|---|---|---|
| `gpt-5.6-sol` | GPT-5.6-Sol | low | ultra | **default** (`isDefault:true`, matches `config.toml`'s `model = "gpt-5.6-sol"`); "Latest frontier agentic coding model" |
| `gpt-5.6-terra` | GPT-5.6-Terra | medium | ultra | "Balanced agentic coding model for everyday work" |
| `gpt-5.6-luna` | GPT-5.6-Luna | medium | max | "Fast and affordable agentic coding model" |
| `gpt-5.5` | GPT-5.5 | medium | xhigh | "Frontier model for complex coding, research, and real-world work"; supports personality |
| `gpt-5.4` | GPT-5.4 | medium | xhigh | "Strong model for everyday coding"; supports personality |
| `gpt-5.4-mini` | GPT-5.4-Mini | medium | xhigh | "Small, fast, and cost-efficient model for simpler coding tasks"; supports personality |
| `gpt-5.2` | GPT-5.2 | medium | xhigh | "Optimized for professional work and long-running agents" |

All 7 accept `low`/`medium`/`high`/`xhigh` reasoning effort; `gpt-5.6-sol`/`gpt-5.6-terra`
additionally accept `max` and `ultra`; `gpt-5.6-luna` additionally accepts `max`.

**Important interaction with item 1's flat-hierarchy guard:** `ultra` reasoning effort is
documented by the backend itself as *"Maximum reasoning with automatic task delegation"* — i.e.
at `ultra` effort the model is explicitly licensed to invoke the native multi-agent tools (E11)
even without an explicit delegation request in the prompt. A rasen leaf-worker dispatch that must
stay flat should **not** use `-c model_reasoning_effort="ultra"`; cap leaf-worker effort at `xhigh`
or below.

## Recommendation for rasen's per-role model assignment

Map rasen's existing model-per-role table (fable vs sonnet analog) onto `-m`/`-c
model_reasoning_effort` flags appended to every `codex exec` dispatch, mirroring how Claude
dispatches already vary model per role. Candidate mapping now that real ids are known:
`gpt-5.6-luna` or `gpt-5.4-mini` for the "fast/cheap" tier (both explicitly marketed as
fast/affordable/cost-efficient), `gpt-5.6-sol` for the "high-capability" tier (frontier model,
also this auth's configured default).

## Resume/identity handle, structured output

Unaffected — these flags compose with `resume` and `--output-schema` identically to any other
dispatch flag.

## Failure modes

Hard 404 on a genuinely-unserved model id (fail fast, do not retry with the same id). Soft
metadata-not-found warning on a real-but-locally-unlisted model id (may still succeed — treat as
non-fatal). Neither failure mode is specific to this environment's proxy auth setup (E01) — both
were observed using the *working* proxy-provider override, so they reflect genuine Codex/backend
behavior, not the local auth quirk.
