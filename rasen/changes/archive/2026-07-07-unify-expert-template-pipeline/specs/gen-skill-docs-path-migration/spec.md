## REMOVED Requirements

### Requirement: HOST_PATHS uses OpenSpec paths for claude host

**Reason**: `scripts/gen-skill-docs.ts` is deleted; expert prompts are now inline TypeScript with claude-host paths hardcoded in the `BROWSE_SETUP` shared constant. There is no generator whose `HOST_PATHS.claude` object to configure.
**Migration**: The claude-host paths (`.openspec/skills`, `~/.openspec/browse/dist`) are embedded in `src/core/templates/experts/_shared.ts`; no host configuration is needed.

### Requirement: HOST_PATHS uses OpenSpec variables for codex host

**Reason**: The codex-host generation path (`--host codex` → `.agents/skills/`) had no TypeScript consumer and is removed with the generator.
**Migration**: None. Codex-host skill generation is not reintroduced; the TS install pipeline is claude-host only.

### Requirement: State directory paths use ~/.openspec/

**Reason**: The generator functions that emitted `~/.gstack/` state paths are deleted; the surviving inline prose already uses `~/.openspec/`.
**Migration**: None; the migrated inline templates contain no `~/.gstack/` references.

### Requirement: Codex post-processing regex updated

**Reason**: The codex-host post-processing step is part of the deleted generator.
**Migration**: None.

### Requirement: Regenerated SKILL.md files are consistent

**Reason**: There is no regeneration step; `bun scripts/gen-skill-docs.ts` no longer exists and no `SKILL.md` build products are committed. Freshness is enforced by the parity golden-master instead.
**Migration**: Use `test/core/templates/skill-templates-parity.test.ts` as the freshness gate.
