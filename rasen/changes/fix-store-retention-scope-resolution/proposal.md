# Proposal: fix-store-retention-scope-resolution

## Why

Retention/archive — and every scoped write — run from a real Store-v2 planning/execution worktree pair are hard-refused by the planning-scope resolver. Three distinct refusals were reproduced on 2026-08-26 against the `rasen-issue-store` `dmpi` pair with the current build. The same gap forced an owner-waiver on a real delivery: codex session `01a02fb2` merged code PRs #7/#8 and planning PRs #3/#4 for two `document-skills-xlsx-*` Changes in `elftia-store`, could not run official retention from its verified pair, and closed them on 2026-08-25 by waiving the retention step and archiving through the finalization engine (both records are `outcome: landed`, schemaVersion 2, spec sync applied). The archives are sound; what the gap cost was the ability to run the lifecycle as designed, and it will recur on the next such delivery:

1. From the planning worktree: `planning_selection_conflict — project-binding projectId '<store-root-config-id>' conflicts with planning-worktree-marker '<partition-id>'`.
2. From the registered store main checkout: `Project '<store-root-config-id>' is not in the selected Store's v2 catalog.`
3. With the correct explicit `--project <partition-id>`: `Project '<partition-id>' is not planning-bound in the selected Store.`

Root causes: (a) a v2 Store checkout's committed root `rasen/config.yaml` carries an init-minted `projectId` that is a member of no v2 project catalog, yet the resolver admits it as a `project-binding` fact, so it collides with every partition selector; (b) the store registry and root-resolution seams recognize a Store only by canonical path equality, so a git worktree of the store repository never equals the registered root; (c) the planning-bound gate reads only the project catalog's `planningBinding.state`, which nothing in the workspace-pair flow ever writes, so recorded pairs still read as unbound.

## What Changes

- A Store checkout (v2 layout) contributes **no** `project-binding` projectId fact from its root `rasen/config.yaml`: a Store aggregate is not a project. Only a standalone project root's config contributes a projectId fact. Genuine fact conflicts remain fail-closed.
- Store-root resolution recognizes a **git worktree of a registered store's repository** as that registered store (repository-identity equivalence, not canonical path equality).
- The planning-bound gate is satisfiable by evidence the official flows actually produce: the project catalog's `planningBinding: bound` (adoption path, unchanged) **or** a recorded workspace pair whose index entry, planning-worktree marker, and execution association agree on the store+project+target-line triple. A pair whose own three sources disagree remains a fail-closed conflict; a torn SIBLING pair does not veto a write an agreeing pair admits (several pairs per project+line is the normal machine state, and the index is a rebuildable projection). The refusal names the exact repair.
- End-to-end real-git tests pin each of the three refusal scenarios (suites carry their own timeouts), plus a dogfood pilot: a real archive through the `dmpi` pair.

Non-goals (sibling changes, same workstream): the two `workspace plan/apply` transaction bugs (stale-tip freeze; not-yet-created worktree misjudged as identity drift), `root-selection.ts` compat-adapter demotion, L6 session-context part 2, doctor/CI cross-line audits, store setup stop-minting root projectId + cleanup of existing stores, and the real legacy-store migration rehearsal.

## Capabilities

### New Capabilities

- `store-scope-resolution`: how a scoped command resolves Store/project/target-line facts from explicit selectors, frozen session context, execution association, planning-worktree marker, project binding, and the store registry — including fail-closed merging, the store-checkout exclusion for root-config projectId facts, store-repository worktree equivalence, and the planning-bound gate (catalog bound or consistent recorded pair) with its repair-named refusal.

### Modified Capabilities

(none — the pair recording behavior itself is unchanged; only its standing as selection evidence is specified, in the new capability)

## Impact

- `src/core/store-planning/internal/resolver.ts` — fact collection (`project-binding` exclusion for store checkouts), planning-bound gate refusal + repair.
- `src/core/store/identity.ts` (and the registry seam it shares with `root-selection`) — registered-store root matching gains repository-identity equivalence for worktrees.
- `src/core/store/workspace/registry.ts` (pair index reads) — consulted as planning-bound evidence by the scope gate.
- Tests: `test/core/store-planning/` + a new real-git end-to-end suite pinning the three refusal scenarios; dogfood pilot archives `document-multi-project-issues` through the `dmpi` pair.
- Operators: after landing, rebuild `dist` and reinstall the CLI so external sessions (elftia codex worker) pick up the fix.
