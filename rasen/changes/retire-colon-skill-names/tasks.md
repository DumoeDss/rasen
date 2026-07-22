# Tasks — retire-colon-skill-names

Constraints for every task: no version bumps; never edit `packages/ui/**`; exercise CLI behavior via `node bin/rasen.js` (build first with `pnpm build`); literal rewrites use the D7 mapping table in design.md — never a blind `s/rasen:/rasen-/`.

## 1. Templates (names + instruction-body literals)

- [x] 1.1 Rename all 21 expert template names in `src/core/templates/experts/*.ts` from `name: 'rasen:<x>'` to `name: 'rasen-<x>'` (benchmark, careful, chrome-use, codebase-design, codex, cso, design-consultation, design-review, freeze, guard, investigate, navigator, office-hours, prototype, qa, qa-only, review, tdd, unfreeze, workflow-author, workflow-review) so each equals its dirName in `src/core/workflow-registry/experts.ts`
- [x] 1.2 Rewrite `/rasen:<x>` literals in instruction bodies via the D7 table: `src/core/templates/experts/_shared.ts` (verify/verify-enhanced/review-cycle/propose tokens → `/rasen-verify-change`, `/rasen-verify-enhanced`, `/rasen-review-cycle`, `/rasen-propose`), `office-hours.ts` (3 body occurrences incl. `/rasen:propose`), `review.ts` (2 occurrences: `/rasen:ship` → `/rasen-ship`)
- [x] 1.3 Grep-zero check: `rg "rasen:" src/core/templates/` returns nothing

## 2. Bundled pipeline YAMLs (same commit as templates — D2)

- [x] 2.1 Flip stage `skill:` refs in `pipelines/small-feature/pipeline.yaml` (review), `pipelines/bug-fix/pipeline.yaml` (review), `pipelines/auto-decompose/pipeline.yaml` (review), `pipelines/full-feature/pipeline.yaml` (review, cso, benchmark, design-review, qa, qa-only) from `rasen:<x>` to `rasen-<x>`
- [x] 2.2 Grep-zero check: `rg "rasen:" pipelines/` returns nothing

## 3. Legacy mapping + catalog fallback

- [x] 3.1 In `src/core/pipeline-registry/legacy-skill.ts`: add `rasen:<x>` → `rasen-<x>` branch to `mapLegacySkillId`; retarget the `openspec:<x>` branch to `rasen-<x>` (drop `NEW_SKILL_NAMESPACE`); update header comment
- [x] 3.2 In `src/core/workflow-library.ts`: on identity-lookup miss, retry with `mapLegacySkillId` result — both in the `requires.skills` resolution (~line 494-505) and in the pipeline-usage skill map consumed by `collectPipelineUsage` (~line 507-520)
- [x] 3.3 Update `test/core/legacy-namespace-detection.test.ts`: `openspec:apply` now → `rasen-apply` (hyphen), add case `mapLegacySkillId('rasen:review') === 'rasen-review'`, and `rasen-ship` still → null; add/extend a workflow-library test covering a user asset with a colon `requires.skills` ref still recording dependency usage

## 4. Live invocations + comment literals in src

- [x] 4.1 `src/core/management-api/whitelist.ts`: `skill: '/rasen:auto'` → `'/rasen-auto'`, `skill: '/rasen:goal'` → `'/rasen-goal'`; sync the doc comment in `src/core/management-api/supervisor.ts:38`
- [x] 4.2 Comment/message-only rewrites via D7 table: `src/core/archive.ts:384` (`/rasen:archive` → `/rasen-archive-change` — user-facing fix message), `src/core/claude-settings.ts:4`, `src/core/project-config.ts:1195,1243`, `src/core/pipeline-registry/run-state.ts:105` (`/rasen:handoff` → `/rasen-handoff`), `src/core/workflow-chain.ts:8` (`/rasen:verify` → `/rasen-verify-change`, `/rasen:ship` → `/rasen-ship`)
- [x] 4.3 Grep check: `rg "rasen:" src/` matches ONLY `src/utils/command-references.ts` (transformer guard, kept per D6) and `src/core/pipeline-registry/legacy-skill.ts` (legacy-detection constants)

## 5. Tests, fixtures, parity hashes

- [x] 5.1 Update colon expectations to hyphen in: `test/core/workflow-registry/validator.test.ts`, `test/core/workflow-registry/expert-digest.test.ts`, `test/core/pipeline-registry/pipeline.test.ts`, `test/core/pipeline-registry/execution-validation.test.ts`, `test/commands/pipeline.test.ts`, `test/core/workflow-package/pipeline-package.test.ts`, `test/core/shared/skill-generation.test.ts`, `test/core/templates/workflow-author-review.test.ts`, `test/core/management-api/supervisor.test.ts`, `test/core/management-api/supervisor-injection.test.ts`, `test/core/migration.test.ts` — keep colon literals ONLY where they are legacy-mapping/transformer INPUTS (`command-references.test.ts` unchanged; legacy tests keep colon inputs, hyphen outputs)
- [x] 5.2 Update `test/fixtures/workflow-registry/builtins-v1.json` (21 colon names → hyphen)
- [x] 5.3 Regenerate BOTH hash tables in `test/core/templates/skill-templates-parity.test.ts` (function payload + generated content) from actual values per D10 — expect every expert hash and any `_shared.ts`-consuming workflow hash to change
- [x] 5.4 Confirm `test/ui/welcome-screen.test.ts` (`/rasen:` absence guard) still passes unmodified

## 6. Governance spec sweep (main specs)

- [x] 6.1 Sweep `rasen:` colon tokens in `rasen/specs/**/spec.md` (~140 across 41 files) to hyphen skill names via the D7 table — behavior-neutral wording only; update `rasen/specs/skill-name-prefix/spec.md`'s Purpose line to the unified-hyphen wording (requirement bodies there are handled by this change's delta specs at sync/archive time — do NOT hand-edit its requirements)
- [x] 6.2 Minimal reword of enumerated false-claim line: `rasen/specs/opsx-goal-command/spec.md:14` ("CommandTemplate for `/rasen:goal`") → skill-only reality (SkillTemplate `rasen-goal`, invoked as `/rasen-goal`)
- [x] 6.3 Grep check: `rg "rasen:" rasen/specs/` — every remaining match must be a legacy-mapping/negative-assertion keep (expected: near zero; this change's own delta specs under `rasen/changes/` don't count)

## 7. Docs sweep (EN + zh)

- [x] 7.1 Rewrite all `rasen:` tokens in `docs/*.md` (~21 files incl. workflows.md, opsx-workflow-guide.md, examples.md, migration-guide.md, faq.md, concepts.md, cli.md, README.md) via the D7 table; in migration-guide old→new tables flip ONLY the "new"/rasen column, `openspec:` old forms stay
- [x] 7.2 Same sweep for `docs/zh/*.md` (~21 files, same policy)
- [x] 7.3 Grep-zero check: `rg "rasen:" docs/` returns nothing (or only lines explicitly documenting the colon→hyphen legacy mapping)

## 8. Verification

- [x] 8.1 `pnpm build` then targeted suites: `pnpm vitest run test/core/templates test/core/pipeline-registry test/core/workflow-registry test/core/management-api test/commands/pipeline.test.ts test/core/legacy-namespace-detection.test.ts test/ui/welcome-screen.test.ts`
- [x] 8.2 Full `pnpm test`; enumerate EVERY failure with file-by-file isolation/attribution (Windows EBUSY/10s-timeout flakes must be re-run isolated, never assumed)
- [x] 8.3 Behavior check via local CLI in a scratch project: `node bin/rasen.js init` fresh → every generated `.claude/skills/rasen-*/SKILL.md` frontmatter `name:` equals its directory name (grep-zero `rasen:` across generated payloads); then `node bin/rasen.js update` on a project with old colon-frontmatter skills → frontmatter regenerated to hyphen
- [x] 8.4 Legacy resolution check: a scratch project-local pipeline referencing `skill: rasen:review` → `node bin/rasen.js pipeline resume <change>` (or the covering unit test) surfaces the old→new hint and resolves to `rasen-review`
- [x] 8.5 Final repo-wide audit: `rg "rasen:" --glob '!packages/ui/**' --glob '!rasen/changes/**' --glob '!node_modules/**'` — every survivor is an enumerated keep (command-references.ts guard, legacy-skill.ts constants, legacy-test inputs, legacy-mapping docs); `rasen validate retire-colon-skill-names` passes
