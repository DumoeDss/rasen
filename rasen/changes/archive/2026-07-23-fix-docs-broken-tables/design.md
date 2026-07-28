## Context

Pure documentation phrasing fix (see `proposal.md`): two mirrored "command syntax by tool" tables, in English and Chinese, have a Claude Code row missing its leading `/` and (in the `how-commands-work.md` pair) an adjoining sentence that still references the retired colon-form skill invocation. No code, schema, or architecture is involved.

## Goals / Non-Goals

**Goals:**
- Make the Claude Code row consistent with every other row in both tables (both languages).
- Remove the self-contradictory "colon form" sentence and state accurately that every tool surfaces the skill behind a leading slash.

**Non-Goals:**
- No product code changes.
- No fix to the broader pre-existing `OpenSpec`/`opsx-*` branding staleness across `docs/zh/*` (flagged in `proposal.md` Impact as a separate follow-up).
- No delta specs — no product-observable behavior or contract is changing.

## Decisions

None — the edits are a direct 1:1 text correction at four known locations (`proposal.md` Impact lists the files and line ranges); there is no design choice to make beyond matching the existing table format already used by every non-Claude-Code row.

## Risks / Trade-offs

- [Editing the zh files could accidentally touch the adjacent stale `OpenSpec`/`opsx-*` wording] → scope the edit strictly to the Claude Code row and the colon-form sentence; leave every other token in those tables/paragraphs untouched.
