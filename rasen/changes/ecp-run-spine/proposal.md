## Why

Rasen can now prepare one immutable Pipeline Definition v2 plan, but no program
owns that plan's durable execution: new runs still rely on prompt-managed
`auto-run.json`, and the management UI can only observe those legacy files.
This change supplies the smallest executable vertical proof so every later
Composite, loop, and parallel capability grows from one deterministic Run
owner instead of inventing another state machine.

## What Changes

- Add the deep `ChangePipelineRuntime.start/resume/complete/inspect/control`
  interface over one immutable prepared plan and one canonical durable Run
  Record.
- Make launch idempotent through a required stable `launchRequestId` scoped to
  one persisted PlanningSpace and proven Change incarnation: retries return the
  original Run without blindly redelivering actions, while different request
  content fails closed. Same-name recreation receives a distinct instance.
- Add deterministic root-DAG reconciliation, stable Run/node/invocation/
  attempt/action/effect/wait identities, branch-local concurrent waits, closed
  Agent/command/host actions and actors, and schema/evidence-validated
  completion.
- Add atomic compare-and-commit recovery. Independent result completions are
  serialized by exact Action/effect receipt slot; identical replay is
  idempotent while conflicting reuse fails closed. Immutable bounded ledgers
  and ownership-safe IPC challenge locks fail closed on corruption.
- Add version-checked human resume, Gate decision, escalation, and cancellation
  controls, explicit durable suspension, and a typed effect-observation
  completion path that either confirms the original result, proves no effect
  occurred before a new attempt, or keeps ambiguous non-idempotent effects
  suspended.
- Freeze `engine: legacy | reconciler` and the prepared plan at launch. Every
  code-controlled start/resume/complete/control path refuses to advance when
  the other engine is active, including a legacy file that appears after
  reconciler launch. Resume uses the stored plan even when the current
  Definition or capability catalog has drifted, while reporting that drift.
- Freeze complete capability/Adapter/effective-policy/source meaning,
  Change/Workspace identities, external effect ownership markers, and
  WorkspaceRevision. Cross-Run workspace reservations prevent one physical
  worktree from admitting conflicting readers/writers.
- Extend the Pipeline CLI/JSON contract with reconciler start, status, resume,
  completion, control, and cancel operations while preserving the existing
  legacy `pipeline resume` behavior.
- Extend Change-run Operations with reconciler run list/detail and safe control
  surfaces derived from the same versioned projection used by CLI status,
  with bounded pagination, branch-local workspace scope, and Canvas/CLI engine
  support parity.
- Dogfood only the simple `bug-fix` route. Its adaptive complex outcome
  suspends for the later ReviewCycle capability or escalates; it never falls
  through to prompt-owned legacy progression.
- Keep ReviewCycle, Composite/BoundedLoop execution, GoalLoop, FanOut/Join,
  launcher convergence, portfolio, Issue-level scheduling, and Board lifecycle
  mapping out of this change.

## Capabilities

### New Capabilities

- `ecp-change-run-runtime`: The canonical Run Record, deterministic root
  Reconciler, action/result/control contracts, durable recovery, engine
  ownership, drift reporting, and simple `bug-fix` execution proof.
- `change-run-operations`: The shared reconciler Run list/detail projection and
  version-checked Operations controls used by the management API and UI.

### Modified Capabilities

- `opsx-pipeline-registry`: Add engine-aware start/status/resume/complete/
  control/cancel CLI and JSON behavior without changing legacy Run recovery.
- `management-http-api`: Add authenticated, space-scoped reconciler Run
  list/detail reads and a CLI-backed control mutation path while retaining
  existing legacy Run-file responses.
- `task-detail-ui`: Show each Change's reconciler Runs, root frontier, active
  invocations, concurrent waits/drift, workspace scope, and allowed exact
  controls from the canonical Operations projection.
- `pipelines-ui`: Show Canvas engine availability/support from the same
  prepared analyzer as start, CLI show, and management detail.

## Impact

The change adds a deep module under `src/core/change-run/**` and integrates it
with the opaque plan produced by `src/core/pipeline-registry/definition.ts`,
machine-home Change work directories, the Pipeline CLI registration and
messages, management run handlers/router/wire types, and the Task detail UI/API
mirror. Tests expand across pure reconciliation and reduction, filesystem
atomicity and crash injection, CLI and legacy parity, space-scoped management
API behavior, and UI projection/control rendering on Windows and POSIX.
