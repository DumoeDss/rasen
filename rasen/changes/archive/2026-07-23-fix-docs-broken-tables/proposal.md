## Why

The `retire-colon-skill-names` change (archived at `rasen/changes/archive/2026-07-23-retire-colon-skill-names/`) retired the colon-form skill invocation (`skill:rasen-propose`) in favor of the slash form (`/rasen-propose`) everywhere, but left a known-open item: the "command syntax by tool" tables in `docs/commands.md` and `docs/how-commands-work.md` (plus their Chinese mirrors) were never updated to match. The Claude Code row in both tables is missing the leading `/` that every other tool row has, making it look inconsistent, and `docs/how-commands-work.md` still has a sentence claiming tools use "either the colon form... or the dash form" — a claim that is now false (the colon form is retired) and self-contradictory (the "colon form" example given contains no colon).

## What Changes

- `docs/commands.md`: fix the Claude Code row in the "Command Syntax by AI Tool" table to show `/rasen-propose`, `/rasen-apply-change` (leading slash), matching every other row.
- `docs/how-commands-work.md`: same fix to the Claude Code row in the "Slash command syntax by tool" table; rewrite the following paragraph that references a retired "colon form" so it accurately states every tool surfaces the skill behind a leading slash, with the exact syntax after that varying by tool.
- `docs/zh/commands.md`: apply the same Claude Code row fix (leading slash) to the mirrored table. Other rows in this table use pre-existing, unrelated stale `opsx-*`/`openspec-*` product naming (see Impact) — out of scope here, left untouched.
- `docs/zh/how-commands-work.md`: apply the same Claude Code row fix and rewrite the mirrored "colon form" sentence to remove the contradictory reference, keeping the cross-reference to 支持的工具/Supported Tools. The `OpenSpec`/`opsx-*` naming elsewhere in this file is the same pre-existing, out-of-scope staleness — left untouched.

No product code changes. No new or modified capabilities/specs — this is a pure documentation phrasing fix with no observable product behavior change.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `docs-content-accuracy`: the existing requirement "Documented commands match the shipped CLI" already normatively demands docs stay accurate to the shipped CLI; this change adds an explicit scenario for per-tool "command syntax" tables staying internally consistent and free of retired invocation forms, so future regressions of this exact defect class are covered.

## Impact

- Affected files: `docs/commands.md`, `docs/how-commands-work.md`, `docs/zh/commands.md`, `docs/zh/how-commands-work.md`.
- Out of scope, flagged for a future change: `docs/zh/*` carries much broader pre-existing staleness beyond these two tables — most of `docs/zh` (notably `docs/zh/supported-tools.md`, which alone has ~21 `opsx-` and ~5 `OpenSpec` references, and `docs/zh/commands.md`/`docs/zh/how-commands-work.md` themselves in the non-Claude-Code table rows) still uses the retired `OpenSpec` product name and `opsx-*` skill-name prefix instead of `rasen`/`rasen-*`. This predates and is unrelated to `retire-colon-skill-names`; it looks like the Chinese docs were never fully carried through the earlier rebrand. Recommend a dedicated follow-up change to re-sync `docs/zh/*` branding.
