# Target State: Store-v2 onto 0.2.0

> Sub-direction of `issue-centered-automation-platform`. Its North Star (`../north-star.md`)
> and goal (`../goal.md`) are the read-only higher authority. This file fixes the outcome
> this cross-Change workstream must make true on 0.2.0.

## Outcome

Land 0.1.7's Store-v2 stack onto 0.2.0, reconciled with 0.2.0's daemon / change-run / ECP base,
so that on 0.2.0:

1. **Store is the planning space; the member project is the execution root (Agent cwd).**
2. **Store Issues** exist as a first-class planning resource — the minimal repo-blind `issue.yaml`
   plus immutable Execution Plan v1 revisions, behind one `StoreIssues` interface and one Issue lock.
3. **flat → v2 layout migration** and the **coordinator → Issue bridge** run end-to-end against a
   real Store.
4. **Finalization + stored-plan** carry the TOCTOU fix; the store-session **execution-context
   separation** is correct (explicit capability, not cwd inference).
5. **0.2.0's change-run Run Record, daemon / SessionSupervisor, reusable sessions, and ECP are
   not regressed.**

This explicitly **crosses the 0.2.0 / 0.3.0 boundary** the parent roadmap §0 drew: the Store Issue
resources are 0.3.0-adjacent, and the operator decision is to land them on 0.2.0 because Store-v2
cannot be correct without them.

## Observed baseline (separated from hypotheses)

**0.1.7 (Store-v2 line) — the behavior reference to port:**
- `src/core/store/issues/` — records, plans, locks, `StoreIssues`, `IssueRecordV1`,
  `ExecutionPlanRevisionV1`.
- `src/core/store/layout-migration/` — flat→v2 mapping, immutable plan, apply, receipt, write-guard.
- target-line model; `resolveRegistrationRoot` (registry alias safety).
- `DISPATCH_ADAPTERS` (`src/core/runtimes/dispatch-adapters.ts`) — per-runtime adapter registry.
- `src/core/store/finalization/module.ts` — finalization with the TOCTOU fix.
- `persistArchivePlan` + `withStoredArchivePlanOperation` (stored-plan apply wrapper).
- `resolvedExecutionProjectRoot` (`root-selection.ts`); `resolveExecutionRoot` **deliberately removed**
  (file-placement.ts:122 forbids cwd/`.git` inference of execution authority).
- Change `migrate-cross-project-coordinators-to-store-issues` — **shipped in the released 0.1.7**
  (PR #154 merged; archived `9472d7dc`). The coordinator-bridge is part of the frozen reference,
  so L8 is unblocked.
- **0.1.7 is formally released** (dual-package + GH Release + tag; `dev/0.1.8` cut as the bugfix
  line). The entire Store-v2 stack above is now a frozen, tagged input — no longer in flux.

**0.2.0 (the base to extend, must not regress):**
- Basic `src/core/store/` (single-store identity: foundation/operations/identity/registry/inspection).
- `src/core/change-run/` — durable event-sourced Run Record (the most complex subsystem; keep).
- `src/core/management-api/` — daemon, `SessionSupervisor`, `createAgentCliResolver` (hardcoded
  single-binary dispatch), `ReusableSessionService`.
- Archive with `persistArchivePlan` only (no `withStoredArchivePlanOperation`, no finalization module);
  B1 apply-time `mergeConfirmed` gate landed via PR #153 (**merged** `82562754`). dev/0.2.0 is now at
  `34d91322` (carries #151 / #152 teacher-advisor / #153 + CI hardening); the backport Change is
  merged but **not yet archived**.
- `resolveExecutionRoot` (file-placement.ts:148) — cwd `.git`-ancestor probe.
- ECP definition v2 (`pipeline-registry/definition.ts`).

**Divergence:** the two lines are bidirectionally divergent on router.ts / runs.ts / wire-types.ts /
archive.ts / management-api (merge and cherry-pick both proven unviable). Every seam below is a
re-implementation on 0.2.0, not a port.

## Success / health evidence (observable — goal north-star 戒律 9)

- A real flat Store migrates to v2 on 0.2.0; a real cross-project coordinator becomes a Store Issue
  end-to-end (inventory → mapping preview → token apply → Issue reads → resume/rollback → retire →
  `rasen archive <legacy-alias>` diagnostic).
- A Store-selected run launches the agent from the member-project cwd (not the Store root);
  unavailable execution authority refuses rather than infers.
- Archive stored-plan apply runs through finalization; the B1 `mergeConfirmed` gate still blocks an
  unmerged PR+on-merge archive (mutation-discriminating test stays RED→GREEN).
- change-run / daemon / ECP suites green; `tsc` + ESLint clean; no behavior outside scope changed.

## Locked decisions

- **D1 — Version boundary:** include 0.3.0-adjacent Store-Issue content on 0.2.0 (operator override
  of parent roadmap §0 for this store foundation).
- **D2 — Execution root (L6):** adopt 0.1.7's explicit-capability model (`resolvedExecutionProjectRoot`);
  remove 0.2.0's cwd-probe `resolveExecutionRoot`. Goal-mandated (store-session-execution-context:
  runtime cwd ≠ durable target binding).
- **D3 — Dispatch (L4):** `DISPATCH_ADAPTERS` is the target model on 0.2.0 — no second hardcoded
  dispatch. Decision locked now; **work sequenced after the first vertical closure** (it is
  execution-domain and orthogonal to the planning-domain store foundation; it is the largest daemon
  seam and must not block the store landing).
- **D4 — Finalization + stored-plan (L3+L5):** port `withStoredArchivePlanOperation` +
  `store/finalization/module.ts` (TOCTOU) as ONE slice; must coexist with the B1 `mergeConfirmed`
  gate without regressing it.
- **D5 — One truth:** one Issue serializer / lock / store; receipt and mapping are historical
  evidence, never a live Issue store; planning space and execution root never collapse.

## Boundaries (this workstream vs the parent direction)

**In scope:** store base v2, Issues module, layout-migration, coordinator-bridge (the 0.1.7 patch),
finalization/stored-plan (TOCTOU), store-session execution-context, dispatch adapter, router/runs/
management-api seams.

**Out of scope (parent `issue-centered-automation-platform` Phase 0–8):** Issue Dispatch agent,
Execution Plan DAG scheduling, auto-decompose uplift, Issue Board / Operations UI, Issue acceptance,
external tracker. This workstream lands the store foundation the platform will build on; it does not
build the Issue platform.

## Open choices

- Exact L0 (store base v2) module set to port — resolved at the foundation slice's design time by
  diffing 0.1.7 `src/core/store/` against 0.2.0.
- Relative ordering of L4 (dispatch) and L7 (router seams) — both execution-side, sequenced after
  the planning-domain foundation.
- Whether L7 is one slice or split per-endpoint.
- L8 (coordinator-bridge) exact fixture shape — blocked on the operator finishing the
  `migrate-cross-project-coordinators-to-store-issues` patch on 0.1.7.
