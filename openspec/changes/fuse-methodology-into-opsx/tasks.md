## 1. Fuse design/domain methodology into propose

- [x] 1.1 In `src/core/templates/workflows/propose.ts`, add a short conditional reference (a few lines, no inlined body) in both `getOpsxProposeSkillTemplate()` and `getOpsxProposeCommandTemplate()`: for design-dense changes (new module, non-trivial interface) consult `/codebase-design` (deep-module design, design-it-twice); for fuzzy/overloaded domain language consult `/domain-modeling`.
- [x] 1.2 In the same reference, instruct that the resulting interface/design and domain decisions are captured in the change directory — the change's `design.md` Decisions section (or a change-directory sidecar resolved from `openspec status --json` `changeRoot`) — not in root `CONTEXT.md` / `docs/adr/`.
- [x] 1.3 Keep both propose variants otherwise identical to each other in the fused text (they duplicate content today); verify no methodology body is copied inline.

## 2. Fuse tdd/careful into apply

- [x] 2.1 In `src/core/templates/workflows/apply-change.ts`, add to both `getApplyChangeSkillTemplate()` and `getOpsxApplyCommandTemplate()` a conditional mention of `/tdd` as a test-first implementation option (agree seams up front, red→green, tests worth keeping).
- [x] 2.2 Add one guardrail line pointing at `/careful` for changes touching destructive operations (rm -rf / DROP TABLE / force-push). No inlined bodies.

## 3. Fuse prototype into explore

- [x] 3.1 In `src/core/templates/workflows/explore.ts`, add to both `getExploreSkillTemplate()` and `getOpsxExploreCommandTemplate()` a conditional mention of `/prototype` to settle a stuck design question, capturing the answer in the change directory and deleting the throwaway code afterward. (Consistent with explore's "capture, don't implement" stance.)

## 4. Retarget the spec-driven enhance hooks (live bug fix)

- [x] 4.1 In `schemas/spec-driven/schema.yaml`, remove the `enhance: plan-ceo-review` line from the `proposal` artifact and the `enhance: plan-design-review` line from the `specs` artifact (no surviving skill reviews a proposal/spec — see design D3/Open Question 1).
- [x] 4.2 Change the `design` artifact's `enhance: plan-eng-review` to `enhance: codebase-design` (fusion fit).
- [x] 4.3 Verify `openspec instructions proposal|specs|design --change <any> --json` no longer emits an `enhance` naming a removed skill (proposal/specs have no `<enhance>` section; design names `codebase-design`).
- [ ] 4.4 (Gate-dependent — N/A) The gate chose the primary option in Open Question 1 (drop `enhance` from proposal/specs, design→`codebase-design`), so this alternative branch does not apply.

## 5. Remove dead plan-review references from generator and docs

- [x] 5.1 In `scripts/gen-skill-docs.ts` `generatePlanFileReviewReport` (~lines 1064-1130), delete the `plan-ceo-review`, `plan-eng-review`, and `plan-design-review` field bullets (~1081-1087); keep the `codex-review` bullet (codex survives).
- [x] 5.2 Remove the dead `{{TEST_COVERAGE_AUDIT_PLAN}}` mode and its comment (~line 1293) — grep confirmed no surviving `.tmpl` consumes it; verify with a repo grep before deleting, and drop the placeholder registration if present.
- [x] 5.3 In `skills/gstack/docs/ARCHITECTURE.md` (~line 203), fix the `{{BASE_BRANCH_DETECT}}` consumer example list `(ship, review, qa, plan-ceo-review)` → `(review, qa)` (ship + plan-ceo-review removed).
- [x] 5.4 `bun run gen:skill-docs` (and `--host codex` if applicable) so `skills/gstack/codex/SKILL.md` regenerates without the plan-review bullets; `bun run skill:check` must be FRESH.

## 6. Recompute parity hashes

- [x] 6.1 After `pnpm build`, recompute the 6 function hashes (`getExploreSkillTemplate`, `getApplyChangeSkillTemplate`, `getOpsxProposeSkillTemplate`, `getOpsxExploreCommandTemplate`, `getOpsxApplyCommandTemplate`, `getOpsxProposeCommandTemplate`) and 3 generated-content hashes (`openspec-explore`, `openspec-apply-change`, `openspec-propose`) in `test/core/templates/skill-templates-parity.test.ts`, using the test's own recipe against the fresh dist build. Review the template diffs so each hash change reflects only the intended fusion edits.

## 7. Build, test, install, and guard

- [x] 7.1 `pnpm build` — tsc compiles clean.
- [x] 7.2 `pnpm test` — all green, including the recomputed parity test. Isolate-rerun known Windows temp-dir flakes (EBUSY/EPERM/timeout on untouched files); green on isolated rerun passes; record it.
- [x] 7.3 `openspec update --force`, then confirm the regenerated opsx propose/apply/explore skills carry the fusion references and resolve to existing skills.
- [x] 7.4 `openspec config list` — confirm the real global config was not polluted by the test run.
- [x] 7.5 Whole-repo dangling-reference grep over `src/`, `skills/`, `docs/`, `scripts/`, `schemas/` for `plan-ceo-review`, `plan-eng-review`, `plan-design-review` — no match outside `openspec/changes/archive/`. (This scope now includes `scripts/` and `schemas/`, which change 1's grep missed.)
- [x] 7.6 `openspec validate fuse-methodology-into-opsx --strict` — must pass.

## 8. Stale-example spec deltas (all 7, spec-only — no code)

All seven archiver-flagged specs get deltas (gate overruled fix-4-keep-3, 2026-07-07). These are spec-only artifacts synced into the main specs at archive — no main-spec hand edit during apply.

- [x] 8.1 MODIFIED example-swaps (already written): `artifact-graph`, `schema-enhance-field`, `instruction-loader` (`plan-ceo-review` example → `review`), `preamble-migration` (drop deleted `plan-ceo-review` tmpl from the ETHOS lookup).
- [x] 8.2 `dead-stub-removal` (already written): MODIFIED the skill-source-stubs requirement to the surviving `codex` tmpl + REMOVED the retro global-mode requirement.
- [x] 8.3 `skill-name-prefix` (already written): MODIFIED all three requirements — drop the "28" count, removed-skill mappings, and the `gstack-upgrade` scenario; keep the live prefix/dirName/author rules.
- [x] 8.4 `ship-portability` (already written): REMOVED all three requirements (entirely about deleted `ship`/`document-release`).
- [ ] 8.5 At archive, confirm the sync applied the deltas: the MODIFIED requirements replace their main-spec counterparts, the REMOVED requirements are gone, and `ship-portability` (now empty) is dropped from `openspec/specs/`. No live main spec should reference `plan-ceo-review`, `plan-eng-review`, `plan-design-review`, `ship`, `retro`, or `document-release` outside historical scenarios that survived as MODIFIED.
