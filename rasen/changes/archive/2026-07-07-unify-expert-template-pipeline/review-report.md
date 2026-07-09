# Review Report — unify-expert-template-pipeline

**Reviewer:** reviewer-unify (independent non-author gate)
**Engine:** `openspec-gstack-review` skill (two-axis review contract)
**Date:** 2026-07-07

## Git state the review ran against

- **HEAD:** `2161e21c14532fb82935faf84497c7dcfa9e1161` (`chore(openspec): archive reconcile-fusion-seams`)
- **Branch:** `dev-harness`
- **Working tree:** dirty — the entire change is uncommitted. `git diff HEAD --stat` = **143 files changed, 3871 insertions(+), 14221 deletions(-)** plus 2 untracked entries (the change dir itself and the unrelated `ship-delivery-modes/` change folder).
- **Scope hygiene:** the only `src/` workflow files modified are `_orchestration.ts` and `review-cycle.ts`, and their diff is **purely** the `openspec-gstack-review` → `openspec-review` rename. The stale session-start gitStatus that showed `auto.ts`/`ship.ts` modified does NOT reflect the live tree — those are not in this diff. No `ship-delivery-modes` source bleed. (Caveat for ship stage: the untracked `openspec/changes/ship-delivery-modes/` dir belongs to a different change — do not `git add` it under this change.)

---

## Verdict: APPROVE with fixes

The change is structurally sound and the core risk (content fidelity) is independently verified clean. All gate runs pass. The two findings are both **Minor** documentation/comment staleness that do not affect any runtime code path; neither blocks shipping. Recommend fixing Finding 1 (or explicitly deferring it) before archive.

- **Standards axis:** PASS — 2 Minor findings.
- **Spec axis:** PASS — implementation matches all 14 delta specs; no missing requirements, no scope creep, no wrong implementations found.

---

## Gate runs (non-author gate evidence)

All commands run from repo root against HEAD `2161e21` + dirty working tree (above).

| Gate | Command | Result |
|---|---|---|
| Build (no bun/gen-skill-docs) | `pnpm build` | **PASS** exit 0. Output shows only `Compiling TypeScript…` — no "Generating skill docs" / bun step. |
| Targeted tests | `npx vitest run test/core/templates/skill-templates-parity.test.ts test/commands/review-cycle.test.ts test/core/shared/skill-generation.test.ts test/core/shared/skill-sidecar-install.test.ts test/core/profiles.test.ts test/commands/pipeline.test.ts test/core/pipeline-registry/pipeline.test.ts test/core/legacy-cleanup.test.ts` | **PASS** — 8 files, **229 tests passed**, exit 0 (94.2s). |
| Strict validate | `node ./bin/openspec.js validate unify-expert-template-pipeline --strict` | **PASS** — "Change 'unify-expert-template-pipeline' is valid", exit 0. |
| Full suite | `pnpm test` | **PASS** — 116 files, **2091 passed / 22 skipped**, exit 0 (252s). No flakiness this run (the 2 `store-lifecycle.test.ts` timeouts the implementer recorded in tasks.md 9.3 did **not** recur). |

### Independent content-fidelity check (the core risk)

Wrote a throwaway script that loads the built `getSkillTemplates()` and, for all 19 experts, compares the new inline `instructions` against `git show HEAD:skills/gstack/<name>/SKILL.md` (frontmatter stripped, CRLF→LF normalized).

**Result: all 19 expert bodies are byte-for-byte preserved** (modulo CRLF→LF), each followed only by the expected `STORE_SELECTION_GUIDANCE` append (and for `prototype`, the `CHANGE_CONTEXT_CAPTURE_GUIDANCE`/"OPSX change-context adaptation" block). This independently confirms design D7's byte-equality claim — the migration did not drift, lose, or corrupt content (no backtick/`${`/backslash escaping damage). `navigator` correctly keeps its real `description`, `disableModelInvocation: true`, and `openspec:navigator` name.

---

## Findings

### Finding 1 — [Minor] Stale `AUTO-GENERATED` / `Regenerate: bun run gen:skill-docs` comment preserved in all 19 inlined experts

**Where:** `src/core/templates/experts/*.ts` (all 19), inside the template body — e.g. `review.ts:6-7`, `navigator.ts:6-7`:
```
<!-- AUTO-GENERATED from SKILL.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->
```
**Problem:** These two lines were carried over verbatim by the byte-faithful migration (correct per D7's "no content rewrite" mandate — my fidelity check shows they came straight from the pre-migration `SKILL.md`). But they are now self-contradictory: the `.ts` file **is** the source of truth (you *should* edit it directly), and both the referenced `SKILL.md.tmpl` source and the `gen:skill-docs` script are **deleted by this very change**. The comment also ships into the installed skill markdown (top of every expert skill an end user sees). This is a maintenance trap — a future maintainer opening `review.ts` is told "do not edit directly / Regenerate: bun run gen:skill-docs" for a generator that no longer exists.
**Severity rationale:** Minor, not Blocker/Major — it is prose inside a string literal, breaks no code path, and the parity test would immediately correct a confused maintainer. But it is the single most worth-fixing item.
**Recommended fix:** Strip the two comment lines from all 19 expert `.ts` template bodies and recompute the parity golden-master hashes (function-payload + generated-content). This is a deliberate, hash-changing follow-up, not a byte-preserving edit — so it is legitimately either a small fix now or an explicitly-scoped housekeeping follow-up. Pick one and record it.

### Finding 2 — [Minor] User-facing docs still reference the retired live name `openspec-gstack-review` / `gstack:review`

**Where (live-reference prose, not historical citations):**
- `docs/commands.md:391,404` — describes the review-cycle engine as `openspec-gstack-review`
- `docs/workflows.md:314` and `docs/zh/workflows.md:286` — same
- `docs/opsx-workflow-guide.md` (multiple: 109, 117, 173, 207, 249, 399) — `gstack:review`, `gstack:cso`, `openspec-gstack-*`, `openspec-gstack-review`
- `docs/review-cycle-workflow-design.md` (15, 31, 78, 121, 130, 211) — `openspec-gstack-review`, `skills/gstack/review/SKILL.md`
- `docs/codex-workflow-integration.md:111` — `skill: gstack:review` pipeline example
- `docs/zh/commands.md:389,402` — `openspec-gstack-review`
- `CHANGELOG.md:110` — `openspec-gstack-review`

**Problem:** After this change the installed engine is `openspec-review` (`openspec:review`). These docs describe the **live** name and are now wrong — a user copying `gstack:review` into a pipeline or looking for `openspec-gstack-review` will fail. The proposal's Impact scoped docs narrowly to `skills/experts/docs/AGENTS.md` (which was correctly updated) and deferred *historical-citation* prose in the removal specs to a housekeeping change — but that deferral NOTE was about specs citing `gen-skill-docs.ts` as a historical deletion site, **not** about user-facing command docs naming the live engine.
**Severity rationale:** Minor — documentation only, no code path. Per the review contract's rename-completeness rule, only *live code paths* resolving old names are Blockers; every code/config/pipeline reference was correctly renamed (verified — see below).
**Recommended fix:** Update at least the English user docs (`docs/commands.md`, `docs/workflows.md`) to `openspec-review`, or explicitly fold all of the above into the deferred housekeeping change so the deferral is on record.

### Non-finding notes (verified clean, no action)

- **Rename completeness (code):** `git grep 'openspec-gstack\|gstack:'` over `src test pipelines` surfaces **only** intentional survivors: the `RETIRED_EXPERT_SKILL_PREFIX = 'openspec-gstack-'` constant + its comments (`legacy-cleanup.ts:18`, `init.ts:582`, `update.ts:159`) and the orphan-prune tests. All `pipelines/*.yaml` stage refs, `_orchestration.ts`, `review-cycle.ts`, and test assertions were renamed. `package.json`/`build.js` have zero `gen-skill-docs`/`skill:check` refs.
- **Orphan prune safety (D8):** `pruneRetiredExpertSkillDirs` matches `entry.name.startsWith('openspec-gstack-')` exactly — it is provably unable to touch `openspec-review`/`openspec-propose` (no `gstack-` segment). `legacy-cleanup.test.ts` covers the near-miss: asserts `openspec-gstack-review` is removed while `openspec-review` **and** unrelated dirs are left intact, plus a no-orphans no-op and the prefix-constant pin. Safe.
- **REMOVED specs are genuinely dead:** `gen-skill-docs-path-migration` + `skill-template-generator` specced the deleted `scripts/gen-skill-docs.ts`. `methodology-skill-tool-scoping`'s sole requirement constrained `allowed-tools` on the deleted `.tmpl` — independently confirmed `git grep 'allowed-tools\|allowedTools' -- src` returns **nothing**, so the constraint had no surviving installed artifact. REMOVED is correct for all three.
- **Delta conformance:** MODIFIED requirements each carry a **complete** scenario set (full replacement, not a partial patch) — spot-checked `review-two-axis-absorption` (3 requirements, all scenarios present), `gstack-skills-integration` "Skill Source Directory" (3 scenarios, semantically inverted to assert no SKILL.md), and `skill-name-prefix` (RENAMED block correctly pairs the 2 renamed requirements FROM/TO; MODIFIED restates names/dirNames/author with full scenarios).
- **Sidecar rename (D5):** `copySkillSidecars` resolves `skills/experts/<workflowId>`; 8 dirs with real `.md`/`.sh` sidecars survive (careful, codebase-design, freeze, investigate, prototype, qa, review, tdd — each ≥1 sidecar file, no empty dead dirs); no `SKILL.md`/`SKILL.md.tmpl` remain outside the excluded `browse` tree.
- **Out of scope (note only):** the vendored browse tool's own test filenames `skills/experts/browse/test/gstack-config.test.ts` and `gstack-update-check.test.ts` still contain "gstack" — browse is an explicit non-goal of this change; not a finding.
