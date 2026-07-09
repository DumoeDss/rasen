# expert-template-inlining Specification

## Purpose
Make the 19 expert skills a single-sourced TypeScript system: each expert's `SkillTemplate.instructions` is an inline template string in `src/core/templates/experts/<name>.ts` (no file-read getters, no committed generated `SKILL.md`), shared prose blocks live once in `_shared.ts`, the migration is byte-faithful to the prior output, the parity golden-master pins freshness in place of the retired skill-doc generator, and the build no longer invokes that generator.
## Requirements
### Requirement: Expert instructions are inline TypeScript, not generated files

Each expert skill template function in `src/core/templates/experts/<name>.ts` SHALL build its `SkillTemplate.instructions` from an inline TypeScript template string, and SHALL NOT read any file from disk at call time. No expert getter SHALL call `readFileSync` for a `SKILL.md` source, and no committed generated `SKILL.md` SHALL exist under the skills source tree.

#### Scenario: Getters do not read files

- **WHEN** `src/core/templates/experts/*.ts` is inspected
- **THEN** no expert getter SHALL contain a `readFileSync` call resolving a `SKILL.md` path
- **AND** each getter SHALL return `instructions` composed from an inline template string

#### Scenario: No generated SKILL.md build products remain

- **WHEN** the skills source tree is inspected
- **THEN** no `SKILL.md` and no `SKILL.md.tmpl` file SHALL exist under it

#### Scenario: Per-getter idiosyncrasies preserved

- **WHEN** the migrated expert getters are inspected
- **THEN** `getNavigatorSkillTemplate()` SHALL still set `disableModelInvocation: true` and a human-facing one-line `description`
- **AND** `getPrototypeSkillTemplate()` SHALL still append `CHANGE_CONTEXT_CAPTURE_GUIDANCE` before `STORE_SELECTION_GUIDANCE`
- **AND** every deployed expert getter SHALL still append `STORE_SELECTION_GUIDANCE` to its instructions

### Requirement: Shared instruction blocks are single-sourced TypeScript constants

The prose blocks shared across expert templates SHALL be defined once as exported constants (or pure functions) in `src/core/templates/experts/_shared.ts` and referenced by `${…}` interpolation from the expert template strings. The module SHALL provide exactly the blocks referenced by surviving templates and SHALL NOT retain resolvers unreferenced by any expert.

#### Scenario: Shared blocks exported from _shared.ts

- **WHEN** `src/core/templates/experts/_shared.ts` is inspected
- **THEN** it SHALL export `PREAMBLE`, `BROWSE_SETUP`, `SNAPSHOT_FLAGS`, `COMMAND_REFERENCE`, `BASE_BRANCH_DETECT`, `PLAN_FILE_REVIEW_REPORT`, `QA_METHODOLOGY`, `DESIGN_METHODOLOGY`, `DESIGN_REVIEW_LITE`, `TEST_BOOTSTRAP`, `TEST_COVERAGE_AUDIT_REVIEW`, `ADVERSARIAL_STEP`, `DESIGN_SKETCH`, and `SPEC_REVIEW_LOOP`
- **AND** each expert template that previously used a `{{BLOCK}}` placeholder SHALL interpolate the corresponding constant

#### Scenario: Install-time tokens preserved in PREAMBLE

- **WHEN** the resolved `PREAMBLE` constant is inspected
- **THEN** it SHALL still contain the literal install-time tokens `__OPENSPEC_PROACTIVE__` and `__OPENSPEC_REPO_MODE__`

#### Scenario: Dead resolvers not carried over

- **WHEN** `src/core/templates/experts/_shared.ts` is inspected
- **THEN** it SHALL NOT define blocks unreferenced by any expert template (e.g. `REVIEW_DASHBOARD`, `TEST_FAILURE_TRIAGE`, `TEST_COVERAGE_AUDIT_SHIP`, `BENEFITS_FROM`, `DEPLOY_BOOTSTRAP`)

### Requirement: Migration preserves each expert's installed instructions exactly

The inlined expert instructions SHALL be byte-for-byte identical to the instructions produced by the pre-migration file-reading getters. The migration SHALL be verified against a baseline captured from the pre-migration getters before the generator toolchain is deleted.

#### Scenario: Inlined output equals the pre-migration baseline

- **WHEN** the migration is verified
- **THEN** for every expert, `getSkillTemplates()`'s `instructions` for that expert SHALL equal the baseline captured from the pre-migration getter output

### Requirement: The 19 experts are covered by the parity golden-master gate

All 19 expert skill templates SHALL be pinned by `test/core/templates/skill-templates-parity.test.ts`: their function payloads in the function-hash map and their `generateSkillContent(...)` output in the generated-content-hash map. This freshness gate SHALL replace the retired `skill:check` dry-run.

#### Scenario: Expert function payloads pinned

- **WHEN** the parity test's function-payload check runs
- **THEN** it SHALL include all 19 expert getters with an expected hash for each

#### Scenario: Expert generated content pinned

- **WHEN** the parity test's generated-content check runs
- **THEN** it SHALL include all 19 expert skills with an expected `generateSkillContent(...)` hash for each

### Requirement: The build no longer invokes a skill-doc generator

`build.js` SHALL NOT invoke any skill-documentation generator, and `package.json` SHALL NOT define `gen:skill-docs` or `skill:check` scripts. `pnpm build` SHALL succeed without `bun` being present for skill-doc generation.

#### Scenario: Build has no generator step

- **WHEN** `build.js` is inspected
- **THEN** it SHALL NOT spawn `bun run scripts/gen-skill-docs.ts` (or any skill-doc generator)

#### Scenario: Package scripts drop the generator entrypoints

- **WHEN** `package.json` `scripts` is inspected
- **THEN** it SHALL NOT contain `gen:skill-docs` or `skill:check`

