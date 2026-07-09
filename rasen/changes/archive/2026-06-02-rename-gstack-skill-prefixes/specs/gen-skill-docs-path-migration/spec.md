## ADDED Requirements

### Requirement: HOST_PATHS uses OpenSpec paths for claude host
The `HOST_PATHS.claude` object in `scripts/gen-skill-docs.ts` SHALL use OpenSpec-standard paths:
- `skillRoot`: `~/.openspec/skills`
- `localSkillRoot`: `.openspec/skills`
- `binDir`: `~/.openspec/bin`
- `browseDir`: `~/.openspec/browse/dist`

#### Scenario: Claude host skill root path
- **WHEN** gen-skill-docs.ts runs with `--host=claude` (default)
- **THEN** all generated SKILL.md files SHALL reference `~/.openspec/skills` instead of `~/.claude/skills/gstack`

#### Scenario: Claude host binary path
- **WHEN** the preamble bash is generated for claude host
- **THEN** binary invocations SHALL use `~/.openspec/bin/` prefix (e.g., `~/.openspec/bin/gstack-update-check`)

### Requirement: HOST_PATHS uses OpenSpec variables for codex host
The `HOST_PATHS.codex` object SHALL use OpenSpec-standard environment variables:
- `skillRoot`: `$OPENSPEC_ROOT`
- `localSkillRoot`: `.agents/skills/openspec`
- `binDir`: `$OPENSPEC_BIN`
- `browseDir`: `$OPENSPEC_BROWSE`

#### Scenario: Codex host environment variables
- **WHEN** gen-skill-docs.ts runs with `--host=codex`
- **THEN** generated SKILL.md files SHALL reference `$OPENSPEC_ROOT` instead of `$GSTACK_ROOT`

#### Scenario: Codex runtime root computation
- **WHEN** the codex preamble bash computes the runtime root
- **THEN** it SHALL set `OPENSPEC_ROOT` (not `GSTACK_ROOT`) and check for `.agents/skills/openspec` directory

### Requirement: State directory paths use ~/.openspec/
All hardcoded `~/.gstack/` paths in gen-skill-docs.ts generator functions SHALL be replaced with `~/.openspec/`:
- `~/.gstack/sessions` → `~/.openspec/sessions`
- `~/.gstack/.completeness-intro-seen` → `~/.openspec/.completeness-intro-seen`
- `~/.gstack/analytics/eureka.jsonl` → `~/.openspec/analytics/eureka.jsonl`
- `~/.gstack/contributor-logs/` → `~/.openspec/contributor-logs/`

#### Scenario: Session tracking uses openspec directory
- **WHEN** the preamble bash code creates session files
- **THEN** it SHALL use `~/.openspec/sessions/` (not `~/.gstack/sessions/`)

#### Scenario: Lake intro marker uses openspec directory
- **WHEN** the lake intro seen marker is checked or written
- **THEN** it SHALL use `~/.openspec/.completeness-intro-seen`

#### Scenario: Analytics logging uses openspec directory
- **WHEN** eureka insights are logged
- **THEN** they SHALL append to `~/.openspec/analytics/eureka.jsonl`

### Requirement: Codex post-processing regex updated
The codex host post-processing regex replacements (lines 2324-2327) SHALL be updated to use OpenSpec paths:
- `~/.claude/skills/gstack` → `~/.openspec/skills` (source pattern)
- `.claude/skills/gstack` → `.openspec/skills` (source pattern)

#### Scenario: Codex output has no gstack path references
- **WHEN** gen-skill-docs.ts generates codex output
- **THEN** the output SHALL NOT contain the strings `~/.claude/skills/gstack`, `.claude/skills/gstack`, `$GSTACK_ROOT`, `$GSTACK_BIN`, or `$GSTACK_BROWSE`

### Requirement: Regenerated SKILL.md files are consistent
After all path changes, running `bun scripts/gen-skill-docs.ts` SHALL regenerate all `skills/gstack/*/SKILL.md` files with updated paths and no `~/.gstack/` or `~/.claude/skills/gstack` references.

#### Scenario: No stale gstack paths in generated files
- **WHEN** `bun scripts/gen-skill-docs.ts` completes
- **THEN** no generated SKILL.md file SHALL contain `~/.gstack/` or `~/.claude/skills/gstack/`

#### Scenario: Dry-run validation passes
- **WHEN** `bun scripts/gen-skill-docs.ts --dry-run` runs after regeneration
- **THEN** exit code SHALL be 0 (no drift between committed and generated files)
