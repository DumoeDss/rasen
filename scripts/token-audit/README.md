# token-audit — session cost auditor (debug tooling)

> **Deprecated.** This tool has been productized as `rasen agent audit`
> (`src/core/token-audit/`), an experimental CLI command that also supports
> Codex CLI rollouts via `--runtime codex`. Run `rasen agent audit --help`
> or invoke the `/rasen-audit` skill. `audit.mjs` in this directory is now a
> thin wrapper that delegates to the new command — existing invocations
> keep working — but new usage should go through `rasen agent audit`
> directly. `viewer.html` moved to `viewer/audit.html` at the repo root
> (also shipped as a package asset); this directory no longer has its own
> copy. `forensics/` and the measurement-discipline notes below are
> unchanged and still the source of truth for the underlying math.

Audits a Claude Code session's full token spend — main agent + every subagent —
and renders it as an interactive timeline. Originally internal debug tooling
(D5 of `rasen/office-hours/token-cost-audit.md`), kept out of the CLI surface
because it parses the harness's undocumented transcript format, which can
drift with Claude Code versions — `rasen agent audit` now surfaces that same
risk explicitly (an experimental marker plus fail-soft error handling)
instead of hiding the tool from users.

## Usage

```bash
# 1. Analyze a session (id prefix is enough; run from the project the session belongs to)
node scripts/token-audit/audit.mjs c4a16986 --pretty

# elsewhere: point at the projects dir or the main transcript directly
node scripts/token-audit/audit.mjs <sessionId> --projects-dir ~/.claude/projects/<slug>
node scripts/token-audit/audit.mjs path/to/<sessionId>.jsonl --out my-audit.json

# 2. Open viewer.html in a browser and drop the generated JSON onto it.
#    (Served over http it also accepts ?src=<url>&theme=light|dark.)
```

The analyzer discovers subagent transcripts at
`<projectsDir>/<sessionId>/subagents/*.jsonl` automatically.

## What it reports

- **Totals**: deduped request count, output tokens, cache read/write, and the
  billed-input-equivalent (`raw + write x TTL-coef + 0.1 x read`; main session
  writes cost 2x at 1h TTL, subagent writes 1.25x at 5m TTL).
- **Agents in activation order**: per-agent requests, models, peak context,
  spawn payload, billed equivalent, tool census, warm/cold resume counts.
- **Churn events**: every cache rewrite (cache_read collapsed below 90% of the
  previous prefix), with cause attribution:
  - `ttl-expiry` — idle gap ≥ the tier's TTL (5m subagent / 1h main)
  - `rebase` — gap under TTL but the parentUuid chain forked or a non-tool
    user message was injected (SendMessage/attachment delivery)
  - `context-drop` — context shrank >30% (compaction/rewind)
  - `unattributed` — none of the above fingerprints matched
- **Bursts/resumes**: request clusters split at >3min silence; each resume is
  a HIT (warm continuation) or MISS (paid rewrite).

## Measurement discipline (do not "simplify" these away)

1. **Dedupe by `message.id`.** Transcripts write one line per content block
   and copy the full usage object onto every line — counting lines overstates
   ~2.5x. (This burned the first version of the 2026-07 audit.)
2. **Two TTL coefficients.** Subagent cache writes are 5-minute TTL (1.25x);
   only the main session gets 1h (2x). One blanket coefficient misprices ~30%
   of the bill.
3. Validated against session `c4a16986` (2026-07 audit baseline): 2,649
   requests, 20.40M cache write, 573.94M cache read, 84.22M billed-equivalent,
   53 churn events / 13.79M — all match the published audit line for line.

## Files

- `audit.mjs` — deprecated wrapper; delegates to `rasen agent audit`. The
  original analyzer logic now lives in `src/core/token-audit/`.
- `viewer.html` — moved to `viewer/audit.html` at the repo root (self-contained
  single-file viewer, no network, no deps; now also renders a Codex-runtime
  report). Drag-drop the JSON; light/dark themes; zoomable agent swimlane,
  sortable agent/churn tables.
- `forensics/` — the original one-off scripts from the 2026-07 audit session,
  kept verbatim for provenance (hardcoded paths, they answered one question
  each). `audit.mjs` consolidates session-stats + churn-dedup + churn-attrib +
  pingpong-timeline + fork-check. `dup-analysis.mjs` is different in kind — it
  scans installed skill files for verbatim duplication, no session input — run
  it directly if needed.
