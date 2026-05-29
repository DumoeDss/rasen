## Why

When gstack expert skills are installed via `openspec init`, they appear as `/browse`, `/cso`, `/qa` etc. — generic names that don't convey their origin. Users need to distinguish gstack expert skills from OpenSpec workflow commands, especially in a commands-first delivery where both coexist. Adding a `gstack:` prefix (e.g., `/gstack:browse`, `/gstack:cso`) makes the skill namespace explicit and avoids future naming collisions.

Additionally, `scripts/gen-skill-docs.ts` still hardcodes gstack-era paths (`~/.gstack/`, `~/.claude/skills/gstack/`, `$GSTACK_ROOT`) in the generated SKILL.md content. These paths are embedded in the instructions that `openspec init` installs. They need to be migrated to OpenSpec-standard paths (`~/.openspec/`, appropriate skill root) so the runtime references are correct.

## What Changes

- Rename all 28 expert skill `name` fields from `xxx` to `gstack:xxx` (e.g., `browse` → `gstack:browse`, `cso` → `gstack:cso`, `gstack-upgrade` → `gstack:upgrade`)
- Update `scripts/gen-skill-docs.ts` HOST_PATHS and generated content to replace `.gstack`/`gstack` paths with OpenSpec equivalents
- Regenerate `skills/gstack/*/SKILL.md` files from templates with updated paths
- Update skill `dirName` registrations to match the new naming convention (e.g., `openspec-browse` → `openspec-gstack-browse`)

## Capabilities

### New Capabilities
- `skill-name-prefix`: Rename all 28 gstack expert skill `name` fields to use `gstack:` prefix and update corresponding dirName registrations
- `gen-skill-docs-path-migration`: Migrate `scripts/gen-skill-docs.ts` HOST_PATHS, preamble generation, and hardcoded paths from gstack-era paths to OpenSpec-standard paths

### Modified Capabilities
<!-- No existing spec requirement changes -->

## Impact

- **28 expert template files** in `src/core/templates/experts/*.ts` — `name` field change
- **`src/core/shared/skill-generation.ts`** — `dirName` updates for all 28 expert skill registrations
- **`scripts/gen-skill-docs.ts`** — HOST_PATHS, `SKILLS_DIR`, preamble bash, and all path-generating functions
- **`skills/gstack/*/SKILL.md`** — regenerated output files with updated paths
- **Existing installations** — users must re-run `openspec init --force` to pick up renamed skills (old `openspec-*` directories become orphans)
