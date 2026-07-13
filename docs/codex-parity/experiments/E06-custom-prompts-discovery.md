# E06 — Custom prompts (`$CODEX_HOME/prompts/*.md`) discovery and non-interactive invocability

**Codex CLI version:** 0.144.1

## Purpose

Item 7: rasen's Codex command adapter (`src/core/command-generation/adapters/codex.ts`) already
writes `<CODEX_HOME>/prompts/rasen-<id>.md` with `description`/`argument-hint` frontmatter. Verify
whether a prompt placed there is (a) discovered, and (b) invocable non-interactively via
`codex exec`.

## Hygiene

Used a **temp `CODEX_HOME`** (`$SCRATCH/e06/codex-home`) to avoid touching the real
`~/.codex/prompts` (which doesn't currently exist — confirmed absent both before and after this
experiment: `ls ~/.codex/prompts` → "No such file or directory"). Copied `auth.json` **read-only**
(`cp`, never wrote back) into the temp home so the proxy override could still authenticate.

## Setup

```
$SCRATCH/e06/codex-home/prompts/parity-test.md:
---
description: A test custom prompt for parity research
argument-hint: "[name]"
---
Reply with exactly: CUSTOM_PROMPT_OK for $1
```
Frontmatter shape matches the rasen adapter's own format (`description`, `argument-hint`) —
confirmed by reading `src/core/command-generation/adapters/codex.ts` lines around the
`writeFrontmatter`-equivalent block (`description: ${content.description}` /
`argument-hint: command arguments`).

## Command

```
CODEX_HOME=$SCRATCH/e06/codex-home \
  codex exec --json --skip-git-repo-check $CODEXW_ARGS \
  -o /tmp/e06a-last.txt "/parity-test world" < /dev/null
```

## Result — negative finding: `codex exec` does NOT expand custom prompts

```
EXIT:0
"Hello, world!"
```
The model treated `/parity-test world` as **literal chat text**, not a slash-command expansion —
it interpreted "/parity-test world" conversationally and replied "Hello, world!", never emitting
`CUSTOM_PROMPT_OK for world` (the literal template body). The `prompts/parity-test.md` file was
never read (confirmed: no `function_call`/read-file item touching that path in the resulting
rollout JSONL; the turn's only `response_item`s are the environment header, the user's literal
`/parity-test world` string, and the assistant's "Hello, world!" reply).

## Interpretation

Custom prompts under `$CODEX_HOME/prompts/*.md` are a **TUI-only, interactive-mode** feature
(slash-command autocomplete inside the interactive `codex` REPL). `codex exec` has no
prompt-file-expansion subsystem — it passes its `PROMPT` argument straight through as the user's
first message, with zero special-casing for a leading `/`. This matches `codex exec --help`'s own
description of `PROMPT`: *"Initial instructions for the agent"* — no mention of slash-command
resolution, unlike the top-level interactive `codex [PROMPT]` where slash-commands are a
documented TUI affordance.

## Emulation design for rasen (since direct invocation doesn't work)

Rasen's Codex adapter must **inline the skill/prompt body into the `codex exec` prompt string
itself** rather than relying on `/name args` expansion:
1. Adapter already writes the prompt file with frontmatter + body to `$CODEX_HOME/prompts/rasen-<id>.md` for the **interactive/TUI** use case (keep this — it still benefits humans running interactive `codex` in a rasen repo).
2. For **non-interactive dispatch** (LEAD → Codex worker via `codex exec`), the dispatcher must read that same `.md` file itself, strip frontmatter, substitute `argument-hint`-declared args (simple `$1`/`$ARGUMENTS`-style substitution, matching Claude Code's own skill-invocation convention), and concatenate the expanded body directly into the `codex exec` prompt argument — i.e. treat the prompt file as a local template library, not something Codex resolves on its own.

## Reproduction

```
mkdir -p /tmp/codex-home-test/prompts
cat > /tmp/codex-home-test/prompts/foo.md <<'EOF'
---
description: test
---
Reply with exactly: FOO_OK
EOF
cp ~/.codex/auth.json /tmp/codex-home-test/auth.json   # read-only copy, never write back
CODEX_HOME=/tmp/codex-home-test codex exec --skip-git-repo-check "/foo" < /dev/null
# → model treats "/foo" as literal text, does not emit FOO_OK
```
