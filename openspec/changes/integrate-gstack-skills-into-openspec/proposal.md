## Why

The gstack expert skill documents (`skills/gstack/*/SKILL.md`) were integrated into OpenSpec via path replacement only — changing `~/.gstack/` to `~/.openspec/` and `~/.claude/skills/gstack/` to `~/.openspec/skills/`. The skill content still references 8 gstack binaries (179 occurrences), gstack branding (140+ occurrences), and gstack-specific infrastructure (session tracking, contributor mode, self-upgrade). These features either don't work without gstack binaries at runtime, are irrelevant to OpenSpec users, or should be replaced by OpenSpec-native equivalents.

## What Changes

**REMOVE** — gstack-specific features with no value for OpenSpec:
- Strip the preamble bash block from gen-skill-docs.ts (update-check, session tracking, contributor mode, lake intro)
- Remove contributor mode section from all skill templates
- Remove gstack-upgrade skill template and registration entirely
- Remove all garryslist.org URL references
- Remove gstack-global-discover references

**MIGRATE** — Replace with OpenSpec equivalents:
- Add `proactive` and `repoMode` fields to OpenSpec global config schema
- Replace `gstack-config` reads with OpenSpec config reads (simple `cat`/`jq` or node inline)
- Replace `gstack-slug` calls with inline bash (`basename $(git remote get-url origin) .git`)
- Replace "CC+gstack" branding with "AI-assisted" in effort estimation tables
- Simplify the Completeness Principle to remove gstack branding while keeping the core philosophy
- Create a minimal preamble that reads OpenSpec config for `proactive` and `repoMode`, plus git branch

**DEFER** (explicitly out of scope):
- Review dashboard (gstack-review-read/review-log) — skills work without it
- gstack-diff-scope — only 3 skills use it, can default to manual check
- browse/ directory decoupling from gen-skill-docs.ts

## Capabilities

### New Capabilities
- `preamble-migration`: Replace gstack preamble with OpenSpec-native preamble (config reads, branch detection, repo mode)
- `remove-gstack-features`: Strip contributor mode, upgrade flow, session tracking, lake intro, and gstack-global-discover from all skill templates
- `branding-migration`: Replace gstack branding ("CC+gstack", "garryslist.org", "gstack team") with OpenSpec equivalents
- `openspec-config-extensions`: Add `proactive` and `repoMode` fields to OpenSpec global config schema and CLI
- `remove-gstack-upgrade-skill`: Remove the gstack-upgrade expert skill template and all registrations

### Modified Capabilities
<!-- No existing spec-level requirement changes -->

## Impact

- **`scripts/gen-skill-docs.ts`** — Major rewrite of preamble generators, removal of contributor/upgrade/lake sections
- **`skills/gstack/*/SKILL.md.tmpl`** — Remove `{{PREAMBLE}}` sections that reference gstack, replace with OpenSpec preamble
- **`skills/gstack/*/SKILL.md`** — Regenerated after template changes
- **`src/core/templates/experts/gstack-upgrade.ts`** — Deleted
- **`src/core/templates/experts/index.ts`** — Remove gstack-upgrade export
- **`src/core/shared/skill-generation.ts`** — Remove gstack-upgrade registration
- **`src/core/global-config.ts`** — Add `proactive` and `repoMode` config fields
- **`src/core/config.ts`** or equivalent — Config schema update
- **All 27 remaining expert skill SKILL.md files** — Regenerated with cleaned content
