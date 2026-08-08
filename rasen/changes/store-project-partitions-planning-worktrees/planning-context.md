# Planning context

## User intent

> `$rasen-auto auto-decompose 开始实现！创建worktree，基于最新的dev/0.1.7创建开发分支，完成后提pr`

Implement the complete accepted design in
`docs/zh/store-project-partitions-and-planning-worktrees.md`, including the
corrections it makes to the existing file-placement model. Deliver one PR when
the whole portfolio is complete.

## Frozen delivery context

- Base ref: `origin/dev/0.1.7`
- Base commit: `588afca1029b7319143b23ed7885403404792183`
- Development branch: `feat/store-project-partitions-planning-worktrees`
- Worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/workflow/Reference/OpenSpec-code-wt-store-project-planning-v2`
- Pipeline: `auto-decompose` with child pipeline `small-feature`
- Host/tier: Codex native, Tier A
- Gate policy: `off` from global config; pipeline stages currently report
  `effectiveGate=false`
- Portfolio delivery: children commit locally; push and create exactly one PR
  at the parent level against `dev/0.1.7`

The original working tree is dirty with unrelated user work. Do not edit it,
move its files, or attempt to clean it. All implementation work belongs in the
new worktree above.

## Locked product decisions

- Store is the only planning Git repository for Store-bound projects.
- Project planning content lives under
  `rasen/projects/<projectId>/`; there is no writable flat Store
  `rasen/changes` or `rasen/specs` namespace in layout v2.
- Every ordinary Change has exactly one project owner. Cross-project work is a
  Store-level Issue/Execution Plan that references per-project Changes.
- `storeUid`, `projectId`, and `targetLineId` are orthogonal stable identity
  dimensions. Git branch names are mutable locators, not identity.
- An execution worktree binds explicitly to one Store planning worktree.
- Only finalization outcome `landed` may update canonical specs.
  `superseded`, `cancelled`, and `abandoned` are passive history and never
  replay spec deltas.
- Legacy flat Store migration is explicit, previewable, no-clobber, and
  fail-closed when ownership evidence is missing or conflicting.
- Callers consume one PlanningScope capability/typed locator; they do not join
  Store-internal paths themselves.
- Preserve standalone/in-project behavior for projects that are not Store-bound.

## Codebase facts at the frozen base

- `src/core/root-selection.ts` builds one flat `rasen/{changes,specs}` root and
  rejects simultaneous `--store` and `--project`.
- `src/core/planning-home.ts` exposes only a repo root plus one changesDir.
- `src/core/store/migration-ops.ts` explicitly moves adopted specs and Changes
  into the Store flat layout; `project-records.ts` stores name-list adoption
  ownership.
- `src/core/archive.ts` always prepares spec actions for the existing archive
  path; `archive-accounting.ts` records code commit and planning branch but no
  project, target line, instance, or semantic outcome.
- Session and management API contracts carry raw roots and do not freeze the
  complete Store-planning/execution worktree pair.
- The current `dev/0.1.7` tree has no existing ChangeInstanceId/
  PlanningScopeId implementation to extend; v2 identity must be introduced
  deliberately rather than assumed present.

## Decomposition plan

The scope is too large for one reviewable Change. Use this conservative serial
DAG; uncertainty and shared core files are treated as dependencies, not as a
parallelism opportunity.

1. `store-planning-foundation-v2`
   - Introduce layout v2, project and target-line catalog schemas, portable
     project/target-line grammar, PlanningScope/Change/worktree-pair identities,
     and Archive v2/finalization-outcome data contracts.
   - This child owns contracts and pure validation only, not command routing or
     Archive mutation.
2. `store-planning-scope-routing`
   - Depends on child 1.
   - Implement `StorePlanning.open`, the opaque PlanningScope/typed locator,
     orthogonal Store/project selectors, standalone compatibility routing,
     integration-checkout mutation guards, and the complete planning caller
     inventory.
3. `store-layout-v2-migration`
   - Depends on child 2.
   - Move new adopt/eject writes to project partitions; implement per-ref flat
     inventory, design-doc/shared-spec provenance and explicit mapping,
     unresolved/conflict gates, staging/recovery, no-dual-write guards, and
     migration-specific doctor diagnostics. Never invent Archive outcome,
     target-line, or workspace-pair facts that legacy evidence cannot prove.
4. `store-planning-worktree-bindings`
   - Depends on child 3.
   - Implement immutable workspace plan/apply, target-line ref resolution,
     planning/execution worktree identities and binding, Git OID preconditions,
     locks, dirty/ref mismatch handling, marker/registry/metadata conflict
     checks, Session/context v2 freezing, `context --json`, and safe cleanup.
5. `store-finalization-outcomes-v2`
   - Depends on child 4.
   - Wrap/extend the existing Archive transaction engine with four outcomes,
     landed reachability and `implementation:none`, same-project successor and
     target-line guards, landed-only spec sync, target-line-scoped Archive v2,
     recoverable association completion, and adoption by direct/bulk/ship/API.
6. `store-scoped-issues-management`
   - Depends on child 5.
   - Implement StoreQueryModule, Store Issue/Execution Plan resources that
     reference project ChangeInstances, scoped management API/UI aggregation,
     and project/target-line mutation validation.
7. `store-v2-compat-hardening`
   - Depends on child 6.
   - Enumerate and migrate read-only compatibility callers, add doctor/CI
     literal-path and line/layout consistency gates, reconcile file-placement
     documentation, and run the complete standalone/Store migration/worktree/
     finalization/management end-to-end acceptance matrix. No new Store v2
     mutator may be deferred into this child.

## Execution strategy override

Change 2 must become implementation-complete and review-clean before Change 3
starts. For Changes 3 through 7, the user explicitly selected an
implementation-first sequence: run each child's propose and apply stages in DAG
order, defer verify/review-loop/ship/archive, and begin the next child's propose
as soon as the preceding apply stage is complete. After all five apply stages
are complete, run the deferred reviews serially, fix every child to clean, then
ship/archive them locally. This override supersedes the normal per-child
review-clean dependency gate for Changes 3 through 7 only.

Child delivery is local only. The parent performs the single push/PR after the
full test/build gate.

## Global implementation constraints

- Read and write UTF-8 explicitly; preserve the repository's line-ending style.
- Use `apply_patch` for hand edits and preserve unrelated work.
- Tests under `test/` follow `test/AGENTS.md`, including cross-platform path
  construction, canonicalization, and Windows alias-path coverage.
- Git/filesystem/clock/lock/registry are local-substitutable dependencies behind
  Adapters. Do not invent a forge Adapter until there are two real providers.
- Mutation and migration use immutable plan/token plus revalidation; uncertain
  I/O, Git identity, ownership, or containment fails closed.
- Manual Git can bypass Rasen, so doctor/CI must diagnose target-line and layout
  inconsistencies without rewriting history.

## One surface is never proof for a repository-wide invariant

Three times in this portfolio a change was verified on one surface and silently
broke another:

- **Child 2** swept the named call sites a review finding cited and left sibling
  call sites with the same defect.
- **Child 3** enumerated affected tests from the CLI surface; the management API
  had identical exposure and only the full suite caught it.
- **Child 4** verified the `rasen store workspace` rename against
  `legacy-groups-removed.test.ts` — the correct proof, but not a sufficient one.
  `vocabulary-sweep.test.ts` pins the same retirement at a different
  granularity (token, not command) and nobody looked.

The rule, which then found three further latent fixtures in child 4:
**when you touch a retirement, a guard, or a refusal, grep the token itself
across all of `test/`, not the file you expect to own it.** Creation has two
entry points (CLI command, API bridge), archiving one, adoption one — check
every one for anything you change.

Corollary for gates that hold an allow-list: extend them by **enumerating**
the new entries individually with a recorded reason. Never relax the pattern to
a prefix rule or a directory exemption — that makes the gate pass while
destroying the precision it exists for.

## Ship and archive gotchas (learned shipping child 2)

Four more children ship in this portfolio. Every one of these cost real time
once and will otherwise cost it again.

- **Scenario titles in a MODIFIED delta must byte-match the canonical
  `rasen/specs/<capability>/spec.md` title.** The archive engine matches by
  exact string, so a renamed scenario reads as drop-old + add-new and it
  refuses with `archive_spec_update_failed`. `validate` does NOT catch this —
  only archive does. It surfaces one failing requirement per attempt, so fix
  them by full pairwise comparison, not one at a time. Child 2 had 25.
  A detector for this exists; run it before the archive step.
- **But do not stop at satisfying the engine.** Restoring an old title over a
  body whose behavior genuinely changed produces a canonical spec whose title
  contradicts what it documents. Of child 2's 25, two were like this and were
  corrected in `1850d774`. Split restorations into cosmetic (title still
  describes the body) and contradictory (title asserts what the body forbids),
  and fix the second kind rather than shipping them.
- **Never pre-write a `## Archive` heading in a ship log.** `archive-engine.ts`
  matches `/^## Archive\s*$/im`; finding that heading with no accompanying
  `**Transaction:**` line, it concludes the log documents a different completed
  archive and aborts with `archive_recovery_required`, leaving an orphaned
  `.rasen-archive-stage-*` directory. The archive step appends that section
  itself. Recovery: remove the heading, verify the active change directory was
  untouched, then delete the stage directory.
- **The archive engine leaves a trailing blank line at EOF** in every spec file
  it merges, which `git diff --check` rejects. Trim it before committing.
- **Archiving a NEW capability writes a placeholder Purpose**
  (`TBD - created by archiving change …`), which fails
  `test/specs/source-specs-normalization.test.ts`. After every archive,
  `grep -rl "TBD - created by archiving" rasen/specs/` must return nothing;
  author a real Purpose from that capability's requirements.
- **`git commit -- <pathspec>` commits only the paths named.** Staged deletions
  of the pre-archive change directory are left in the index and need their own
  commit. Never use a broad `rasen/changes/` pathspec — this worktree holds
  sibling children's scaffolding and the portfolio parent.
- **`.rasen/**` is run-state and is never committed.**
- **Deltas apply at archive time, so a later child's canonical baseline is
  current canonical PLUS every earlier sibling's delta.** A drift check run
  against today's `rasen/specs/` will flag a later child's MODIFIED title as
  missing when an earlier unshipped sibling is the thing that introduces it.
  Seen for real: child 3 retires `Layout and planning binding states fail
  closed` via REMOVED + ADDED and replaces it with `… with a read-only legacy
  layout`; child 5 then MODIFIES the new title, which does not exist yet.
  That is correct, not drift. When a check flags a missing title, grep the
  unshipped siblings before treating it as a defect — and remember this makes
  **archive order load-bearing**: children must archive in DAG order.
- **Renaming a requirement is REMOVED + ADDED at the requirement level**, not a
  MODIFIED block with a new title (child 3 does this correctly). Renaming a
  *scenario* inside a MODIFIED block is refused outright by
  `src/core/specs-apply.ts:308`.

## Scope re-confirmation (lead-3, 2026-08-07)

The user asked why "one Store, projects in separate folders" needs this much
work. The honest breakdown, by task count across all seven children (463 tasks,
child 7 not yet counted):

| Child | Tasks | What it actually serves |
|---|---|---|
| 1 store-planning-foundation-v2 | 23 | the partitioning itself — schema, identity, pure path contracts |
| 2 store-planning-scope-routing | 56 | its unavoidable consequence — every caller assumed one Store = one planning home |
| 3 store-layout-v2-migration | 83 | the tax — existing flat Stores must migrate |
| 4 store-planning-worktree-bindings | 98 | a SEPARATE feature: parallel version lines (0.1.7 / 0.2.0) |
| 5 store-finalization-outcomes-v2 | 101 | a SEPARATE feature: four Change end states, only `landed` syncs specs |
| 6 store-scoped-issues-management | 102 | a SEPARATE feature: Store-level Issue / Execution Plan + management API |
| 7 store-v2-compat-hardening | — | cleanup |

So the partitioning proper is 79 tasks; with its migration tax, 162. The other
~301 are three independently-motivated features that the design document bundles
in (it slices them itself in §14, Slices 1–6) and that the portfolio delivers as
ONE PR.

Why the partitioning cannot be done more cheaply: design §1 is sound. 0.1.6
conflated `StoreRoot` (the Git checkout root) with `ProjectPlanningHome` (a
project's namespace inside the Store), so `adopt` flattened every project into
one set of directories. A naming prefix does not fix same-name Change collisions,
path-opaque ownership, or a ChangeInstance identity forced to depend on a
physical directory. The root model has to change — but that cost is children 1–2,
not the whole portfolio.

**Decision: the user re-confirmed the FULL scope after seeing this breakdown.**
All seven children ship, in ONE PR against `dev/0.1.7`, as originally planned.
The cheapest cut point was here (child 6 at 102 tasks / zero progress, child 7
unproposed) and it was declined deliberately. **Do not re-raise this question in
a successor session; do not silently narrow the scope.**
