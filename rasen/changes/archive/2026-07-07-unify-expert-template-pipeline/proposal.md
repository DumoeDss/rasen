## Why

The 19 expert skills live in a second, parallel toolchain: their prompts are authored in `skills/gstack/<name>/SKILL.md.tmpl`, a bun script (`scripts/gen-skill-docs.ts`) resolves `{{PLACEHOLDER}}` shared blocks into committed `SKILL.md` files, and the TS expert getters (`src/core/templates/experts/<name>.ts`) then `readFileSync` those generated files back at install time. Meanwhile every workflow skill is already a plain TS template string with shared blocks as TS constants (`STORE_SELECTION_GUIDANCE`, `ORCHESTRATION_PLAYBOOK`). Maintaining two source formats, two freshness gates (parity hashes for workflows, `skill:check` dry-run for experts), a bun dependency, and the `gstack` brand across the whole surface is pure carrying cost. Fold the experts into the same TS pipeline: one source format, one freshness gate (parity hashes), no bun for skill docs, and the `gstack` brand dropped from the installed skill names.

## What Changes

- **Inline the 19 expert templates.** Each `.tmpl` body becomes an inline template string inside `src/core/templates/experts/<name>.ts`; the getters stop reading files from disk (`readFileSync` → inline `instructions`).
- **Lift the shared blocks into TS constants.** The 14 generator functions actually referenced by surviving templates (`PREAMBLE`, `SPEC_REVIEW_LOOP`, `BROWSE_SETUP`, `QA_METHODOLOGY`, `DESIGN_METHODOLOGY`, `BASE_BRANCH_DETECT`, `DESIGN_REVIEW_LITE`, `TEST_BOOTSTRAP`, `TEST_COVERAGE_AUDIT_REVIEW`, `ADVERSARIAL_STEP`, `DESIGN_SKETCH`, `PLAN_FILE_REVIEW_REPORT`, `COMMAND_REFERENCE`, `SNAPSHOT_FLAGS`) become exported constants in a new `src/core/templates/experts/_shared.ts`, referenced by `${…}` interpolation. Dead resolvers not used by any surviving template are dropped.
- **Delete the generator toolchain.** Remove `scripts/gen-skill-docs.ts`, the `gen:skill-docs` and `skill:check` package.json scripts, the `bun run gen-skill-docs` block in `build.js`, all committed `skills/**/SKILL.md` generated files, all `skills/**/SKILL.md.tmpl` sources, and the orphaned root `skills/gstack/SKILL.md.tmpl` (which has no getter). **BREAKING** for anyone invoking `bun run gen:skill-docs` / `skill:check`. (bun itself is retained — `build:browse` still uses it.)
- **Unify the freshness gate.** The 19 experts enter the `skill-templates-parity.test.ts` golden-master (function-payload hashes + generated-content hashes), the same gate the workflow skills use. `skill:check` is retired.
- **Rebrand the expert skill names.** `dirName` `openspec-gstack-<name>` → `openspec-<name>`; `SkillTemplate.name` `gstack:<name>` → `openspec:<name>`. Update every reference point: `src/core/shared/skill-generation.ts`, `experts/*.ts`, `_orchestration.ts`, `review-cycle.ts`, `pipelines/*.yaml`, tests, and docs/AGENTS.md.
- **Rename the sidecar source directory.** `skills/gstack/` → `skills/experts/`, now holding only sidecar reference files (`.md`/`.sh`), with `SKILL.md`/`SKILL.md.tmpl` removed. Sidecar-less expert dirs are deleted entirely. `copySkillSidecars` source path updated.
- **Prune rename orphans on install.** `openspec init`/`update` do not remove installed skill dirs for renamed skills; add cleanup that removes any installed `openspec-gstack-*` directory (the retired prefix) so the 19 renames do not leave 19 orphans in `.claude/skills`.

## Capabilities

### New Capabilities
- `expert-template-inlining`: Expert instructions are sourced from inline TS template strings and shared TS constants (no runtime file read, no generator); the 19 experts are covered by the parity golden-master; the build no longer invokes a skill-doc generator.

### Modified Capabilities
- `skill-name-prefix`: Expert skill names/dirNames drop the `gstack` brand (`openspec:<name>` / `openspec-<name>`).
- `gstack-skills-integration`: Source of truth for expert prompts moves from `.tmpl` + generated `SKILL.md` to inline TS; the source dir holds only sidecars.
- `skill-sidecar-install`: Sidecar source path (`skills/experts/<workflowId>/`) and installed dirNames (`openspec-<name>`) updated.
- `review-cycle-workflow`: Review engine referenced as `openspec-review` (was `openspec-gstack-review`).
- `navigator-router-skill`: Navigator sourced from `experts/navigator.ts` inline (not `.tmpl`); dirName `openspec-navigator`.
- `add-grill-expert-skills`: `codebase-design`/`tdd`/`prototype` sourced inline; dirNames/names rebranded; sidecars under `skills/experts/`.
- `methodology-expert-fusion`: Drops references to the deleted generator/`skill:check`; expert dirNames rebranded; prototype capture guidance describes the inline getter, not a generated file.
- `investigate-diagnosing-absorption`: `openspec-investigate` dirName.
- `review-two-axis-absorption`: `openspec-review` dirName.
- `legacy-cleanup`: Adds pruning of retired `openspec-gstack-*` installed skill directories on init/update.

### Removed Capabilities
- `gen-skill-docs-path-migration`: The generator whose path handling this specced is deleted; all requirements removed.
- `skill-template-generator`: The `scripts/gen-skill-docs.ts` generator this specced is deleted; all requirements removed.
- `methodology-skill-tool-scoping`: Its sole requirement constrained `allowed-tools` on the deleted `codebase-design` `.tmpl`; `allowed-tools` never reached the installed skill via the TS pipeline, so the constraint has no surviving artifact. Requirement removed (see delta Reason/Migration).

## Impact

- **Source:** `src/core/templates/experts/*.ts` (19 files + new `_shared.ts`), `src/core/shared/skill-generation.ts` (registry rename), `src/core/templates/workflows/_orchestration.ts` + `review-cycle.ts` (delegation name), `build.js` (drop generator step), `package.json` (drop 2 scripts).
- **Deleted:** `scripts/gen-skill-docs.ts`; all `skills/**/SKILL.md` and `skills/**/SKILL.md.tmpl`; sidecar-less `skills/gstack/<name>/` dirs; `skills/gstack/` renamed to `skills/experts/`.
- **Tests:** `test/core/templates/skill-templates-parity.test.ts` (add 19 experts to golden-master), `test/commands/review-cycle.test.ts` + `pipeline.test.ts` + `core/pipeline-registry/pipeline.test.ts` (renamed skill strings), `test/core/shared/skill-sidecar-install.test.ts` (renamed dirs/paths), `test/core/shared/skill-generation.test.ts` (counts unchanged at 19; string assertions rebranded).
- **Data/config:** `pipelines/*.yaml` (`gstack:review`/`gstack:cso` → `openspec:*`), `skills/experts/docs/AGENTS.md` (skill rows).
- **Install side:** `.claude/skills/openspec-gstack-*` orphans pruned on next `update`.
- **Archive NOTE (zero-requirement specs):** After removing all requirements from `gen-skill-docs-path-migration`, `skill-template-generator`, and `methodology-skill-tool-scoping`, each holds zero requirements. Per the `fuse-methodology-into-opsx` precedent, the apply/archive step must delete these now-empty main spec files by hand (the archiver does not remove a spec that drops to zero requirements). Their `## Purpose` lines are removed with the files.
- **Archive NOTE (Purpose-line adjustments on modified specs):** Several modified specs have `## Purpose` lines that still describe the retired mechanics — `skill-name-prefix` ("`gstack:` skill names and `openspec-gstack-` dirNames"), `gstack-skills-integration` ("SKILL.md.tmpl source files and generated SKILL.md files"), `skill-sidecar-install` ("`skills/gstack/<workflowId>/`" implied), and `navigator-router-skill`/`add-grill-expert-skills`/`methodology-expert-fusion`/`review-cycle-workflow` (gstack names / `.tmpl` phrasing). Delta specs do not carry Purpose lines, so at sync/archive the apply step must also hand-edit these `## Purpose` lines to the new scheme (drop `gstack`, say inline TS instead of `.tmpl`). This is prose-only and does not change any requirement.
- **Archive NOTE (historical citations, out of scope):** The removal specs `dead-stub-removal`, `eureka-telemetry-removal`, `remove-gstack-features`, `preamble-migration`, `branding-migration`, `remove-gstack-upgrade-skill`, `remove-parallel-lifecycle-skills`, `remove-setup-browser-cookies-skill`, and `browse-skill-ethos-cleanup` cite `scripts/gen-skill-docs.ts` and `SKILL.md.tmpl` as the historical site where a prior cleanse removed content. Those content guarantees (no upgrade check, minimal preamble, no `CC+gstack` branding, etc.) remain satisfied by the migrated TS; only the file-path phrasing goes stale. No requirement of theirs becomes false, so they are not re-specified here. Refreshing their prose is deferred to a housekeeping change.
