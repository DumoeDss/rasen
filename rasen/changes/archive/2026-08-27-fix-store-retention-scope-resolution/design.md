# Design: fix-store-retention-scope-resolution

## Context

Store-v2 ships partitions, planning/execution worktree pairs, and a finalization engine, but the scope-resolution seam that selects "which Store / project / target line does this command act on" refuses the very layouts the rest of the system creates. Reproduced 2026-08-26 (build 0.2.0, dist 2026-08-16) against `rasen-issue-store` (uid `f76edc31`, project partitions `6ca78b98` = rasen-site, `e2ee72ed` = rasen) and its planning worktree `E:/rasen-pairs/dmpi` (pair recorded in the machine planning-workspaces index; execution root = `rasen-site--document-multi-project-issues`):

| Cwd / invocation | Refusal |
|---|---|
| planning worktree, `rasen archive <change> --dry-run` | `planning_selection_conflict: project-binding projectId 'a7c28fc7' conflicts with planning-worktree-marker '6ca78b98'` |
| registered store main checkout | `Project 'a7c28fc7' is not in the selected Store's v2 catalog.` |
| store main checkout, `--project 6ca78b98` | `Project '6ca78b98' is not planning-bound in the selected Store.` |
| execution worktree (control) | resolves; dry-run produces a complete finalization plan |

`a7c28fc7` is the projectId minted into the committed store-root `rasen/config.yaml` at store setup; it is a member of no v2 project catalog. Code anchors: fact assembly `src/core/store-planning/internal/resolver.ts:1649-1690`, fail-closed merge `mergeFacts` (`resolver.ts:685-753`), planning-bound gate `resolver.ts:1033`, canonical-path registry matching `src/core/store/identity.ts:339-370`. The same seam forced an owner-waiver on elftia-store's two fully-merged `document-skills-xlsx-*` Changes (codex `01a02fb2`): official retention could not run from their verified pair, so the retention step was waived and the Changes were archived through the finalization engine on 2026-08-25 (`outcome: landed`, spec sync applied — the archives are sound; the lifecycle step was the casualty). The target model is `docs/zh/store-project-partitions-and-planning-worktrees.md` (accepted 2026-08-04): a Store aggregate is not a project; pair binding lives in Change metadata and the machine association registry (§5.3); branch/path is never identity (§3).

## Goals / Non-Goals

**Goals:**

- Scoped writes (retention, archive/finalization) resolve correctly from every seat of a real workspace pair: planning worktree, execution worktree, and store main checkout with explicit selectors.
- Store-checkout root configs stop injecting an orphan projectId into fact selection.
- A git worktree of a registered store's repository resolves to that registered store.
- The planning-bound gate is satisfiable by evidence the official flows actually produce, while inconsistency stays fail-closed.
- Each reproduced refusal scenario is pinned by an end-to-end real-git test.

**Non-Goals:**

- Fixing the two `workspace plan/apply` transaction bugs (stale-tip freeze; new-worktree identity misjudge) — sibling change.
- `root-selection.ts` demotion to a compat adapter; L6 session-context part 2 — sibling changes.
- Store setup stop-minting the root projectId and cleaning existing stores' configs — sibling change (data-side); this change must work with stores as they exist today.
- Any change to Store content layout, identity derivation, or the finalization engine itself.

## Decisions

### D1 — A Store checkout's root config contributes no `project-binding` projectId fact

The `project-binding` candidate (`resolver.ts:1664-1678`) includes `selectedProjectConfig.projectId` only when the config's root is **not** a Store checkout root (detected by store metadata at that root — the same signal `loadStore`/`checkoutRole` already use). Rationale: a Store aggregate is not a project (target design §4); its root config's projectId is a setup-time artifact with no catalog membership, so it can never be a correct selector — admitting it can only produce conflicts or orphan-id refusals.

*Alternatives considered:* (a) keep the fact but de-prioritize it in `mergeFacts` — rejected: silent precedence is exactly the guessing the fail-closed merge exists to prevent; (b) migrate stores to drop the field — deferred to the sibling change; the resolver must tolerate today's data.

### D2 — Registered-store root matching gains repository-identity equivalence

`findRegisteredStoreAtRoot` / `isRegisteredStoreRootPath` (`identity.ts:339-370`) keep canonical path equality as the fast path and add a fallback: when no entry matches by path, probe the root's git repository identity (resolved `git rev-parse --git-common-dir`) and match an entry whose `local_path` shares the same common dir — a linked worktree of the registered store repository. The probe runs only on path-miss (no hot-path cost) and remains fail-closed on uid disagreement (metadata at the worktree must still match the entry). The git probe enters through the substitutable dependencies seam so tests stay fixture-driven.

*Alternatives considered:* registering each worktree as its own registry entry — rejected: the machine registry holds one locator per store; worktrees are derived state, and per-worktree entries churn.

### D3 — The planning-bound gate accepts consistent recorded pair evidence; the catalog stays one satisfier, not the only one

Today `resolver.ts:1033` refuses unless the project catalog says `planningBinding.state: bound`, but nothing in the pair flow ever writes that field — pairs are recorded in the machine planning-workspaces index plus the marker/association files, exactly where the target design (§5.3) places pair binding. New rule: a scoped write is planning-bound when **either** (a) the selected project's catalog record is `bound` (portable, adoption path — unchanged), **or** (b) a recorded pair for the selected store+project+target-line exists and the index entry, planning-worktree marker, and execution association **agree** on that triple. The disagreement rule is WITHIN one pair: a pair whose own index entry, marker and association contradict each other is a fail-closed conflict naming both sources, not a near miss. It is deliberately NOT a rule across pairs. Several pairs per project+target-line is the normal machine state (one index entry per Change), each pair is an independent witness to the same question, and the index is a rebuildable projection that is authority for nothing on its own — so one agreeing pair settles the gate whatever a sibling pair looks like, in any enumeration order. Letting stale index residue veto every scoped write for a project would promote that projection to authority, and would make a REUSED planning directory a hard refusal while a torn-down one stays a near miss. A torn sibling is a machine-index defect for the diagnostic surfaces to report; keeping a WRONG scope out is the fact merge's job, and the seat's own marker and association are merged fail-closed there whatever this gate decides. The refusal, when neither holds, names the exact repair (`rasen store workspace plan/apply` for the pair).

*Alternatives considered:* (a) `workspace apply` writes `bound` into the committed catalog — rejected: with dozens of concurrent planning branches per project (elftia-store has ~40), every apply touching one shared committed file manufactures integration-line merge conflicts, and the target design deliberately keeps pair binding out of the catalog; (b) gate on marker/association only, ignore the catalog — rejected: adoption-bound projects with no local pair (fresh clone) must still pass.

### D4 — Tests: real-git end-to-end suites with their own timeouts

One new suite per scenario class, following the established real-git discipline (explicit per-test timeouts; async exec + file redirection + watchdog on Windows; must run alongside heavyweight neighbors in a full pass): (1) planning-worktree seat resolves and a finalization **dry-run** completes (pre-fix: `planning_selection_conflict`); (2) store-main seat with `--project <partition>` resolves (pre-fix: `not planning-bound`); (3) registry local_path points at the main checkout while cwd is a linked worktree (pre-fix: store unresolvable / "two different roots"); plus negative pins: a doctored marker/association disagreement still refuses; catalog `unbound` with no pair still refuses with the named repair. Dogfood pilot: archive `document-multi-project-issues` through the `dmpi` pair for real. (The two elftia Changes are already archived — 2026-08-25, via the waiver route — so there is nothing to re-archive there; the post-fix check for that class is that `retain prepare` succeeds from a real pair without a waiver.)

## Risks / Trade-offs

- [Suppressing the root-config projectId fact breaks a flow that relied on it] → full store-aggregate, store-issue, and store-planning suites must stay green; sweep tests asserting the current conflict message before changing it.
- [Repository-identity probe adds a git call] → only on path-miss (canonical path equality still answers first, and a root carrying no Store metadata never probes); probe failure degrades to today's behavior (no match), never to a wrong match. Caching is an OPT-IN, caller-owned memo (`repositoryIdentityCache`), never module-level: worktree topology mutates under a running process, so a process-lifetime cache would match a root against a layout that no longer exists. It is threaded through both `findRegisteredStoreAtRoot` and `resolveStoreBinding`, but NO production caller constructs one yet — the multi-root callers that would pay for it (`doctor.ts`, `spaces.ts`, `learned-skills/context.ts`) are a separate change, so today production takes two spawns per path-miss match.
- [Pair-evidence gate loosens split-truth protection] → satisfier (b) demands the full agreeing triple; catalog remains authoritative for adoption; a disagreement among one pair's own three sources is a conflict, not a pass. A sibling pair's disagreement does not refuse a write that an agreeing pair admits (D3) — the protection against a wrong scope is the fact merge, not this gate.
- [BEHAVIOR CHANGE, execution-worktree seat] → that seat previously resolved `standalone` rooted in the EXECUTION checkout and produced a complete archive plan; it now resolves to Store truth and fails closed with `split_planning_truth`. This is not a regression to repair in this change. Pre-fix, `selectProjectCatalog` threw `project_not_in_store` and the CLI adapter fell back to the execution checkout's own `rasen/changes/` tree — so the "passing" dry-run was planning an archive of a DUPLICATE of the Change, and spec sync would have landed in the code repo's `rasen/specs/` instead of the Store's. The refusal is now reachable because the scope resolves; the duplicate is a real data condition (in `rasen-site`, the duplicate `document-multi-project-issues/` was committed by `2dc9e31` alongside the docs page) whose repair is an operator decision, out of scope here. Note for anyone reproducing: `src/core/archive.ts:1724` opens the finalization scope with `startPath: planInputs.executionRoot`, NOT cwd, so a refusal reproduced from the planning worktree may be raised against the execution checkout's shape.
- [Windows path shapes (case, drive-letter, junctions)] → reuse `normalizePathForComparison` and real-git fixtures covering both seat shapes; no new canonicalization logic.

## Migration Plan

No Store-content migration: D1/D2/D3 are resolver-side and tolerate existing stores and pairs as-is (that is the point). Rollback is a plain revert. After landing: `pnpm build`, reinstall the dogfood CLI (global dev-local or tarball harness), then run the dogfood pilot; a future delivery in elftia-store's shape no longer needs the owner-waiver fallback that 2026-08-25 required.

## Open Questions

- None blocking. (Whether `store setup` should stop minting the root projectId, and whether the dormant `rasen/changes/store-planning-scope-routing` stub should be absorbed or retired, belong to the sibling G2 change.)
