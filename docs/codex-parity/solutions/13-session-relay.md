# 13 — Session relay: LEAD spawns a successor interactive session with a seeded prompt (Step H.7)

**Status: code-analysis-only** (per goal-plan.md, this item may resolve to code-analysis + a small
live check; the live check was not exercised this round — see gap below)

## Experiments

None directly — code-analysis based on `codex --help`, `codex resume --help` flag surfaces (E01
context) and E02's resume mechanics.

## Analysis

Step H.7's session relay is a **Claude-Code-specific mechanic**: the LEAD (an interactive Claude
Code session) hits a context/capability limit and spawns a *successor interactive session* seeded
with a distilled prompt, so a human can pick up the interactive thread. This is fundamentally
about relaying an **interactive, human-facing** session — it is orthogonal to Codex workers, which
in rasen's design are always non-interactive dispatch targets (`codex exec`), not the LEAD itself.

Two sub-cases:
1. **The LEAD is Claude, Codex workers are dispatched targets:** session relay never touches
   Codex at all — a Codex worker's completed/interrupted thread is simply resumed via `codex exec
   resume <id>` (solutions 03/04/06) by whichever LEAD process picks up the work next; there is no
   "successor Codex session" concept needed because Codex workers were never interactive sessions
   in the first place, they're always single-shot `codex exec` dispatches from the LEAD's
   perspective.
2. **If Codex itself were ever the LEAD** (out of scope for the current rasen design, which
   assumes a Claude LEAD orchestrating Codex workers, not the reverse) — Codex's own interactive
   mode does have a directly analogous primitive: `codex resume [SESSION_ID] [PROMPT]` (the
   top-level `codex resume`, not `codex exec resume`) accepts an optional seed PROMPT argument per
   its `--help`, and `codex fork [--last]` ("Fork a previous interactive session... use --last to
   fork the most recent") is an even closer match to "spawn a successor session with inherited
   context" — both exist per the CLI's command list (`codex --help`: `resume`, `fork` both listed
   as top-level subcommands) but were not live-tested this round.

## Verdict

**Session relay stays Claude-only; Codex workers are unaffected**, matching the goal-plan's
anticipated resolution. No emulation design is needed for the current rasen architecture (Claude
LEAD, Codex leaf workers) — this item only becomes live-relevant if rasen's architecture ever
inverts to a Codex-driven LEAD, at which point `codex resume <id> "<seed prompt>"` or `codex fork
--last` are the concrete candidates to live-test.

## Resume/identity handle, structured output

N/A for the current architecture; if revisited, same thread-id mechanism as solutions 03/06.

## Failure modes / open follow-up

`codex resume`/`codex fork`'s seed-prompt behavior was not live-verified this round (out of
scope given case 1 above covers rasen's actual architecture) — a genuine gap only worth closing if
rasen's LEAD-role assumption changes.
