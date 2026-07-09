## Why

Change 1 collapsed gstack's parallel lifecycles; the remaining 20 experts are now a pure expert layer. But four methodology experts introduced in phase0c — `domain-modeling`, `codebase-design`, `tdd`, `prototype` — have registration wiring and zero OPSX consumers: no workflow template or pipeline references them, and their artifacts (ADRs, CONTEXT.md, prototypes) land in gstack-native paths outside the change directory. They live in a parallel world. The user's axis is the OpenSpec workflow, so this change fuses the valuable methodology into the workflow — as teaching-level references the workflow templates reach for conditionally, with artifacts captured in the change directory — rather than leaving them as unreferenced standalone skills.

While auditing, a live defect surfaced: `schemas/spec-driven/schema.yaml` still sets three artifact `enhance:` hooks to the now-deleted plan-review skills (`plan-ceo-review`, `plan-design-review`, `plan-eng-review`), so `openspec instructions` currently tells users to invoke skills that no longer exist. The surviving `codex` skill and `gen-skill-docs.ts` also carry dead plan-review references (change 1's dangling-reference grep scoped `src/skills/docs`, missing `scripts/` and `schemas/`). This change fixes those too, and completes the archiver's flagged tail of stale-example specs.

## What Changes

- **Fuse the four methodology experts into the workflow (teaching-level, conditional):**
  - `/opsx:propose` — for design-dense or domain-heavy changes, the template SHALL point the planner at `/codebase-design` (deep-module/interface design, design-it-twice) and `/domain-modeling` (sharpen domain language, record decisions), with the resulting ADRs / domain decisions captured in the change directory's `design.md` Decisions section (or a change-directory sidecar), not gstack-native paths.
  - `/opsx:apply` — the template SHALL mention `/tdd` as an implementation discipline option (red→green at agreed seams, tests worth keeping) and `/careful` for changes touching destructive operations.
  - `/opsx:explore` — the template SHALL mention `/prototype` as a hands-on way to settle a stuck design question, capturing the answer in the change directory and deleting the throwaway code.
- **Retarget the spec-driven schema's `enhance` hooks to existing skills** (live bug fix): `schemas/spec-driven/schema.yaml` — `proposal` and `specs` drop their broken `enhance` (no surviving plan/proposal reviewer), and `design` retargets to `codebase-design` (a clean fusion fit). See design.md open question — this is the primary gate decision.
- **Remove dead references to the deleted plan-review skills** from live surfaces: the `generatePlanFileReviewReport` section in `scripts/gen-skill-docs.ts` (consumed by the surviving `codex` skill via `{{PLAN_FILE_REVIEW_REPORT}}`) drops its `plan-ceo-review` / `plan-eng-review` / `plan-design-review` bullets; the dead `{{TEST_COVERAGE_AUDIT_PLAN}}` mode/comment (no surviving consumer) is removed; `skills/gstack/docs/ARCHITECTURE.md`'s stale `BASE_BRANCH_DETECT` example list is corrected. Re-render + `skill:check`.
- **Fix all seven stale-example main specs** flagged by the archiver, judged per-requirement (gate overruled the planner's fix-4-keep-3, 2026-07-07): MODIFIED deltas swap the `plan-ceo-review` example to a surviving skill in `artifact-graph`, `schema-enhance-field`, `instruction-loader`, and narrow `preamble-migration`/`dead-stub-removal`/`skill-name-prefix` to surviving artifacts; REMOVED deltas drop requirements that are entirely about deleted skills (`ship-portability` in full; `dead-stub-removal`'s retro global-mode requirement). Main specs are current truth; the historical record stays in the archived change directories.
- **Audit the remaining experts** (`careful`, `guard`, `freeze`, `unfreeze`, `design-consultation`, `codex`, `navigator`, `browse`) — every one mapped to a concrete fusion action or an argued keep-as-pure-expert in the design.md matrix.
- No new parallel entry points; no removed skills revived; the four methodology experts remain standalone-invokable (the fusion adds workflow references, it does not de-register them).

## Capabilities

### New Capabilities
- `methodology-expert-fusion`: the workflow templates (`/opsx:propose`, `/opsx:apply`, `/opsx:explore`) reference the methodology experts conditionally with artifacts captured in the change directory; the spec-driven `enhance` hooks and all workflow/generator/doc surfaces reference only skills that exist.

### Modified Capabilities
- `artifact-graph`: the `enhance` example in the Schema Loading requirement moves off the removed `plan-ceo-review` to a surviving skill.
- `schema-enhance-field`: the `plan-ceo-review` illustrative example is swapped to a surviving skill across the enhance requirements.
- `instruction-loader`: the enhance-instruction scenario's example moves off `plan-ceo-review`.
- `preamble-migration`: the deleted `plan-ceo-review` tmpl is dropped from the ETHOS-reference-removal file lookup (office-hours + ARCHITECTURE.md remain).
- `dead-stub-removal`: the skill-source scenario narrows to the surviving `codex` tmpl (MODIFIED); the retro global-mode requirement is REMOVED (retro deleted).
- `skill-name-prefix`: the naming/dirName/author requirements drop the stale "28" count, the removed-skill mapping rows, and the `gstack-upgrade` scenario (MODIFIED); the surviving prefix rules stay with representative examples.

### Removed Capabilities
- `ship-portability`: all three requirements are REMOVED — they constrain the deleted `ship` and `document-release` skills' `.tmpl` files; the release contract now lives in the `/opsx:ship` workflow template.

## Impact

- **Workflow templates edited** (parity-hash recompute in scope): `src/core/templates/workflows/{propose,explore,apply-change}.ts`. Each exports a skill and a command template; both variants get the fusion reference. `test/core/templates/skill-templates-parity.test.ts` — 6 function hashes (`getExploreSkillTemplate`, `getApplyChangeSkillTemplate`, `getOpsxProposeSkillTemplate`, `getOpsxExploreCommandTemplate`, `getOpsxApplyCommandTemplate`, `getOpsxProposeCommandTemplate`) + 3 generated-content hashes (`openspec-explore`, `openspec-apply-change`, `openspec-propose`) recomputed via the test's own recipe against the fresh dist build.
- **Live config edited**: `schemas/spec-driven/schema.yaml` (three `enhance` values). No test asserts these values (verified), so only the schema and the illustrative spec examples change.
- **Generator + docs edited**: `scripts/gen-skill-docs.ts` (`generatePlanFileReviewReport`, dead `TEST_COVERAGE_AUDIT_PLAN`), `skills/gstack/codex/SKILL.md.tmpl`→regenerated `SKILL.md` (via re-render), `skills/gstack/docs/ARCHITECTURE.md`. Gated by `bun run gen:skill-docs` + `bun run skill:check`.
- **Verification gates**: `pnpm build` + `pnpm test` (parity recompute), `bun run gen:skill-docs` + `bun run skill:check` FRESH, `openspec update --force`, `openspec config list` pollution check, whole-repo dangling-reference grep (now including `scripts/` and `schemas/`) for the removed plan-review skills, `openspec validate --strict`.
- **Out of scope**: `browse` (independent subproject); the already-wired experts (review/cso/qa/qa-only/benchmark/design-review/investigate/office-hours).
