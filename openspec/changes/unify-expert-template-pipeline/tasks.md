## 1. Preconditions and content baseline

- [x] 1.1 Confirm the other session's `ship-delivery-modes` edits to `workflows/{ship,auto,_orchestration,review-cycle}.ts` have landed; rebase this work onto their committed content before touching `_orchestration.ts`/`review-cycle.ts`. (git log shows 50ec7d8 + archive 2161e21; working tree clean.)
- [x] 1.2 Capture the pre-migration baseline: run a throwaway script that prints, for all 19 experts, `getSkillTemplates()`'s `instructions` (the current file-reading getters' output) to a scratch file. This is the D7 equality target.
- [x] 1.3 Snapshot the current generator output for the two code-derived blocks (`COMMAND_REFERENCE`, `SNAPSHOT_FLAGS`) as produced by `scripts/gen-skill-docs.ts` for the claude host, to freeze as static constants. (Extracted from committed browse `SKILL.md` — the generator's own output.)

## 2. Shared blocks module (`src/core/templates/experts/_shared.ts`)

- [x] 2.1 Create `_shared.ts` and port `PREAMBLE`, verifying the literal `__OPENSPEC_PROACTIVE__` / `__OPENSPEC_REPO_MODE__` tokens are preserved. (Frozen as the resolved composite of the four `generatePreamble` sub-parts; tokens asserted present by the generator script.)
- [x] 2.2 Port `BROWSE_SETUP` with claude-host paths hardcoded (`.openspec/skills`, `~/.openspec/browse/dist`).
- [x] 2.3 Freeze `COMMAND_REFERENCE` and `SNAPSHOT_FLAGS` as static constants from the 1.3 snapshot; label them as a snapshot of browse command metadata.
- [x] 2.4 Port the remaining referenced blocks: `BASE_BRANCH_DETECT`, `PLAN_FILE_REVIEW_REPORT`, `QA_METHODOLOGY`, `DESIGN_METHODOLOGY`, `DESIGN_REVIEW_LITE`, `TEST_BOOTSTRAP`, `TEST_COVERAGE_AUDIT_REVIEW`, `ADVERSARIAL_STEP`, `DESIGN_SKETCH`, `SPEC_REVIEW_LOOP`. Copy nested triple-backtick fences and escaped backticks verbatim.
- [x] 2.5 Do NOT port dead resolvers (`REVIEW_DASHBOARD`, `TEST_FAILURE_TRIAGE`, `TEST_COVERAGE_AUDIT_SHIP`, `BENEFITS_FROM`, `DEPLOY_BOOTSTRAP`, the codex-host `CODEX_REVIEW_STEP` alias/helpers). (`_shared.ts` exports exactly the 14 referenced blocks.)
- [x] 2.6 Verify each ported block's resolved text is byte-identical to the generator's current output for that block. (Extracted directly from the committed generator output; full per-expert reconstruction asserted equal.)

## 3. Inline the 19 expert templates (batched; compare to baseline after each batch)

- [x] 3.1 Batch A (no placeholder or `${PREAMBLE}` only): `careful`, `cso`, `guard`, `unfreeze`, `codebase-design`, `tdd`, `prototype`, `investigate`, `navigator` — replace `readFileSync` with the inline `.tmpl` body, rewrite `{{PREAMBLE}}`→`${PREAMBLE}`, set `name: 'openspec:<name>'`. Preserve `navigator`'s real description + `disableModelInvocation`, and `prototype`'s `CHANGE_CONTEXT_CAPTURE_GUIDANCE` append.
- [x] 3.2 Batch B (browse family): `benchmark`, `browse`, `design-consultation`, `design-review`, `office-hours`, `qa`, `qa-only` — inline bodies with `${BROWSE_SETUP}` and their other blocks (`QA_METHODOLOGY`, `DESIGN_METHODOLOGY`, `TEST_BOOTSTRAP`, `DESIGN_SKETCH`, `SPEC_REVIEW_LOOP`, `SNAPSHOT_FLAGS`, `COMMAND_REFERENCE`).
- [x] 3.3 Batch C (review/codex): `codex` (`${BASE_BRANCH_DETECT}`, `${PLAN_FILE_REVIEW_REPORT}`), `review` (`${BASE_BRANCH_DETECT}`, `${DESIGN_REVIEW_LITE}`, `${TEST_COVERAGE_AUDIT_REVIEW}`, `${ADVERSARIAL_STEP}`).
- [x] 3.4 After each batch, assert the new `getSkillTemplates()` `instructions` equals the 1.2 baseline for those experts; fix any whitespace/escaping drift. (All 19 verified: 16 byte-identical, 3 identical modulo CRLF→LF — see design D7 apply-time note.)
- [x] 3.5 Preserve the pre-existing `description: '|'` on every getter except `navigator` (behavior-preserving; do not "fix" it in this change).

## 4. Rebrand identifiers across the codebase

- [x] 4.1 `src/core/shared/skill-generation.ts`: rename all 19 expert `dirName`s `openspec-gstack-<name>` → `openspec-<name>`.
- [x] 4.2 `src/core/templates/workflows/_orchestration.ts` and `review-cycle.ts`: `openspec-gstack-review` → `openspec-review` (all occurrences, incl. the skill description string).
- [x] 4.3 `pipelines/*.yaml`: `gstack:review` → `openspec:review`, `gstack:cso` → `openspec:cso` (and any other `gstack:<name>` stage refs). (All four pipelines: `skill: gstack:*` → `skill: openspec:*`.)
- [x] 4.4 Tests: update `test/commands/review-cycle.test.ts`, `test/commands/pipeline.test.ts`, `test/core/pipeline-registry/pipeline.test.ts`, `test/core/shared/skill-sidecar-install.test.ts`, and `test/core/shared/skill-generation.test.ts` string assertions to the new names/dirNames (counts stay at 19). (skill-generation.test carried no gstack strings — only the 19-count assertions, unchanged.)
- [x] 4.5 `skills/experts/docs/AGENTS.md`: update skill rows to the rebranded names. (Rows use `/name` form already; de-branded title/intro and removed the now-deleted `gen:skill-docs`/`skill:check` build refs.)

## 5. Sidecar source directory rename and strip

- [x] 5.1 Rename `skills/gstack/` → `skills/experts/`. (git mv, preserves history.)
- [x] 5.2 Delete `SKILL.md` and `SKILL.md.tmpl` from every expert dir, and delete the orphan root `skills/experts/SKILL.md.tmpl` (no getter). (40 files: 19 pairs + root SKILL.md/.tmpl.)
- [x] 5.3 Delete expert dirs that have no sidecars (verify per-dir). **Corrected per-dir verification** (using `copySkillSidecars`'s `.md`/`.sh` filter): deleted `benchmark`, `codex`, `cso`, `design-consultation`, `design-review`, `guard`, `navigator`, `office-hours`, `qa-only`, `unfreeze`. Kept `careful` (has `bin/check-careful.sh`) — the task's expected list wrongly included it and omitted `design-review`/`office-hours`.
- [x] 5.4 Update `copySkillSidecars` in `skill-generation.ts` to resolve `skills/experts/<workflowId>` (was `skills/gstack/<workflowId>`); keep the `browse` skip.
- [x] 5.5 Confirm `skills/experts/docs/` (AGENTS.md, ARCHITECTURE.md, BROWSER.md) and the `browse` tree are intact.

## 6. Delete the generator toolchain

- [x] 6.1 Delete `scripts/gen-skill-docs.ts`.
- [x] 6.2 Remove `gen:skill-docs` and `skill:check` from `package.json` `scripts`.
- [x] 6.3 Remove the `if (existsSync('skills')) { … bun run … gen-skill-docs … }` block from `build.js`.

## 7. Freshness gate and orphan prune

- [x] 7.1 Extend `test/core/templates/skill-templates-parity.test.ts`: add all 19 experts to the function-payload factories/`EXPECTED_FUNCTION_HASHES` and to `GENERATED_SKILL_FACTORIES`/`EXPECTED_GENERATED_SKILL_CONTENT_HASHES`.
- [x] 7.2 Recompute the golden-master hashes from the test's failure output and paste them in (only after task 3.4 confirms no drift). (Computed post-migration; parity test green.)
- [x] 7.3 Implement the orphan prune (legacy-cleanup): on `init`/`update`, remove installed skill directories matching exactly the retired `openspec-gstack-` prefix; idempotent; scoped so it cannot touch `openspec-*` non-gstack dirs. (`pruneRetiredExpertSkillDirs` in `legacy-cleanup.ts`, called from both `init.ts` and `update.ts` skill-generation paths.)
- [x] 7.4 Add/adjust a test asserting the orphan prune removes an `openspec-gstack-review/` fixture and leaves `openspec-review/` and unrelated dirs intact. (4 cases in `legacy-cleanup.test.ts`.)

## 8. Zero-requirement spec files and Purpose lines (at sync/archive)

- [x] 8.1 After syncing deltas to main specs, hand-delete the now-empty spec files `openspec/specs/gen-skill-docs-path-migration/spec.md`, `openspec/specs/skill-template-generator/spec.md`, and `openspec/specs/methodology-skill-tool-scoping/spec.md` (archiver leaves zero-requirement specs behind). _(deferred to archive — accurately captured in proposal.md "Archive NOTE (zero-requirement specs)"; not performed during apply.)_
- [x] 8.2 Hand-edit the `## Purpose` lines of the modified specs (`skill-name-prefix`, `gstack-skills-integration`, `skill-sidecar-install`, `navigator-router-skill`, `add-grill-expert-skills`, `methodology-expert-fusion`, `review-cycle-workflow`) to drop `gstack` and say inline TS instead of `.tmpl`. _(deferred to archive — accurately captured in proposal.md "Archive NOTE (Purpose-line adjustments on modified specs)"; not performed during apply.)_

## 9. Verification

- [x] 9.1 `pnpm build` succeeds (no bun invoked for skill docs; `build:browse` still available separately). (build.js generator step removed; tsc build green.)
- [x] 9.2 Targeted tests green: parity, `review-cycle`, `pipeline`, `pipeline-registry`, `skill-sidecar-install`, `skill-generation`. (219 tests, incl. legacy-cleanup prune.)
- [x] 9.3 `pnpm test` full run green (isolate and re-run any Windows temp-dir flakiness on untouched files). (2089 passed / 22 skipped; 2 git-heavy `store-lifecycle.test.ts` timeouts under full-suite load, both green on isolated re-run — known Windows flakiness, untouched files.)
- [x] 9.4 `node ./bin/openspec.js validate unify-expert-template-pipeline --strict` passes.
- [x] 9.5 Sanity-check an `openspec init` into a scratch dir: expert skills install as `openspec-<name>/` with sidecars, no `openspec-gstack-*` dirs, and no `SKILL.md.tmpl` copied. (Verified; also confirmed `update` prunes a planted `openspec-gstack-review` orphan while keeping `openspec-review`.)
