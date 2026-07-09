## Context

OpenSpec merged gstack expert skills (28 skills) and OPSX workflow commands (5 commands) into a unified product. Currently:
- Expert skill `name` fields are bare identifiers: `browse`, `cso`, `qa`, etc.
- These appear as `/browse`, `/cso` slash commands with no namespace indication
- `scripts/gen-skill-docs.ts` generates SKILL.md source files with hardcoded gstack-era paths (`~/.gstack/`, `~/.claude/skills/gstack/`, `$GSTACK_ROOT`)
- The generated instructions contain runtime bash code referencing these old paths
- OPSX workflow commands already use `openspec-opsx-*` dirName convention

## Goals / Non-Goals

**Goals:**
- Namespace all 28 gstack expert skills with `gstack:` prefix so they appear as `/gstack:browse`, `/gstack:cso`, etc.
- Migrate all runtime paths in gen-skill-docs.ts from gstack-era to OpenSpec-standard
- Maintain consistency between the dirName convention and the new naming

**Non-Goals:**
- Renaming the `skills/gstack/` source directory (it's internal, not user-facing)
- Renaming gstack binary names (e.g., `gstack-review-read`) — these are gstack tools, not OpenSpec tools
- Changing the OPSX workflow command names (already correctly namespaced)
- Migrating the codex host entirely (minimal changes only)

## Decisions

### D1: Skill Name Format → `gstack:<base-name>`

All 28 expert skills get `gstack:` prefix. The base name drops any redundant `gstack-` prefix:

| Current name | New name |
|---|---|
| `browse` | `gstack:browse` |
| `cso` | `gstack:cso` |
| `gstack-upgrade` | `gstack:upgrade` |
| (all other 25) | `gstack:<same>` |

**Rationale**: `:` separator matches the existing `opsx:` convention for workflow commands. Dropping the `gstack-` prefix from `gstack-upgrade` avoids `gstack:gstack-upgrade`.

### D2: Directory Name → `openspec-gstack-<base-name>`

Update dirName registration from `openspec-<name>` to `openspec-gstack-<base-name>`:

| Current dirName | New dirName |
|---|---|
| `openspec-browse` | `openspec-gstack-browse` |
| `openspec-cso` | `openspec-gstack-cso` |
| `openspec-gstack-upgrade` | `openspec-gstack-upgrade` (unchanged) |

**Rationale**: Follows the pattern set by OPSX workflow commands (`openspec-opsx-*`). Clearly separates gstack expert skills from core OpenSpec workflow skills in the directory structure.

### D3: gen-skill-docs.ts Path Migration

| Old path | New path | Usage |
|---|---|---|
| `~/.gstack/` | `~/.openspec/` | State directory (sessions, analytics, config markers) |
| `~/.claude/skills/gstack` | `~/.openspec/skills` | HOST_PATHS skillRoot for claude host |
| `.claude/skills/gstack` | `.openspec/skills` | HOST_PATHS localSkillRoot for claude host |
| `~/.claude/skills/gstack/bin` | `~/.openspec/bin` | HOST_PATHS binDir for claude host |
| `~/.claude/skills/gstack/browse/dist` | `~/.openspec/browse/dist` | HOST_PATHS browseDir for claude host |
| `$GSTACK_ROOT` | `$OPENSPEC_ROOT` | HOST_PATHS skillRoot for codex host |
| `$GSTACK_BIN` | `$OPENSPEC_BIN` | HOST_PATHS binDir for codex host |
| `$GSTACK_BROWSE` | `$OPENSPEC_BROWSE` | HOST_PATHS browseDir for codex host |

The preamble bash code and all generator functions use `ctx.paths.*` so changing HOST_PATHS propagates automatically. The hardcoded `~/.gstack/` references in `generatePreambleBash`, `generateLakeIntro`, etc. need direct replacement.

### D4: Post-processing Regex Updates for Codex

Lines 2324-2327 have codex-specific path replacements. These need updating:
- `~/.claude/skills/gstack` → `~/.openspec/skills` (then replaced by `$OPENSPEC_ROOT`)
- `.claude/skills/gstack` → `.openspec/skills` (then replaced by localSkillRoot)
- `.claude/skills/review` → `.agents/skills/openspec/review`
- `.claude/skills` → `.agents/skills`

### D5: SKILLS_DIR Remains Unchanged

`const SKILLS_DIR = path.join(ROOT, 'skills', 'gstack')` stays the same — this points to the source directory in the repo, not an installed path. The `skills/gstack/` directory is internal to the build process.

## Risks / Trade-offs

**[Breaking change for existing installations]** → Users must re-run `openspec init --force`. Old skill directories (`openspec-browse/`, etc.) become orphans. This is acceptable since the merge is still in dev phase.

**[`:` in skill names]** → Colons are valid in YAML values and Claude Code skill names but cannot be used in Windows directory names. The dirName uses `-` separator (`openspec-gstack-browse`) so no Windows issue. Risk: only if something tries to derive dirName from skill name directly.

**[Binary path assumptions]** → The preamble bash references `~/.openspec/bin/gstack-*` binaries. These binaries must actually exist at that path when skills are invoked. The installation process needs to ensure binaries are placed correctly. This change only updates the path references, not the binary deployment mechanism.
