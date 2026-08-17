# Design: issue-execution-binding

## Context

C1 landed the projection seam `src/core/issue-status/` (`projectIssueStatus(ProjectIssueStatusInput)`:
explicit path inputs, injectable `workDirFor`, locator = the `pipeline resume` sticky-legacy chain
keyed by committed claimant alias against the CURRENT execution root) and its CLI surface on
`rasen store issue list|show`. The C1 implementer handoff's constraints carry forward: one status
seam only, detailed readers over `resolve*` direct calls, committed-copy preference in reads, and
the dogfood trap list.

What exists and is composed (never rebuilt) here:

- **L6 session-launch composition** — `resolveSessionLaunchContext`
  (`src/core/management-api/session-launch-context.ts`): member-project cwd, Store planning root
  as attached context, membership vouching by the Store's own record, checkout-identity checks.
  Input is generic (`{ space, execution: 'project:<selector>' }`), so a CLI call is the same
  composition the daemon performs, not a reimplementation.
- **Workspace pair index** — `rasen store workspace plan --existing-change` → `apply` records a
  `WorkspaceIndexEntry` (storeUid, projectId, targetLineId, changeInstanceId, planning.root,
  execution.root) and writes `<executionRoot>/.rasen/planning-binding.json`. The index is exactly
  the machine-local map from Change instance to execution root that attribution needs.
- **The plan revision itself** — node → `changeInstanceId` (+projectId/targetLineId/alias),
  verified at publication against committed Store evidence. This IS the durable binding; no
  launch record needs inventing.
- Machine registry: this worktree is registered as project `issue-layer`
  (`E:\…\.claude\worktrees\issue-layer`), so the L6 checkout route is live for the dogfood.

## Goals / Non-Goals

**Goals:**

- `rasen store issue start` resolves the runnable frontier node and its bound execution context,
  and emits the launch contract (issue/node/instance/alias/project/line/cwd/attached roots/
  pipeline) in human and `--json` forms.
- Attribution widening: node run-state located through the workspace index from any working
  directory, per-node `locatedBy` labelling, per-node Run/Session/evidence attribution facts.
- A real closed-loop dogfood on this portfolio with receipts, reusing C1's store recipe and trap
  list.

**Non-Goals:**

- No spawning of the pipeline/LEAD (`agent dispatch` contracts are leaf-only; supervised hosted
  sessions are daemon territory — both out of fence).
- No management-api routes, no web UI, no board.
- No new durable records (no launch log, no issue-side run pointer) — read-time derivation only.
- No `blocked`/`stale` health graduation — no real signal is recorded by this change, so none is
  derived (the reserved values stay reserved; fabricating one is the dishonest version).
- No cross-project fan-out, no auto-decompose, no version bumps; `src/core/pipeline-registry/`
  and `packages/ui/**` are imported-or-untouched, never modified.

## Decisions

### D1 — New module `src/core/issue-execution/`; `issue-status` extended in place

The launch binding is not status projection, so it gets its own module
(`src/core/issue-execution/{types,binding,index}.ts`) rather than bloating the one seam that
exists. The attribution WIDENING, however, extends `src/core/issue-status/` in place (new optional
inputs, richer node facts) — per the C1 handoff there is no third status seam, and omitted inputs
reproduce C1 behavior byte-for-byte. `issue-execution` imports store query types, the workspace
index reader, and `resolveSessionLaunchContext` (core→core, same direction `issue-status` already
takes toward `pipeline-registry`); the command layer gathers machine inputs (root resolution,
store identity, index entries) exactly as C1's `resolveProjectionContext` does.

### D2 — `start` resolves, verifies, and emits; it does not spawn

The golden path's "从目标项目 cwd 启动现有 Pipeline" is executed by an agent session (the LEAD
workflow) from the resolved cwd — no CLI seam spawns a LEAD today, and building one means either
leaf-contract abuse (`agent dispatch` validates `leaf|consultable-leaf|evaluate` only) or the
daemon's hosted-session surface (out of fence). The honest CLI-first deliverable is the verified
launch contract: cwd, attached planning root, change identity, pipeline, and the resume
orientation when the node already runs. Alternatives rejected: spawning via `agent dispatch`
(contract mismatch), a `session exec` detour through the daemon (needs a running daemon + wire
protocol — surface growth with no golden-path need).

### D3 — The frontier derives from observations, not the query's `blockedBy`

`ResolvedPlanNode.blockedBy` comes from the plan read's archive-based readiness, so a node whose
dependency has terminal run-state but is not yet archived still reads as blocked. `start`'s
frontier uses the projection's observations: a node is runnable when it is change-kind,
`not-started`, and every `dependsOn` node's observation is terminal (`finalized|run-terminal`).
The refusal for a `--node` that is not runnable names the non-terminal dependencies by the same
observation rule. This matches the spec language "dependencies' work is complete" and the
progress-counting rule C1 already fixed (finished-but-unarchived counts).

### D4 — Launch-context routes, in a fixed order

1. **Workspace pair**: index entries filtered by storeUid + the node's `changeInstanceId`;
   exactly one entry → `form: 'workspace-pair'`, cwd = `entry.execution.root`, attached = the
   Store planning root. Several entries → refuse naming them (no implicit choice). This route
   needs no machine project registry — the index records the root.
2. **Member-project checkout**: the L6 composition via an injectable
   `launchContextFor(projectId)` (production default wraps `resolveSessionLaunchContext({ space:
   storeId, execution: 'project:<projectId>' })`). Success → `form: 'project-checkout'` with the
   composition's cwd/attachedRoots; failure → the composition's own diagnostic and repair
   guidance pass through unchanged (membership and identity refusals stay actionable).
3. **Neither** → refuse `issue_start_unprepared` with the exact
   `rasen store workspace plan --existing-change --store … --project … --target-line … --change <alias>`
   preparation line — the pair machinery's own two-step stays the sanctioned writer of bindings.

### D5 — Pipeline resolution and disagreement

`--pipeline <name>` is validated against the prepared pipeline registry when supplied (read-only
use of the frozen module's loader). Resolution order: `--pipeline` > the pipeline recorded in the
addressed node's located run-state > null (the contract then says the pipeline is chosen at
launch). For an already-running node, a `--pipeline` that disagrees with the recorded one is
refused naming both — a running pipeline is not renamed by a flag.

### D6 — Locator widening: index roots after the current root

`ProjectIssueStatusInput` gains `workspaceEntries?: readonly WorkspaceIndexEntry[]`
(storeUid-filtered by the caller) and `storeRoot?: string`. Per change node, after the C1 chain
(current execution root → its legacy work dir → planning change dir) finds nothing, each matching
index entry's `execution.root` is probed with its own chain: `ephemeraDir(entryRoot, alias)` then
the entry's planning-side change directory (`resolveStorePlanningLayoutV2Path(planningRoot, {
kind: 'active-change', projectId, changeId })`, computed per entry — no ambient reads). The
machine-home work-dir leg applies only to the current execution root: the legacy work dir is
keyed to that root's identity, not to an index root. First hit wins; `IssueNodeStatus.locatedBy`
labels `'execution-root' | 'workspace-index' | null`. `runStateVisibility` keeps describing the
current root; the per-node label carries the index source (the MODIFIED projection requirement).

### D7 — Attribution facts are durable-only

`IssueNodeStatus.attribution` carries `pipeline` (from the located run-state), `sessions`
(per-stage durable worker facts: stage id, role, runtime, `sessionId?`, `threadId?`,
`transcript?` — `agentId` is a live handle and is excluded by construction, mirroring the
run-state contract's own wording), and `evidenceLocator` (`evidenceDir(changeDir)` when the
change's planning directory resolves — from the current `changesDir` or the store-side
active-change address via `storeRoot` + the committed claimant's ids). Portfolio-observed nodes
locate `portfolio-run.json`, whose shape carries no stage workers: their `sessions` list is empty
and honestly so; the parent's own `auto-run.json` is not silently substituted (that would
attribute the LEAD's session to the child).

### D8 — No second truth, guarded

Everything above is derived at read time; `start` and the widened reads write nothing. The C1
read-only guard family extends to cover `start` and the attribution read over the same file set
plus the workspace index and `.rasen/planning-binding.json`.

### D9 — Dogfood: the closed loop on this portfolio (phases, receipts, fallbacks)

Phase A (rebuild, C1 recipe + traps): OS-temp store `issue-layer-dogfood` (setup refuses
in-worktree paths), hand-declared `layoutVersion: 2`, `store add-project <worktree> --to …`
(expect the `rasen/config.yaml` + `.rasen-store/store.yaml` double write; clean both at teardown),
`store target-line add main` + `set-ref` with the project code ref set to `feat/issue-layer`,
seed + commit the three child changes with v2 identity (explicit list, ALL scalars quoted),
`store issue new issue-layer-phase1` + plan publish (three change nodes).

Phase B (fresh-launch receipt, before any index entry): from the STORE ROOT,
`store issue start issue-layer-phase1` — with no index entry and no execution root visible from
the store root, the frontier is g-001 (not-started) and the contract resolves through the L6
checkout route (`project:issue-layer`), emitting THIS worktree as the launch cwd. Receipt 1.

Phase C (attribution receipt): `store workspace plan --existing-change --change
issue-execution-binding --project <pid> --target-line main --planning-worktree <temp> |
--execution-worktree <this worktree>` → `apply` (records the index entry whose execution root is
this worktree and writes `.rasen/planning-binding.json` inside it — untracked, cleaned by
`workspace cleanup`). Then from the STORE ROOT: `store issue show issue-layer-phase1` — g-001
observed run-terminal from the real archived run via the index, g-002 (this change) observed
in-flight via the index, `locatedBy: workspace-index` labelled. `store issue start` again → now
reports g-002 already-running with its recorded pipeline. Receipt 2 (the attribution transition
and the honest already-running mode). Fallbacks: if pair planning refuses the reused execution
worktree, set the dogfood target-line code ref to the worktree's branch and retry; if reuse is
refused outright, fall back to a fresh execution worktree E + `initializeRunState`-born run-state
in E (real writer, pending stages) and capture the index-located read of that state — weaker,
still real; if pair planning refuses the membership-only project, declare the dogfood project
catalog's planning binding in the fixture's own shape. Whichever path is taken is recorded.

Phase D (teardown): `store workspace cleanup` (index entry, association file, planning worktree),
`store remove issue-layer-dogfood --yes`, `git restore rasen/config.yaml`, delete the temp store
tree; receipts under `evidence/` preserved. Zero branch footprint beyond the change's own files.

### D10 — Command surface mechanics

`start <issue-id>` joins `new|list|show|state|plan` in `src/commands/store-issue.ts` with
`--node`, `--pipeline`, `--store`, `--json`; locale entries added for the subcommand and both
options in en/ja/zh-cn (`applyCliPresentation` enforces structural parity, so the three files
land together). `show`'s per-node block gains the attribution lines (pipeline, locatedBy,
sessions, evidence locator). Renderers stay English-literal per the file's convention. The index
entries are gathered once per command via `listAllWorkspaceIndexEntries` +
`productionStoreQueryDependencies.coordination(...)`, filtered by the resolved store's `storeUid`
(`resolveQueryStore`), and injected — tests inject synthetic entries and a fake
`launchContextFor`, never a machine registry.

## Risks / Trade-offs

- [Workspace pair reuse of this worktree may hit unplanned validation] → D9's two named
  fallbacks; whichever path runs is recorded in the receipt, and a dogfood that cannot reach the
  attribution receipt blocks ship (anti-theater rule).
- [L6 composition's inputs are daemon-shaped] → it accepts generic selectors and performs no
  spawn; the injectable seam keeps the module deterministic; signature drift is caught by unit
  tests at apply time.
- [Observation-based frontier can disagree with the query's blockedBy] → deliberate (D3); the two
  answer different questions (work-complete vs archive-final), and `show` continues to print the
  plan-read `blockedBy` on the node line while `start` explains its own rule in refusals.
- [Index lookup by instanceId across planning scopes] → filtered by storeUid first, exactly as
  `gatherReferenceEvidence` does; several matching entries are refused, never averaged.
- [Locale parity is mechanical but three-file wide] → task pairs with the structural-parity test
  run; a missing entry fails presentation tests, not silently.

## Migration Plan

None: additive read-only (new subcommand, extended inputs with C1-identical defaults). Rollback
reverts the commit; no durable state anywhere is created by the new surface.

## Open Questions

None blocking. Deferred by design: daemon-side session-registry attribution (the supervised
session's own records, beyond run-state pointers) and management-api routes for binding/status —
later phases' board work; and `blocked`/`stale` graduation, which needs a recorded signal neither
this change nor C1 fabricates.
