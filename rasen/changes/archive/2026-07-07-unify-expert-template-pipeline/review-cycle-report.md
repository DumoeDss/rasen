# Review-Cycle Report — unify-expert-template-pipeline

**Reviewer (non-author gate):** reviewer-unify
**Engine:** `openspec-gstack-review` (two-axis contract)
**Cycle closed:** 2026-07-07

## Final disposition: CLEAN — ready to ship

Round 1 found 2 Minor issues; both were fixed (by fixer-unify + LEAD, neither the reviewer) and independently confirmed resolved by the non-author gate in round 2. No new findings introduced by the fix delta. No Blocker/Major at any round.

## Round table

| Round | Findings | Fixed by | Confirmed by | Outcome |
|---|---|---|---|---|
| 1 | 2 Minor (M1: stale `AUTO-GENERATED`/`gen:skill-docs` header in all 19 inlined experts; M2: user-facing docs still name retired live engine `openspec-gstack-review`/`gstack:review`) | — | reviewer-unify | Sent to fix loop; APPROVE-with-fixes |
| 2 (this) | 0 new | fixer-unify (M1 strip + hash recompute; M2 docs rebrand) + LEAD (trivial doc triage) | reviewer-unify | Both resolved, delta clean → **CLEAN** |

## Round-2 verification of the fix delta

Confirmed against the four checks the LEAD requested:

**(a) Both findings resolved.**
- M1: `git grep 'AUTO-GENERATED\|gen:skill-docs' -- src/core/templates/experts/*.ts` → **0** matches (was 19 files × 2 lines).
- M2: `git grep -E 'openspec-gstack|gstack:' -- docs` → **0** matches. Remaining bare-`gstack` hits in docs are historical-narrative only (`docs/handoff-2026-07-06-upstream-merge-session.md`; `docs/review-cycle-workflow-design.md:12,160`), consistent with the "keep historical mentions" decision — same rationale as the intentionally-untouched `CHANGELOG.md`.

**(b) The strip did not damage any expert body.** Independent rebuild + byte-comparison of all 19 built expert `instructions` against `git show HEAD:skills/gstack/<name>/SKILL.md`: for every expert the two comment lines are gone AND the entire remaining body is preserved **verbatim** (1406–42069 bytes each). Critically, the strip was surgical — for the mattpocock-adapted skills the required MIT attribution comment (`<!-- adapted from mattpocock/skills (MIT, Copyright Matt Pocock) -->`), which sat directly below the removed boilerplate, is fully preserved (verified in `navigator.ts`, and by the byte-equal body match on all 19). Only the two stale lines were removed.

**(c) Only expert hashes changed in the parity golden-master.** Every workflow/command hash is identical to the round-1 file (e.g. `getExploreSkillTemplate 67c211d3…`, `getFeedbackSkillTemplate d7d83c5f…`, generated `openspec-explore a2a54275…`, `openspec-propose ceccbc98…`). All 19 expert function-payload hashes and all 19 expert generated-content hashes changed (e.g. `getReviewSkillTemplate 91c911d8… → 7d3c532b…`; `openspec-review 82ad7220… → 863a61e5…`). No workflow hash moved.

**(d) LEAD's doc edits are correct and did not overreach.**
- `docs/skill-authoring.md:6` intro now points at `src/core/templates/experts/<name>.ts`. The generic `SKILL.md` mentions (lines 59–74) legitimately describe the *installed* skill-file concept, not the retired `.tmpl` source — correctly left alone.
- `docs/review-cycle-workflow-design.md` — all three live path refs updated to `src/core/templates/experts/review.ts` (lines 15, 78, 211); zero live `skills/gstack/...` paths remain; the two historical-narrative mentions kept as scoped.
- `docs/zh/gen-skill-docs.md` deleted (git status `D`), documenting the removed toolchain; `git grep` finds **zero** inbound references — no dangling links.

## Final test evidence block (ship gate reads this)

**Git state:** HEAD `2161e21c14532fb82935faf84497c7dcfa9e1161` (`chore(openspec): archive reconcile-fusion-seams`), branch `dev-harness`, working tree **dirty** (entire change + round-1 fix delta uncommitted).

| Gate | Command | Result |
|---|---|---|
| Build (no bun/gen-skill-docs) | `pnpm build` | **PASS** exit 0 — only `Compiling TypeScript…`, no generator step |
| Parity + skill-generation | `npx vitest run test/core/templates/skill-templates-parity.test.ts test/core/shared/skill-generation.test.ts` | **PASS** — 2 files, **43 tests**, exit 0 |
| Content fidelity (independent) | rebuild + byte-diff all 19 experts vs `git show HEAD:skills/gstack/<name>/SKILL.md` | **PASS** — comments removed, remaining body byte-preserved on all 19 |

**Prior full-suite evidence still stands.** In round 1 I ran the full `pnpm test` at the same HEAD: **116 files, 2091 passed / 22 skipped, exit 0** (no flakiness). The round-2 fix delta touches only (i) two comment lines inside expert template string literals — verified byte-equivalent to before minus those lines, and the runtime behavior of those strings is unchanged prose; (ii) the parity golden-master hashes — re-pinned and green; (iii) documentation `.md` files — no runtime surface. No application code path changed, so the round-1 full-suite coverage remains valid; the targeted re-run above plus the build confirm the delta. A fresh full-suite re-run is not required for a comments-plus-docs-plus-hashes delta.

## Verdict

**CLEAN.** Round-1 findings resolved, fix delta verified surgical and correct, all gates green. Cleared to proceed to ship.

Ship-stage caution (carried from round 1): the untracked `openspec/changes/ship-delivery-modes/` dir belongs to a different change — do not `git add` it under this one.
