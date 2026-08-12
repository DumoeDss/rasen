# Slice: store-v2-foundation

## User-visible outcome

Store Issues exist as a first-class planning resource on 0.2.0: the minimal repo-blind `issue.yaml`,
immutable Execution Plan v1 revisions, the `StoreIssues` interface, and the Issue lock — all
re-implemented on 0.2.0's store base. A real Issue can be created, given a state, published with a
plan that references already-committed Change instances, and listed/shown — entirely on 0.2.0,
without 0.1.7's runtime.

## Why validate this now

- It is the 0.3.0-adjacent content the operator explicitly included (target-state D1).
- It is the foundation every later slice (layout-migration, coordinator-bridge, finalization) builds on.
- It is unblocked: store base + Issues are already shipped on 0.1.7, so they are a stable behavior
  reference to re-implement from.

## Observable acceptance and evidence source

- The `StoreIssues` public interface operates on 0.2.0: `create`, `setState`, `publishPlan` (verifies
  referenced Change instances against committed Store evidence), `list`, `show`.
- Ported 0.1.7 store-base (v2) + `store/issues/` suites pass on 0.2.0 — covering `IssueRecordV1`,
  `ExecutionPlanRevisionV1`, id/text/state validators, node normalizer, graph checker, revision digest,
  Issue/Plan serializers, and the Issue lock (single serializer, single mutex).
- A real Issue lifecycle on 0.2.0 (fixture or a real planning Issue): create → publish a plan
  referencing a committed Change → set state → list/show reads the canonical bytes/digests.
- 0.2.0's existing `store/` and `change-run/` suites remain green (no regression); `tsc` + ESLint clean.

## Exclusions

- layout-migration, coordinator-bridge, finalization/stored-plan, execution-context, dispatch,
  router/runs seams — later slices.
- Any Issue-platform feature (Dispatch, Execution Plan scheduling, Board, acceptance) — parent direction.
- No mutation of the parent North Star.

## Alignment

- Target State §Outcome 1–2 (Store = planning space; Store Issues as a planning resource).
- Parent `goal.md` §5 (Store = planning root; member project = execution root) and §4 (Issue =
  repo-blind intent).
- `store-session-execution-context.md` — the principle this foundation enables (a later slice enforces).
- North-star 戒律 8 (one concept, one truth): one Issue serializer/lock/store.

## Terminal outcome vocabulary

`passed | partial | failed | superseded | cancelled`
