# Planning Context: archive transaction recovery follow-up

## User intent

`$rasen-auto auto-decompose基于这个分支继续开发修复这个bbug`

Continue the work on branch `fix/archive-transaction-recovery-follow-up` and finish the defect family described by `E:\Downloads\2026-08-07-archive-and-validate-defects.md`.

## Starting point

- Branch head: `27b2d4c2fb6828fa9849b85cbfb458a47f2a0fac`.
- Integration base: `dev/0.1.7`.
- Existing change: `archive-and-validate-defects`.
- Draft PR: DumoeDss/rasen#148.
- Existing implementation covers B1-B6, but its independent review is `ESCALATED` with 6 Blockers, 9 Majors, and 6 Minors still unconfirmed.
- TypeScript and lint pass. The recorded full suite and focused finalization suite are non-green. Current Windows CI also exposes archive recovery/fingerprint failures.

## Contracts that must remain true

- Do not weaken the archive scenario-loss gate or the recorded-fact PR merge gate.
- Immutable plans remain content-bound; apply-time assertions may satisfy only their typed external-fact blocker.
- Never overwrite foreign archive evidence.
- Abort may retire only ownership-proven early transaction state and must never roll back canonical specs, publication, cleaner actions, association finalization, or source removal.
- Read-only commands must not create project registry or machine-home state for unknown copied roots.
- Every fix requires non-author review and focused regression evidence before delivery.

## Decomposition and dependency DAG

1. `fix-spec-reconciliation-integrity` — VSR-1 through VSR-5 and CCR-1. Owns `src/core/specs-apply.ts`, validation surfaces, and their tests.
2. `fix-archive-recovery-ownership` — CCR-2/CCR-3 and current archive fault-matrix/Windows recovery failures. Owns archive-engine recovery state, abort ownership checks, and focused tests.
3. `fix-project-registry-alias-safety` — RSR-1 through RSR-4. Owns registry alias selection, read-only project-home probing, planning selector identity checks, and focused tests.
4. `fix-workspace-claim-portability` — RSR-5/RSR-6. Owns workspace coordination claim recovery, portable directory fsync handling, and focused tests.
5. `fix-store-finalization-admission` — CCR-4 through CCR-6, FAR-1 through FAR-3, and SCR-1. Owns management/Store finalization admission, association freezing, blocker propagation, human disposition order, and focused tests. It starts only after children 1 and 2 are implementation-complete and review-clean.

Children 1-4 have disjoint product-file ownership and may run concurrently only while that independence remains true. Any newly discovered overlap becomes a dependency and is serialized. Child 5 depends on children 1 and 2. Children use `small-feature`, ship locally, and the portfolio delivers once from the parent.

## Planner guidance

- Read the existing parent proposal, design, tasks, delta specs, `evidence/review-cycle-report.md`, and `evidence/ship-log.md` before proposing a child.
- Keep each child narrowly scoped to its assigned files and findings; do not duplicate the parent design wholesale.
- Append only durable cross-child discoveries and newly established dependencies to this file.

## Durable cross-child discoveries

- `fix-store-finalization-admission` must consume the complete typed reconciliation issue array established by `fix-spec-reconciliation-integrity`; FAR-3 must not replace that array with a generic skip refusal or deduplicate it by source. This is part of child 5's existing dependency on child 1.
- `fix-store-finalization-admission` must consume `fix-archive-recovery-ownership`'s archive-engine cleaner deletion authority and abort/retry ownership semantics rather than introduce a parallel recovery or path-identity classifier. This keeps child 5's existing dependency on child 2 explicit and serialized through implementation and review completion.
- Store-finalization FAR-3 must preserve the complete typed reconciliation issue array without source-wide deduplication or generic replacement.
- Every later project-selection consumer, including Store-finalization admission, must consume `fix-project-registry-alias-safety`'s shared canonical main-entry lookup and normalized registry/config drift refusal; no child may add a direct-first project-home lookup or silently replace an admitted registry identity from current config. This is a consumer contract, not a transfer of child 3's product-file ownership.
- Windows 37/55 fault-matrix failures come from NTFS identity precision loss through JavaScript number; CCR-2 covers the canonical-publication-to-progress-flush window; Store finalization must reuse archive cleaner/abort ownership semantics.

## Locked child planning contracts

- Canonical alias ownership must be reduced by canonical root before identity filtering; preserve the direct or unique-live claimant and refuse conflicting live fixed metadata.
- Non-ensuring project-home lookup must consume the shared main-first registry lookup; direct worktree entries are fallback only.
- Planning selection must reject normalized registry/config identity drift with planning_selection_conflict, never adopt config identity by precedence.
- Windows fault-matrix identity must preserve exact NTFS dev/ino values; Store finalization reuses archive ownership semantics.

For `fix-workspace-claim-portability`, a matching unjournaled carrier is authority only for the target and exact bytes independently requested by the retry; journal-bound calls never fall back to this mode, and every carrier identity, including the claim, is revalidated immediately before cleanup. Directory durability handling is locked to explicit platform/stage/error-code tuples with canonical-directory revalidation; `EACCES` and genuine file-sync, close, permission, capacity, and device failures remain visible.
