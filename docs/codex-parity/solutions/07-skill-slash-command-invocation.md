# 7 — Skill / slash-command invocation inside workers

**Status: needs-emulation** (live-verified negative on BOTH invocation surfaces — `codex exec`
non-interactive mode AND the interactive TUI both reject `$CODEX_HOME/prompts/*.md` custom
prompts as unrecognized commands; this is not an assumption in either direction, both were driven
live)

## Experiments

E06 (custom prompts discovery via `codex exec` — negative finding), E13 (round 2 — custom prompts
discovery via the interactive TUI, driven non-interactively through a scripted pty — also
negative).

## What's verified

- Frontmatter shape: rasen's `src/core/command-generation/adapters/codex.ts` already writes
  `<CODEX_HOME>/prompts/rasen-<id>.md` with `description`/`argument-hint` frontmatter, matching
  Codex's own documented custom-prompt frontmatter fields (confirmed by reading the adapter
  source, cross-checked against a hand-written test prompt using the identical two fields).
- **Negative result 1 (`codex exec`, E06):** `codex exec "/parity-test world"` does **not** expand
  the prompt file — the model treats `/name args` as literal chat text (replied "Hello, world!"
  conversationally instead of the templated `CUSTOM_PROMPT_OK for world`). No file-read tool call
  touching the prompt file appeared in the resulting rollout.
- **Negative result 2 (interactive TUI, E13, round 2):** drove the real interactive `codex` TUI
  non-interactively via a scripted pseudo-tty (Python `pty`/`fcntl.ioctl(TIOCSWINSZ)` +
  `pyte` for accurate terminal rendering), against the same temp `CODEX_HOME` from E06. Typing a
  bare `/` renders the TUI's live command palette — it lists exactly 8 fixed built-in commands
  (`/model`, `/fast`, `/ide`, `/permissions`, `/keymap`, `/vim`, `/experimental`, `/approve`) and
  **`parity-test` is absent**. Typing `/parity-test` produces no autocomplete match at all
  (contrast with what the bare-`/` popup shows for real commands). Submitting `/parity-test world`
  yields an explicit, unambiguous engine-level rejection:
  ```
  • Unrecognized command '/parity-test'. Type "/" for a list of supported commands.
  ```
  This settles the TUI half with live evidence rather than the round-1 assumption ("no reason to
  doubt the TUI path works as designed") — that assumption was wrong, or at minimum the mechanism
  is not what rasen's adapter currently targets.

## Interpretation — this is not just an exec-mode gap, the whole `prompts/` premise is in doubt

Round 1 treated this item as "TUI works, exec mode needs an inline-template workaround." Round 2's
live TUI evidence changes that framing: **neither invocation surface recognizes
`$CODEX_HOME/prompts/*.md` as a live custom-command source on codex-cli 0.144.1**, at least not
under the plain-frontmatter format rasen currently writes. Two non-exclusive possibilities, neither
chased further this round (out of scope for the specific gap asked — flagged for round 3):
1. The feature genuinely doesn't exist / was renamed or relocated in this version, or requires an
   additional registration step (e.g. a config.toml entry, not just dropping a file) that this
   round didn't discover.
2. Codex 0.144.1's real extensibility surface for "reusable named instruction set" is a
   **skills/SKILL.md** system instead — `codex doctor`'s enabled feature flags include `skills`,
   `skill_mcp_dependency_install`, `plugins`; E01's baseline rollout showed a genuine
   `<skills_instructions>` system-prompt block enumerating real skills (e.g. `imagegen`) with
   `file` source locators — a completely different mechanism from `prompts/`, unexplored this
   round.

Regardless of which (if either) of these turns out to be the "real" native mechanism, the
practical conclusion for rasen is unchanged: **don't depend on Codex to resolve anything from
`$CODEX_HOME/prompts` at dispatch time** — inline the content client-side.

## Emulation design (required — this is a real, now doubly-confirmed gap, not a config oversight)

For non-interactive Codex worker dispatch (rasen's actual use case — the LEAD dispatches Codex
workers via `codex exec`/`resume`, never the interactive TUI), rasen's adapter needs a **local
template-expansion step** that never depends on Codex resolving `/name` itself:

1. Read the `.md` file rasen already generates (whether or not it's *also* written to
   `$CODEX_HOME/prompts/rasen-<id>.md` for potential future/human use — keep writing it there for
   forward-compatibility and for a human running interactive `codex` directly in a rasen repo, but
   treat that write as inert/unverified for automation purposes given the negative TUI result
   above).
2. Strip the YAML frontmatter, do simple positional/`$ARGUMENTS`-style substitution against the
   `argument-hint`-declared parameters (mirroring Claude Code's own skill-invocation convention),
   and concatenate the expanded body directly into the `codex exec` prompt string.
3. This means a Codex worker dispatch is **always a single, self-contained prompt string** with
   the skill body already inlined — no runtime dependency on Codex reading anything from
   `$CODEX_HOME/prompts` at any point, interactive or not.

## Resume/identity handle, structured output

Not applicable to this item specifically — inherits whatever mechanism the surrounding
`codex exec`/`resume` call uses (solutions 03/08).

## Failure modes

If the emulation step is skipped and a literal `/name args` string is sent via `codex exec`, the
model silently treats it as conversational text and hallucinates a plausible-sounding but wrong
response (E06) — a **silent** failure mode. Via the interactive TUI, the failure is loud instead
(`Unrecognized command`, E13) — but rasen never drives the interactive TUI programmatically, so
the silent `codex exec` failure mode is the one that matters operationally; the dispatcher must
own template expansion unconditionally rather than treating it as an optional optimization.
