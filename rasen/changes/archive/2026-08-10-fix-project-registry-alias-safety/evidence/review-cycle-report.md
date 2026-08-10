# Review cycle — fix-project-registry-alias-safety

- Rounds: 3/3
- Tier: A (native, role-isolated reviewer/fixer chain)
- Status: CLEAN
- Source review: `evidence/review-report.md`
- Unresolved Blocker/Major findings: none
- Final canonical findings: 0 Blocker / 0 Major / 0 Minor / 0 Trivial

| Round | Findings (B/Ma/Mi/T) | Triage | Fixed by | Confirmed by (non-author) | Resolved |
|---|---:|---|---|---|---:|
| 1 | 2/0/0/0 | S1 public claimant contract/consumers; P1 canonical-root selector expansion | Original implementer (author of the initial delta) | `/root/review_registry_alias` in Round 2 | 2/2 |
| 2 | 0/1/0/0 | S1/P1 confirmed resolved; P2 third-identity mutation bypass routed as design-level work | `/root/fix_registry_third_identity` (independent design-level fixer) | `/root/review_registry_alias` in Round 3 | 1/1 |
| 3 | 0/0/0/0 | Delta-only non-author re-review; no further fix required | — | `/root/review_registry_alias` with scoped diff trace + 5/5 reviewer rerun | 0/0; cumulative 3/3 |

## Tier A role-separation record

- The independent reviewer for all three passes was `/root/review_registry_alias`; it authored none of the reviewed production/test fixes.
- Round 1 fixes were returned to the original implementer. Round 2 confirmation was therefore non-author verification, not self-certification.
- P2 changed the mutation-admission design and was routed to separate fixer `/root/fix_registry_third_identity`, not to the original author or reviewer.
- Round 3 reused the same non-author reviewer context for a delta-only check of the P2 fix. The P2 fixer did not certify its own work.

## Round history

### Round 1 — independent review: FINDINGS (2/0/0/0)

- **S1 Blocker:** public claimant lookup dropped alias inventory/conflict state, allowing direct identity B to represent a query for live alias identity A and letting an owner consumer route A to project B.
- **P1 Blocker:** StorePlanning filtered raw registry entries by selector before canonical-root expansion, so an unmatched conflicting alias could bypass registry/config admission.
- Triage: both were non-trivial implementation fixes returned to the original implementer. The reviewer made no code/test edits.

### Round 2 — same non-author reviewer: FINDINGS (0/1/0/0)

- S1 was confirmed resolved: the public claimant contract carries `aliases` and `fixedMetadataConflict`, and every production identity-scoped consumer refuses conflict before routing.
- P1 was confirmed resolved: id/name/root selector matches expand to every raw entry at the selected canonical root before identity/config admission.
- **P2 Major:** alias-only live A/home-A + B/home-B conflict was still invisible to explicit ensure when the incoming identity was a third C, allowing a direct C registry entry/home mutation.
- Triage: P2 was design-level because the mutation gate had to move ahead of identity filtering; it was assigned to independent fixer `/root/fix_registry_third_identity`.

### Round 3 — same non-author reviewer: CLEAN (0/0/0/0)

- P2 was confirmed resolved in `src/core/project-registry.ts`: the complete target canonical claim is checked before `existingAtPath`, identity filtering, alias deletion, placement, home creation, or registry write.
- The target cannot be bypassed by symlink/junction spelling or a linked worktree path because input and registry aliases share canonicalization plus registration-root resolution.
- `test/core/project-registry.test.ts` now proves alias-only A/B + ensure-C throws `project_registry_alias_conflict`, leaves registry bytes and the machine-home inventory unchanged, and creates no C entry, identity, or home.
- Adjacent moved-root rebind, equivalent normalized identities, conflict-free alias collapse, and member-identity ensure/refresh refusal remained valid in the reviewer rerun.

## Verification evidence

### Recorded evidence — supplied by implementers/fixers or orchestration

The following results are preserved as recorded evidence. `/root/review_registry_alias` assessed their scope and source coverage but did **not** personally rerun these commands in Round 3:

- Red gate: `pnpm exec vitest run test/core/project-registry.test.ts test/core/learned-skills/context.test.ts test/core/store-planning/store-planning.test.ts -t "exposes a direct-owner conflict|refuses an owner whose live alias|expands a .* selector"` — 5 failed as expected before the fix.
- Targeted green gate: the same command — 5 passed.
- Full focused gate: `pnpm exec vitest run test/core/project-registry.test.ts test/core/project-home.test.ts test/core/root-selection.test.ts test/core/store-planning/store-planning.test.ts test/core/learned-skills/context.test.ts` — 184/184 passed.
- Post-P2 full file gate: `pnpm exec vitest run test/core/project-registry.test.ts` — 50/50 passed.
- Post-P2 repository build gate — passed (recorded; not rerun separately by the reviewer).
- Earlier TypeScript gate: `pnpm exec tsc --noEmit` — passed.
- Focused ESLint over the scoped source/test delta — passed.
- Strict change validation: `node bin/rasen.js validate fix-project-registry-alias-safety --type change --strict --no-interactive` — valid.

### Reviewer-rerun evidence — personally executed in Round 3

- Required scope: the P2 production delta and regression in `src/core/project-registry.ts` and `test/core/project-registry.test.ts`, plus the closest branches that could be over-rejected: member-identity conflict, conflict-free equivalent aliases, moved-root rebind, and normalized identity reuse.
- Rationale: this scope directly exercises the new pre-filter target-claim gate, both its fail-closed purpose and the healthy behaviors most likely to regress when a guard moves earlier.
- Exact command personally run:

  `pnpm exec vitest run test/core/project-registry.test.ts -t "refuses a third identity|refuses conflicting live aliases|collapses canonical aliases|rebinds a moved repo|finds an existing uppercase-UUID entry"`

- Result: **5/5 passed**, 45 skipped. The command's automatic build-if-stale step reported `dist/` matches current sources; this is not represented as a separately rerun full build.
- HEAD content tree at reviewer evidence capture: `c4e5d735a8c8bd163b27e038e8123f8a5a81c8d5`.
- Round 3 scoped source/test working-patch fingerprint: `6a6e5838b3f7dc080d6c57e3b27885fe033b9dda`.

## Final disposition

**CLEAN — 3/3 rounds complete; final canonical count 0/0/0/0.** S1, P1, and P2 each received non-author confirmation. No Blocker, Major, Minor, or Trivial finding remains in `fix-project-registry-alias-safety`. This worker wrote no run-state.

## Durable findings

1. A canonical representative is not a safe identity result unless the alias inventory and fixed-metadata conflict state travel with it.
2. Selector matching establishes candidate roots only; ownership admission must operate on the complete canonical-root registry group.
3. Mutation admission must inspect the complete target canonical claim before filtering by the incoming identity or performing any side effect.
