## REMOVED Requirements

### Requirement: Generator Script Existence

**Reason**: `scripts/gen-skill-docs.ts` is deleted. Expert prompts are authored as inline TypeScript template strings, not generated from templates.
**Migration**: Author expert prompts directly in `src/core/templates/experts/<name>.ts`; shared prose lives in `src/core/templates/experts/_shared.ts`.

### Requirement: Skills Directory Scanning

**Reason**: There is no generator to scan `skills/` for `.tmpl` files; `.tmpl` sources are removed.
**Migration**: None; expert content is discovered through the `getSkillTemplates()` registry.

### Requirement: Build Process Integration

**Reason**: `build.js` no longer runs a generator before `tsc`; the generator step is removed.
**Migration**: `pnpm build` compiles TypeScript directly. Freshness is enforced by `test/core/templates/skill-templates-parity.test.ts`.

### Requirement: Generated Files Are Build Products

**Reason**: There are no generated `SKILL.md` build products; the source of truth is the inline TypeScript template, not a `.tmpl` file.
**Migration**: Edit `src/core/templates/experts/<name>.ts` directly.

### Requirement: Path Variable Substitution

**Reason**: The generator performed the `~/.gstack/` → `~/.openspec/` substitution at generation time; with no generator, inline templates carry the final `~/.openspec/` paths verbatim.
**Migration**: None; migrated templates already use OpenSpec paths.
