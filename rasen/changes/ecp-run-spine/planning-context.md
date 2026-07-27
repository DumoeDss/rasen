# ecp-run-spine — Planning Context (shared worker seed)

> Read this FIRST. It is the durable seed for every implementer/reviewer worker
> on the remaining product-surface work. Append durable new findings only.

## What this change is

`ecp-run-spine` is the **deterministic execution kernel** for 0.1.6 (Executable
Composite Pipelines): one immutable prepared Pipeline plan owned by a durable
canonical Run Record, with deterministic root-DAG reconciliation, closed
action/result/control contracts, atomic recovery, engine ownership, and drift
reporting. Only the simple `bug-fix` route is dogfooded.

The long-term direction is the Issue-centered platform
(`rasen/work/issue-centered-automation-platform/goal.md`: Issue → Execution Plan
→ Change → Run). This change supplies the **Run** owner that model stands on.

## Audit verdict (2026-07-27, commit 55c9e66c)

**105/137 kernel tasks (G1–G11) are GENUINELY DONE** — real code + real tests.
Verified: 288 tests green (32 files), `tsc --noEmit` clean, eslint clean.

**32 product-surface tasks remain NOT done** (G7.9, G12.5–12.7, G13.2–13.8,
G14.1–14.8, G15.1–15.7, G16.1–16.6). `tasks.md` is the authoritative ledger and
is HONEST (these are unchecked).

A prior session left **dishonesty residue**: 3 test files that masqueraded as
product-surface coverage but only exercised the kernel. They were DELETED in
55c9e66c. **Do NOT recreate that pattern.** Every remaining task MUST be
implemented through its REAL product surface (CLI command / HTTP route / UI
component / fresh-process E2E) and verified by a test that exercises THAT
surface — never a kernel-level substitute.

## Architecture (what already exists — consume it, don't rewrite)

Kernel modules live in `src/core/change-run/internal/` (reconciler, reducer,
record, runtime-plan, lowerer, actions, actors, completion, ownership, evidence,
workspace, workspace-git, reservations, scope, run-store, run-store-fs, safe-path,
budgets, publish-atomic, coordination, projector, facade-runtime, engine-ownership,
runtime-context, input-reader, identity, association-registry, waits).

**Public barrel** `src/core/change-run/index.ts` exports the closed contracts
(`ChangeRunView`, `ChangeRunReceipt`, `ChangeRunControlRequest`, `decode*`,
`deriveReceiptDisposition`, identity types) plus the facade types
(`ChangePipelineRuntime`, `StartChangePipeline`, `ResumeChangePipeline`,
`RuntimeMutationContext`) and `prepareRuntimeContext`/`RuntimeContext`.

**Runtime adapters** bridge kernel → real fs/git: `run-store-fs.ts`
(filesystem RunStore at `<globalDataDir>/runs`), `workspace-git.ts`,
`runtime-context.ts` (launch assembly), `profile-resolver.ts`
(capability → RuntimeExecutionProfile), `input-reader.ts` (bounded no-follow
reader — EXISTS, used by 12.6).

**Projector** `internal/projector.ts` → `projectRunView(record): ChangeRunView`
is the ONE read-only projection reused by receipts, CLI, management, UI.

**Facade** `facade.ts` exposes `start/resume/complete/inspect/control` (G10.4
done). `pipeline cancel` already wires `facade.control` (src/commands/pipeline.ts).

**CLI** `src/commands/pipeline.ts` has `start/status/resume-run/cancel/show`.
Missing: `complete`, `control`. **Management API** `src/core/management-api/`
has `GET /api/v1/runs` (handleRuns) + `availableEngines` in pipeline detail.
Missing: `GET/POST /api/v1/runs/<changeId>/<runId>`, pagination, union discovery
filtering. **UI** `packages/ui/src/api/types.ts` has ChangeRunView types; NO
Operations/Canvas components.

## The 32-task DAG (dependency order)

```
Wave 1 (parallel-safe, different files):
  CLI group ......... 7.9, 12.5, 12.6, 12.7   (src/commands/pipeline.ts, src/cli/index.ts)
  API-reads group ... 13.2, 13.3, 13.4, 13.5, 13.6  (src/core/management-api/{runs,router,wire-types}.ts)

Wave 2 (depends on CLI):
  API-control group . 13.7, 13.8   (POST bridge spawns the CLI complete/control)

Wave 3 (depends on API):
  UI group .......... 14.1–14.8    (packages/ui: Operations + controls + Canvas)

Wave 4 (depends on CLI+API+UI):
  Parity/E2E group .. 15.1–15.7    (one fixture matrix across projector+CLI+mgmt+UI; fresh-process E2E)

Wave 5 (depends on all):
  Verify group ...... 16.1–16.6    (run all suites, audit, dogfood)
```

Design contracts for each wave: `design.md` §12 (CLI), §13 (API), §14 (UI),
§15 (parity/crash). Specs: `specs/{opsx-pipeline-registry,management-http-api,
task-detail-ui,pipelines-ui,change-run-operations,ecp-change-run-runtime}/spec.md`.

## Conventions / gotchas

- **1M-window probe false positive**: `rasen agent context --latest` reports
  `limit:200000` for a 1M model, inflating pct. `contextTokens` is accurate.
- **`test/commands/pipeline.test.ts` is slow** (5–10 min, CLI spawning + dist
  build on Windows). Prefer the focused JSON-contract subset during dev; run the
  full suite at group completion.
- **Wire type strictness**: adding fields to a management wire response may need
  a cast instead of a type annotation if the shared wire type lacks the field —
  prefer extending the wire type over casting.
- **Git SHA digests**: git SHA-1 (40 hex) re-hashed under sha256 (`gitShaToDigest`).
- **PlanningSpaceId** = `project-<sha256(projectRoot).slice(0,12)>` (pragmatic slug).
- **Engine freeze**: `engine: legacy | reconciler` frozen at launch; every
  mutation refuses when the other engine is active.
- LEAD owns `tasks.md` checkboxes and `auto-run.json` — workers do NOT edit them.
  Workers report completed task IDs; LEAD checks them off after verification.

## Per-wave file ownership (avoid collisions)

- CLI group owns: `src/commands/pipeline.ts`, `src/cli/index.ts`, CLI message
  bundles, `test/commands/pipeline.test.ts` (or a focused `test/core/change-run/`
  CLI test). Consumes existing `internal/input-reader.ts`, `internal/evidence.ts`.
- API group owns: `src/core/management-api/{runs,router,wire-types}.ts` +
  `test/core/management-api/` (or change-run). Consumes `projector`, `run-store-fs`.
- UI group owns: `packages/ui/**`. Consumes server wire types + `src/api/`.

## Durable findings from completed waves (append as workers report)

### Wave 1 API-reads (13.2–13.6, commit e7e1c7b4)
- **WorkspaceInstanceId derivation chain**: management reaches into
  `src/core/change-run/internal/identity.js` for `derivePlanningSpaceId`/
  `deriveWorkspaceInstanceId`/`readPhysicalIdentity` — the same read-only
  (statSync + SHA-256) chain the CLI uses. No public barrel export; importing
  internal modules directly is the established pattern. All steps are zero-write.
- **Filesystem store `list()` silently skips invalid Runs**. To report them as
  per-entry errors (spec requirement), enumerate directories directly via
  `readdirSync` and try `decodeCanonicalRunRecord` on each head `record-v<N>.json`.
- **Other-worktree projection needs post-processing**: the projector always sets
  `workspace.scope: 'current'`. For `scope: 'other'`, post-process the projected
  view: clear `allowedControls`, downgrade `granted` → `admitted_undelivered`.
  The `change-run-view/1` invariant (in `decodeChangeRunView`) forbids controls
  or granted Actions in other-worktree views. **UI wave**: render other-worktree
  Runs read-only per this rule.
- `handleRunDetail(changeId, runId, projectRoot, home)` and `handleRuns` now
  accept `{ planningSpaceId }` / `{ limit, cursor }` options; detail returns
  `{ ok, view }` or `{ ok:false, status, code }`.
- `handleRunDetail(changeId, runId, projectRoot, home)` and `handleRuns` now
  accept `{ planningSpaceId }` / `{ limit, cursor }` options; detail returns
  `{ ok, view }` or `{ ok:false, status, code }`.

### Wave 1 CLI (7.9, 12.5–12.7)
- **facade.control() stimulus mismatch**: `facade.control()` type-signs
  `ChangeRunControlRequest` but internally casts it as `RunStimulus` (top-level
  `kind`, not nested `command.kind`). Any caller MUST flatten the decoded
  control request into the stimulus shape first — the CLI added
  `controlRequestToStimulus()` for this; `cancelRun` works around it with
  `as never`. **Wave 2 API-control**: if the POST bridge calls facade.control
  directly (vs spawning the CLI), reuse this conversion.
- **facade.complete() is domain-action-result only**: it throws for
  effect-observation / infrastructure-observation kinds — those go through the
  reducer (kernel-internal). The CLI `complete` command therefore only accepts
  domain-action-result completions; a multi-effect action needs its effects
  observed first (via the reducer) before `complete` can close it.
- **PipelineCommand test injection**: the constructor takes an optional
  `RuntimeForRunResolver`. Production passes nothing (filesystem-backed
  `resolveRuntimeForRun`); tests inject an in-memory context to exercise the
  CLI parsing / upload-staging / formatting layer without spawning a process
  or building a real project. **Wave 2** can reuse this pattern for bridge tests.
- The CLI `complete`/`control` subcommands are registered in `src/cli/index.ts`
  after `cancel`; both take `--from <file|->` and thread `--store`/`--project`/
  `--planning-space` like start/status.

### Wave 3 UI rendering (14.1–14.4, 14.7–14.8)
- **`packages/ui/**` has no eslint coverage from the root config** — the UI
  package's quality gates are `tsc --noEmit` and `vitest run` (run from inside
  `packages/ui/`). Don't expect `pnpm exec eslint packages/ui/src/` to match.
- **Preact useEffect + async fetch in jsdom needs a two-phase `act` flush**:
  one `act` for the click (state update + useEffect scheduling), then a second
  `act` with microtask flushing for the promise resolution + re-render. A single
  `act(click + flush)` leaves the fetch pending. **UI-controls wave (14.5/14.6)**:
  reuse this pattern for control-submit interactions.
- `OperationsSection` renders server-projected runs/detail; controls render as
  read-only badges (no submit yet). `EngineSupportPanel` renders the additive
  analyzer fields. Both are wired into TaskDetailPage / PipelineCanvasPage.
- `client.getRunDetail(changeId, runId, space?)` and `listRuns(space?, {cursor,limit})`
  are the consumption seam for the UI-controls wave.

### Wave 2 API-control (13.7–13.8)
- **Spawn seam `RunControlSpawner`** in `src/core/management-api/run-control.ts`:
  `type RunControlSpawner = (call: RunControlSpawnCall) => Promise<RunControlSpawnResult>`,
  where `RunControlSpawnCall = { cwd, argv, stdin, timeoutMs, killGraceMs }` and
  `RunControlSpawnResult = { exitCode, stdout, stderr, timedOut }`. Production:
  `createProductionRunControlSpawner()` (child_process.spawn, shell:false, SIGTERM→SIGKILL).
  Threaded via `ManagementRouterOptions.runControlSpawner`. **UI-controls wave
  (14.5/14.6) and E2E wave (15.x)**: reuse this seam — `handleRunControl(...)` and
  the spawner type are stable.
- **Defer-sealing is architectural, not a bridge override**: `facade.control()`'s
  `_context` param is unused and it always returns `actions: []` (admitted_undelivered,
  never granted). The first grant happens on a later `resume-run` with
  `deliveryMode:'grant'`. A smuggled `deliveryMode` in the body is rejected by the
  strict control schema (400 invalid_control).
- **Pre-spawn admission** loads the head Record via the same path as
  `handleRunDetail`, then checks: valid body schema → path/ref consistency → Record
  exists + IDs match → workspace scope (403 on mismatch) → not terminal (409) →
  engine is reconciler (409) → expectedRecordVersion matches (409). All read-only.
- Response: `{ view, disposition, actions: [] }` — committed view re-projected, empty
  actions always.
