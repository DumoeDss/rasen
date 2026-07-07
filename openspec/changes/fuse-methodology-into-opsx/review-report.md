# Review Report — fuse-methodology-into-opsx

**Reviewer:** independent verifier (reviewer-3); author (planner + implementer) were separate agents.
**Date:** 2026-07-07
**Scope:** uncommitted working-tree diff (10 code/doc files) + change artifacts (proposal / design / tasks / 8 delta specs).
**Verdict:** **APPROVE — ready to ship.** No Blocker/Major findings. All gates green.

---

## Finding counts by severity

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 0 |
| Minor | 0 |
| Trivial | 2 |

---

## Gate results

| Gate | Result | Evidence |
|---|---|---|
| `pnpm build` | PASS | tsc clean, "Build completed successfully"; skill regeneration ran with no unexpected diffs |
| `bun run skill:check` | PASS (FRESH) | all 20 gstack skills report FRESH; no stale/missing |
| Parity test (recomputed live) | PASS | `skill-templates-parity.test.ts` 6 tests green — hashes recomputed against fresh dist |
| `pnpm test` (full) | PASS | 115 files, 2076 passed, 22 skipped, **0 failed**; no Windows temp-dir flakes this run |
| `openspec validate fuse-methodology-into-opsx --strict --json` | PASS | `valid: true`, 0 issues |
| `openspec config list` | PASS | profile `custom`, expected 18 workflows; no plan-review skills; global config unpolluted |
| Dangling-ref grep (`src/ skills/ docs/ scripts/ schemas/`) | PASS | NO MATCH for `plan-ceo-review` / `plan-eng-review` / `plan-design-review` on live surfaces |
| Dead-code grep (`TEST_COVERAGE_AUDIT_PLAN`, `generateTestCoverageAuditPlan`, `mode === 'plan'`) | PASS | fully removed from `gen-skill-docs.ts` |

---

## Priority-scrutiny results

### 1. Fusion wording quality — PASS
- **Teaching-level, conditional, no inlined bodies:** propose (`/codebase-design` + `/domain-modeling`), apply (`/tdd` + `/careful`), explore (`/prototype`) all use short conditional pointers. Each block explicitly marks itself optional ("optional", "conditional references, not required steps", "you may reach for") and ends with "don't inline the expert bodies." Won't derail simple changes into mandatory ceremony.
- **No new entry points:** all references are prose pointers to already-registered skills; no new commands/registrations.
- **Artifacts directed into the change directory:** propose captures decisions in `design.md` Decisions / a change-dir sidecar resolved from `openspec status --json` `changeRoot`, and explicitly says "not in a root `CONTEXT.md` or `docs/adr/`." explore captures the prototype answer in the change directory and deletes throwaway code. No gstack legacy paths (`~/.openspec/projects`, root `CONTEXT.md`) are targeted.
- **Skill + command variants identical:** the inserted block is byte-identical between the skill and command template in all three files (verified in diff).
- **Referenced experts all exist:** `codebase-design`, `domain-modeling`, `tdd`, `careful`, `prototype` all present under `skills/gstack/` (20-expert roster confirmed).
- **Convention match:** the bare `/codebase-design` form matches how `navigator/SKILL.md` references the same experts (lines 124–132), so no inconsistency is introduced; the `design.enhance` emission (`/codebase-design`) is consistent with it.

### 2. schema.yaml enhance — PASS
- `proposal.enhance: plan-ceo-review` and `specs.enhance: plan-design-review` removed; `design.enhance: plan-eng-review` → `codebase-design`.
- Only consumer of the field is `src/commands/workflow/instructions.ts` (echoes `/${enhance}`) via `src/core/artifact-graph/instruction-loader.ts` — no test asserts the values, nothing else consumes them. Retarget is safe; `openspec instructions` no longer names a deleted skill.

### 3. Structural removal in gen-skill-docs.ts — PASS
- `TEST_COVERAGE_AUDIT_PLAN` removal was structural: union member (`'plan'` dropped from `CoverageAuditMode`), all `mode === 'plan'` branches, `generateTestCoverageAuditPlan` wrapper, and the `RESOLVERS` registration all removed; ASCII comment updated three→two.
- **ship/review output byte-identical:** `pnpm build` regenerated all skills and produced **no** git diff beyond the intended files, and `skill:check` is FRESH — proving the surviving `ship`/`review` coverage-audit output did not drift. No dead `TEST_COVERAGE_AUDIT_PLAN` reference remains anywhere.

### 4. Parity hashes — PASS
- Exactly 9 hashes changed: 6 function (`getExploreSkillTemplate`, `getApplyChangeSkillTemplate`, `getOpsxExploreCommandTemplate`, `getOpsxApplyCommandTemplate`, `getOpsxProposeSkillTemplate`, `getOpsxProposeCommandTemplate`) + 3 content (`openspec-explore`, `openspec-apply-change`, `openspec-propose`). No drift on any other template. The parity test recomputes live and is green, proving the recorded hashes are legitimate.

### 5. Scope additions — JUSTIFIED & ACCURATE
- `docs/review-cycle-workflow-design.md`: the "planning-period review" line previously described the now-deleted `plan-ceo/design/eng-review` enhance hooks as live. Rewritten to describe the propose-stage methodology consults + `design.enhance: codebase-design`. Honest-currency fix, accurate to the implementation.
- `docs/zh/gen-skill-docs.md`: removed the `{{TEST_COVERAGE_AUDIT_PLAN}}` / plan-mode documentation to match the generator's structural removal. Accurate.
- **browse carve-out:** no `browse/` files touched (git status clean); `skills/gstack/browse` untouched — matches design's "do not touch."

### 6. Delta specs (8) — ACCURATE
- All MODIFIED/REMOVED requirement headers match their main-spec counterparts exactly (verified against `openspec/specs/*/spec.md`), so the sync will modify/remove rather than accidentally add.
- `methodology-expert-fusion` (ADDED): accurately describes the template references, enhance-hook cleanliness, dead-ref removal, and standalone-invokability.
- `schema-enhance-field` / `artifact-graph` / `instruction-loader`: faithful mechanical `plan-ceo-review` → `review` example swaps, preserving the original's schematic `skills/<name>/SKILL.md` wording.
- `preamble-migration`: drops only the deleted `plan-ceo-review/SKILL.md.tmpl` from the ETHOS file lookup; office-hours + ARCHITECTURE retained.
- **Historical deltas spot-checked as genuinely about deleted artifacts:** `ship-portability` (all 3 REMOVED — constrain deleted `ship`/`document-release` `.tmpl`; confirmed absent from `skills/gstack/`), `dead-stub-removal` (REMOVED retro global-mode — `retro` confirmed deleted; MODIFIED narrows to surviving `codex` tmpl and keeps the still-working design-review-lite diff-scope scenario; the untouched "generator functions" requirement is correctly left out of the delta), `skill-name-prefix` (3 MODIFIED — drops the stale "28" count and removed-skill mapping rows/`gstack-upgrade` scenario; surviving prefix/dirName/author rules kept with live representative examples). All REMOVED requirements carry Reason + Migration.

---

## Trivial findings (non-blocking, optional)

- **[Trivial] explore.ts prototype block omits the `changeRoot` path-resolution hint.** `src/core/templates/workflows/explore.ts` (both variants) directs the answer to "`design.md` Decisions or a change-directory sidecar" but, unlike propose.ts, does not mention resolving the absolute path from `openspec status --json` `changeRoot`. Acceptable given explore's more narrative style; add the hint only if strict parity with propose is desired. *Suggested fix (optional): append "(resolved from `openspec status --json` `changeRoot`)".*
- **[Trivial] Stylistic asymmetry in fusion block shape.** propose/apply use an inline `**…(optional):**` lead-in; explore uses a full `## Prototype to Settle a Stuck Question` heading. This matches each file's own structural conventions (explore.ts is heading-structured), so it is intentional and fine — noted only for completeness.

---

## Notes

- `auto-run.json` present in the change directory is the pipeline's run-state; not part of this review's diff scope and not modified.
- No security-sensitive surface in this change (docs/templates/schema text only; no auth, SQL, or external I/O).
