# Proposal — issue-operations-and-unlinked

## Why

g-001 made the Store's Issue truth visible as a read-only Board and Detail, but the two places
where operators act are still disconnected: supervised Sessions and reconciler Runs are buried in
Task detail/header chrome, while Changes that no current Issue plan references are mixed into the
legacy Change board with no honest path into the Issue model. Phase 7 §9.3–§9.4 requires one
operational surface for active/abnormal execution and one explicit Unlinked Changes surface, without
turning a cwd into project authority or presenting a bare Change as a stable Issue.

## What Changes

- Add a Store-scoped Operations page. It aggregates existing Session and Run reads without storing a
  second lifecycle, shows active and abnormal Sessions first, displays the process's actual cwd
  separately from its frozen execution project, and attributes every provable Session/Run to its
  Issue, Change, and Run identities. The Store view can filter by current member project; existing
  project Task detail remains the project-scoped operations surface.
- Reuse the server-projected Run detail and `allowedControls` contract for resume, retry, and stop:
  an infrastructure wait marked retryable is presented as retry, another resumable wait as resume,
  and Run cancel / Session kill as confirm-first stop. Controls submit the exact displayed ids and
  Record version, then replace the view only from committed server truth.
- Add one fresh Store read that joins active and archived Changes to the latest readable Issue plans.
  It reports each stable Change instance as `linked`, `unlinked`, or `unknown`, preserves
  incompleteness diagnostics, and never concludes “unlinked” when an unreadable plan or Store ref
  could still hold a link.
- Add a Store-only Unlinked Changes page for active, historical, and temporary Changes. A bare Change
  remains visibly a Change. From a provably unlinked row, an operator may attach it to an existing
  open Issue or create a new Issue whose first plan contains exactly that Change.
- Make both write flows preview-and-confirm. The submitted Change identity carries its Store,
  project, target line, and stable instance; an attach preserves every existing plan node and adds
  one node in a new immutable revision. Plan publication may additionally name the revision it was
  based on and is refused with a conflict, writing nothing, if the latest revision changed.
- Keep the create-plus-first-plan boundary honest: the Issue record is created first through the
  existing mutation and the plan is then conditionally published from the no-plan revision. If the
  second write fails, the UI reports the created Issue and the still-unlinked Change and offers the
  explicit attach recovery; it never claims an atomic success or silently rolls back durable intent.
- Add stable Operations and Unlinked routes/navigation as the integration seam for g-003's final
  board cutover. No old Board/orphaned component is removed in this child.

## Capabilities

### New Capabilities

- `issue-operations-ui`: Store-scoped active/abnormal Session and Run operations with actual-cwd
  disclosure, Issue/Change/Run attribution, project filtering, and server-authorized controls.
- `unlinked-changes-ui`: the Store-only, incompleteness-aware Unlinked Changes inventory and its
  confirmed attach-existing / create-single-Change-Issue flows.

### Modified Capabilities

- `management-http-api`: add the fresh Change-to-Issue link projection and carry an optional expected
  base revision on Execution Plan publication, including typed conflict and unchanged error-channel
  behavior.
- `store-issue-resources`: add a lock-checked expected-current-revision precondition to immutable
  Execution Plan publication so an aggregate UI cannot replace a concurrently changed plan.

## Impact

- Core/query boundary: an additive Change-to-Issue link composition over existing Store aggregate
  reads and latest Execution Plan revisions; no cache, index, or persistent link record.
- Store Issue publication: optional compare-and-publish input checked inside the existing per-Issue
  lock; all CLI callers that omit it retain current behavior.
- Management API/wire: one additive Store GET response; the existing Execution Plan POST request gains
  an optional expected revision; Session wire mirrors are aligned with the already-recorded
  `execution` and planning facts used for honest attribution.
- UI: new Operations and Unlinked pages, navigation/routes, API mirrors/client call, reusable Run
  detail controls, confirmation/recovery dialogs, styles, three-locale keys, and package-level tests.
- Tests: Store link-projection parity/freshness/incompleteness, revision-conflict no-write behavior,
  Operations attribution/filter/control wiring, Unlinked inventory/write/recovery flows, routing and
  wire-mirror coverage. UI tests run only with `pnpm --filter @atelierai/rasen-ui test`.
- Untouched: the persistent `issue-registry` Store (dogfood reads only), versions,
  `src/core/pipeline-registry/`, the old Board/orphaned Issue components (g-003), and all Issue status
  derivations delivered by Phases 1–6 and g-001.
