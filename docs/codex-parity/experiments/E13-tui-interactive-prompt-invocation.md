# E13 — Does the interactive TUI discover/invoke `$CODEX_HOME/prompts/*.md` custom prompts?

**Codex CLI version:** 0.144.1

## Purpose

Round-1 solution 07 left the interactive-TUI half of item 7 as an unverified assumption ("not
re-tested this round, but the file format matches Codex's documented TUI prompt format and this
round found no reason to doubt the TUI path works as designed") — an explicitly banned pattern.
This experiment drives the real interactive `codex` TUI non-interactively via a scripted
pseudo-tty to settle it with live evidence, in the same **temp `CODEX_HOME`** used in E06 (never
touching the real `~/.codex/prompts`).

## Method

Interactive `codex` cannot be driven with `codex exec`; it must be spawned as a real pty-attached
process. Used Python's stdlib `pty`/`os.fork`, feeding synthetic keystrokes to the pty master and
capturing the terminal's rendered output. `pyte` (a terminal-emulator library) was `pip install`ed
to properly render the ANSI/cursor-addressed output into a legible screen buffer.

## Attempt 1 (methodologically flawed — recorded honestly, not hidden)

First two attempts (`tui_probe.py`, `tui_probe2.py`) opened the pty with `pty.openpty()` but never
called the `TIOCSWINSZ` ioctl to tell the child process the terminal's row/column size. Codex's
TUI apparently falls back to a very narrow effective width without it, causing every line of
output to wrap to one character per row — the captured `parity-test` typing and the eventual
`Unrecognized command` error text were both **legible when concatenated character-by-character**
(confirming *some* real interaction occurred) but the screen layout was too garbled to see the
slash-command popup/autocomplete UI, which is the part that actually answers the discovery
question. Recorded as a methodology note, not silently discarded — the raw captures are still in
the scratchpad (`e07-tui/tui-out-raw.bin`, `tui-out2.txt`).

## Attempt 2 — fixed pty sizing, conclusive result

`tui_probe3.py` added `fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 45, 120, 0, 0))`
before forking, and rendered output through `pyte.Screen(120, 45)` for an accurate terminal
snapshot at each step. Sequence: boot → type bare `/` (see the built-in command palette) → type
`parity-test` (see whether it filters/autocompletes) → submit ` world\r` → capture the result.

**Boot screen** (confirms the TUI started correctly against the temp `CODEX_HOME`, model/provider
picked up the same proxy override as everywhere else in this dossier):
```
╭───────────────────────────────────────────────────╮
│ >_ OpenAI Codex (v0.144.1)                        │
│ model:     gpt-5.6-sol   /model to change         │
│ directory: .../e07-tui/repo                       │
╰───────────────────────────────────────────────────╯
  Tip: Our most capable model yet. ...
› Write tests for @filename
  gpt-5.6-sol default · .../e07-tui/repo…
```

**After typing bare `/`** — the full built-in command palette, rendered cleanly:
```
› /
  /model         choose what model and reasoning effort to use
  /fast          1.5x speed, increased usage
  /ide           include current selection, open files, and other context from your IDE
  /permissions   choose what Codex is allowed to do
  /keymap        remap TUI shortcuts
  /vim           toggle Vim mode for the composer
  /experimental  toggle experimental features
  /approve       approve one retry of a recent auto-review denial
```
**`parity-test` (the custom prompt placed in `$CODEX_HOME/prompts/parity-test.md`, same file used
in E06) is absent from this list.** Only 8 fixed, built-in commands are shown — no dynamic
entries sourced from the `prompts/` directory.

**After typing `/parity-test`** — no filtered/autocomplete suggestion appears at all (contrast
with the bare-`/` popup above, which *would* show a live-filtered subset if `parity-test` were a
recognized command):
```
› /parity-test
  gpt-5.6-sol default · .../e07-tui/repo…
```

**After submitting `/parity-test world`** — an explicit, unambiguous rejection:
```
• Unrecognized command '/parity-test'. Type "/" for a list of supported commands.
›  world/parity-test
  gpt-5.6-sol default · .../e07-tui/repo…
```

## Verdict for item 7 (TUI half)

**Live-verified negative, not an assumption.** The interactive TUI does **not** discover or invoke
files dropped in `$CODEX_HOME/prompts/*.md` as `/name` slash commands on codex-cli 0.144.1, despite
the frontmatter shape (`description`/`argument-hint`) matching what rasen's
`src/core/command-generation/adapters/codex.ts` adapter already writes. This is the same negative
result as `codex exec` (E06), now confirmed for the TUI path too — **the entire premise that
`$CODEX_HOME/prompts/*.md` is Codex 0.144.1's live custom-command mechanism is in doubt**, not
just its non-interactive invocability. Round 1's characterization of item 7 undersold this: it
treated exec-mode non-expansion as the whole gap and assumed TUI-mode worked; live evidence now
shows TUI-mode rejects it identically.

## Open follow-up (not chased further this round — out of scope for the specific gap asked)

`codex doctor`'s enabled-feature-flags list (E01 context) includes `skills`,
`skill_mcp_dependency_install`, `plugins`, `plugin_sharing` — and E01's baseline rollout showed a
`<skills_instructions>` system-prompt block listing real skills (e.g. `imagegen`) with `file`
source locators, entirely separate from the `prompts/` mechanism. It's plausible Codex 0.144.1's
real extensibility surface for "give the agent a reusable named instruction set" is a
**skills/SKILL.md** system, not `$CODEX_HOME/prompts/*.md` — this dossier did not verify that
hypothesis live (would require locating the real skills search path and format, a materially
different investigation than what round 2's gap asked for). Flagged for round 3 if a working
non-emulated invocation path is ever needed instead of the client-side-inlining emulation design.

## Reproduction

```python
import os, pty, fcntl, termios, struct, pyte, time, select
# ... open pty, MUST call fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
#     before forking, or the TUI renders at a garbled width.
# fork, exec `codex -c model_providers.proxy.* --sandbox read-only` with CODEX_HOME set to a temp
#   dir containing prompts/<name>.md and a read-only copy of auth.json.
# feed b"/" then b"<name>" then b" <arg>\r" to the pty master, render via pyte.Screen, inspect.
```
