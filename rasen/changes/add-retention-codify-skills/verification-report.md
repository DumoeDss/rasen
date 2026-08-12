# Verification Report: add-retention-codify-skills

Schema: spec-driven. Verified against proposal, design, all delta specs, and tasks.

## Summary

| Dimension | Status |
|-----------|--------|
| Completeness | 53/53 tasks complete; 10 delta-spec capabilities covered |
| Correctness | All requirements mapped to implementation + tests |
| Coherence | Design decisions followed; 1 design-level guard deferred (noted) |

**VERIFY VERDICT: CLEAN — Blocker:0 Major:0 Minor:2 Trivial:0**

CLEAN = no Blocker and no Major open. Two Minor items are follow-ups, not archive blockers.

## Completeness

- **Tasks:** `tasks.md` is 53/53 complete (`rasen status`/`instructions apply` report `all_done`, `complete: 53`).
- **Capabilities (delta specs) → evidence:**
  - `profiles` (retention dimension, v2, mutually-exclusive radio) — `src/core/retention.ts`, `src/core/named-profiles.ts` (v1 reader + v2 schema `retention: z.enum(RETENTION_MODES)`), profile editor. Tests: profile suites (S1).
  - `learned-skills` (core registry, candidate/manifest, id, applicability, stores, mutate, resolve) — `src/core/learned-skills/*`. Tests: `learned-skills/mutate.test.ts` (9), `validation.test.ts` (18).
  - `workflow-library` (retain-command internal, retro not selectable, shallow router) — `src/core/workflow-registry/builtins.ts` (`INTERNAL_BUILTIN_WORKFLOW_IDS=['retain-command']`, kind `internal`; not in `BUILT_IN_WORKFLOW_IDS`), `skills/workflows/rasen-retain/{report,codify}.md`.
  - `opsx-auto-command` / full-feature tail — `pipelines/full-feature/pipeline.yaml` (`ship → retain → archive`, retain `requires: [ship]`), `auto-command.requires.workflows: ['retain-command']`.
  - `opsx-retro-command` — report contract lives in `skills/workflows/rasen-retain/report.md`; `getRetroCommandSkillTemplate()` returns the `disable-model-invocation` compat wrapper.
  - `cli-init` — `src/core/init.ts` `reconcileLearnedSkills()` + `generateRetroCompatWrapper()`.
  - `cli-update` — `src/core/update.ts` reconciliation, separate learned summary, retro cleanup, no tool onboarding.
  - `archive-quality-capture` / `cli-archive` — `src/core/archive.ts` (no `[RULE]`/`quality-rules` mutation; retain-before-archive).
  - `navigator-router-skill` — `src/core/templates/experts/navigator.ts` (`ship → retain → archive`, retro-as-alias).

## Correctness (requirement → implementation, spot-verified)

- **Init materializes applicable learned skills; learned ids stay out of workflow selection.** `reconcileProjectLearnedSkillsForTool` filters by `matchesApplicability`; ledger `workflows` never gains a learned id. Tests: `learned-skill-materialization.test.ts`, `init-update-learned.test.ts` (`ledger.workflows` asserted to exclude the id), `retention-codify-e2e.test.ts`.
- **Exact-ownership refresh/prune; human collision preserved byte-for-byte.** Reconcile core keys on recorded path + sha256; unowned targets are skipped. Tests: materialization suite (collision + user-edited-copy), E2E adversarial (human dir untouched).
- **Global-only home (Hermes):** project-scoped skipped with a warning; all active global records reconciled via the machine-global ledger independent of a single project's markers. Tests: materialization suite (2 Hermes cases) — includes "another project's non-matching markers do not remove the shared copy".
- **Update reconciles without onboarding; learned-only change is not "Already up to date"; separate summary.** `reconcileLearnedSkills` iterates only configured tools; `learnedReconcileHasActivity` gates the short-circuit; `displayLearnedSummary` is separate from the workflow summary. Tests: `init-update-learned.test.ts`.
- **Legacy retro cleanup by named identity; wrapper preserved.** `RETIRED_RETENTION_SKILL_DIRS` (empty this window) + `pruneRetiredRetentionSkillDirs(..., [RETRO_COMPAT_WRAPPER_DIR_NAME])`. Test: materialization suite (preserve wrapper, remove exact retired dir, leave similarly named dir).
- **Archive stops codifying; preserves quality-rules and scanning.** `captureQuality` drops `[RULE]`/config mutation/`rulesExtracted`; keeps files+metrics. Tests: `archive.test.ts` (+4: byte-equivalent rules, no key created, no extracted count, retro.md archived).
- **Global promotion gated by two-project evidence + explicit approval; prompt-like evidence stored as tuples, no scope escalation.** `mutate.ts` gate + `knowledge apply`. Tests: `knowledge.test.ts` (13), `mutate.test.ts`, E2E adversarial.

## Coherence

- Design decisions followed: separate two-layer registry (D3), deep plan/commit interface + CLI adapter (D4), project-default/global-promotion (D5), context-first names (D6), rewrite-not-append + exact ownership (D7), untrusted evidence (D8), exact-ledger materialization + separate global-only ledger (D9), archive rule-extraction removal without touching existing rules (D10).
- New modules follow project conventions: `path.join`/`resolve`/`relative` throughout (no hard-coded separators), ledger stores project-relative paths in POSIX form, atomic temp+rename for the global ledger.

## Findings

### Minor

1. **`LEARNED_SKILL_ACTIVE_DESCRIPTION_BUDGET` is defined but never enforced.**
   - `src/core/learned-skills/constants.ts` defines the aggregate always-loaded-description budget (design D7 / the "context grows as learned skills accumulate" risk mitigation), but no code references it. The two persistence-gating budgets the specs actually require (`LEARNED_SKILL_CONTEXT_BUDGET`, `LEARNED_SKILL_CONTENT_BUDGET`) are enforced in `mutate.ts`; the per-materialization-set description budget is not.
   - No delta-spec scenario mandates enforcing it (the `learned-skills` "context budgets" requirement names only CONTEXT and CONTENT), and the constant is documented as "MAY evolve", so this is a deferred design guard rather than a spec violation — hence Minor.
   - **Recommendation:** either enforce it in `reconcileProjectLearnedSkillsForTool` (sum active materialized descriptions, skip/warn when a materialization set would exceed it) or explicitly mark the constant as reserved-for-future in its doc comment so it is not read as live enforcement. `src/core/learned-skills/constants.ts` + `src/core/learned-skill-materialization.ts`.

2. **No test pins the ledger cross-section preservation invariant.**
   - `syncWorkflowArtifactLedger` was changed (6.1) to preserve a tool's `learned` section when re-syncing `workflows`, and `persistToolLearnedArtifacts` preserves `workflows` when writing `learned`. Both are correct by inspection, but no test asserts a tool carrying **both** a workflow entry and a learned entry keeps both across a `syncWorkflowArtifactLedger` re-sync (the direction is exercised only indirectly). A future regression would silently drop one section.
   - **Recommendation:** add a case in `test/core/workflow-artifact-ledger.test.ts` that seeds a `learned` entry, calls `syncWorkflowArtifactLedger` with a changed workflow set, and asserts the `learned` entry survives; and a case asserting `persistToolLearnedArtifacts` preserves an existing `workflows` map.

### Trivial
None.

## Test results

This verification ran the full suite this session (`env -u ZSH pnpm test`): 243 files pass, 1 fail (4297 tests pass, 11 skipped). The single failure is `test/specs/source-specs-normalization.test.ts` flagging the archive placeholder in `rasen/specs/profile-http-api/spec.md` — confirmed present at base commit `712fd426` and untouched by this branch, i.e. pre-existing and out of scope. `pnpm build`, `pnpm exec tsc --noEmit`, `pnpm lint`, `rasen validate ... --strict`, and `npm pack --dry-run --json` (retain sidecars + all three locale catalogs present, no canonical machine data) all pass.

No machine `TEST EVIDENCE` block is emitted because the suite is not cleanly green (the documented pre-existing failure), so `rasen-ship` should re-run tests rather than skip on this report.

## Final assessment

All 53 tasks complete and every delta-spec capability maps to implementation and tests. No critical or should-fix issues. Two Minor follow-ups are recorded above. Ready for archive; the Minor items may be addressed before or after at the team's discretion.
