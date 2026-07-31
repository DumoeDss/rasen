## Context

The approved file-placement model has two repository-visible authorities:

- the **planning root**, which owns specs, changes, evidence, handoff, archives,
  and root-level design docs; and
- the **execution root**, which is the exact checkout/worktree that owns code,
  probes, and `.rasen/changes/<change>/ephemera/`.

They are the same path for an in-repo project but different paths when a Store
owns planning for a member project or linked worktree. Legacy machine-home work
is project-owned, so its lookup must follow the execution checkout rather than
the Store.

The current work command passes only `root.path` and `changesDir` into the
migrator. `planWorkMigration` then infers execution from `process.cwd()` and a
`storeSelected` boolean, while `runWorkMigration` resolves machine home from
the planning root. The command does not pass Store/project selectors at all.
Interactive mode calls `runWorkMigration` once for preview and a second time
after confirmation, so filesystem and root inference can change the action set
between the two calls.

The completed migration-safety dependency replaced mutation-time
classification with an immutable `WorkMigrationPlan`. Its apply stage consumes
ordered actions with source fingerprints, destination preconditions, a
complete-plan blocker, no-clobber publication, and fail-closed filesystem
handling. This change must use that seam, not create a parallel migration
engine.

Session launch already resolves and freezes two independent values in every new
registry record:

- `record.space`: planning attribution; and
- `record.execution`: either the exact project checkout/worktree or explicit
  planning-only execution.

The Sessions listing currently ignores the latter when joining run-state. It
constructs ephemera and machine-home locations from `record.space.root`, which
misroutes Store sessions.

## Goals / Non-Goals

**Goals:**

- Freeze one explicit root context before work migration planning.
- Make Store/project selection available on `rasen work migrate` through the
  shared root selector.
- Route each migration class from its owner root without downstream inference.
- Apply the exact `WorkMigrationPlan` displayed or emitted for the invocation.
- Keep the current human/JSON report contract and no-mint preview behavior.
- Join session terminal state from the recorded execution checkout while
  retaining planning-space filtering and planning change paths.
- Preserve all migration-safety scoping, fingerprint, no-clobber, and
  fail-closed guarantees.
- Cover Store plus two-worktree routing and deterministic Windows/POSIX path
  identity.

**Non-Goals:**

- Archive execution, archive accounting, cleaner policy, or evidence hashing.
- Reclassification of migration actions or changes to the foundation's
  filesystem mutation algorithms.
- Workflow/skill template changes or the final authoritative documentation
  sweep.
- A new placement configuration surface.
- Re-resolving or repairing stale session execution context.
- The final real-OS CI matrix, which is owned by the closure change.

## Decisions

### D1. Freeze a typed migration root context at the command boundary

Introduce an explicit value with this conceptual shape:

```ts
interface WorkMigrationRootContext {
  planningRoot: string;
  changesDir: string;
  executionRoot: string;
  legacyHomeOwnerRoot: string;
  pathIdentityFlavor: PathIdentityFlavor;
}
```

`work.ts` creates it once after `resolveRootForCommand` succeeds:

- project/in-repo selection: `planningRoot`, `executionRoot`, and
  `legacyHomeOwnerRoot` are the selected project root;
- Store selection: `planningRoot` and `changesDir` are the Store values,
  `executionRoot` is resolved once from the invocation checkout/worktree using
  the existing file-placement resolver, and `legacyHomeOwnerRoot` equals that
  execution root;
- `pathIdentityFlavor` is the exported native foundation constant in production
  and is injectable as `win32` or `posix` in tests.

The context contains resolved paths rather than a `storeSelected` hint. Neither
the planner nor apply may consult `process.cwd()`, Store membership, project
registration, or Git to choose a different execution root.

`--store` and `--project` are added to the `migrate` subcommand and passed
unchanged to `resolveRootForCommand`. The shared resolver continues to own
mutual exclusion, namespace selection, diagnostics, and JSON failure handling.
No custom Store lookup is introduced.

Alternative considered: continue passing the planning root plus
`storeSelected`. Rejected because a boolean cannot identify the selected member
worktree and leaves the lower layer dependent on mutable cwd.

### D2. Make the immutable plan carry the resolved routing authority

`planWorkMigration` accepts the root context and resolves an existing
machine-home read-only from `legacyHomeOwnerRoot`. Planning destinations use
only:

- `planningRoot`/`changesDir` for reports, handoff, archived material, and
  design docs;
- `executionRoot` for active run-state, probes, and sampling ephemera; and
- the legacy home resolved for `legacyHomeOwnerRoot` for migration sources.

The plan gains an additive frozen root-context projection, including
`pathIdentityFlavor` and `legacyHomeOwnerRoot`. Existing `projectRoot`,
`changesDir`, `executionRoot`, and `machineHome` fields remain as compatibility
aliases/projections for current tests and callers; `projectRoot` is populated
with the planning root. The plan is ephemeral, so this additive change does not
require a persisted-state migration.

The existing in-repo call signature may remain as a narrow compatibility
adapter while callers migrate: it constructs a context with all owner roots
equal and never infers Store routing. Every Store-capable caller must use the
typed context. The ambiguous `storeSelected` planning option is retired from
the root-capable path.

Alternative considered: add independent optional `planningRoot` and
`executionRoot` parameters. Rejected because partial inputs recreate fallback
branches and allow an invalid half-context.

### D3. Plan once and project reports around the same plan

Expose or factor the existing report projection so `work.ts` can:

1. build one `WorkMigrationPlan`;
2. project and print/emit its preview;
3. stop for `--dry-run`, JSON without `--yes`, cancellation, blockers, or an
   empty plan;
4. pass that exact plan object to `applyWorkMigration`; and
5. project the apply outcomes against the same plan for the result report.

Interactive confirmation never invokes `planWorkMigration` or
`runWorkMigration` again. JSON `--yes` also plans once and applies that plan.
The compatibility `runWorkMigration` wrapper follows the same internal
plan-once/apply-once sequence.

If no legacy machine home already resolves, planning remains read-only, emits
the existing pending/no-identity note, and contains no fabricated
machine-home-dependent actions. Apply does not discover new candidates or
destinations behind the confirmed preview. Terminal destination directories
are still created only by their planned actions.

The existing human and JSON projections remain the compatibility boundary.
Root fields may be added, but existing keys, summary meanings, and failure
payloads are unchanged.

Alternative considered: after confirmation, ensure machine identity and run
the planner again. Rejected because it changes both authority and actions after
the user approved them.

### D4. Preserve the migration-safety plan/apply contract verbatim

Root routing changes only planner inputs and command orchestration. It does not
change:

- scope filtering before filesystem inspection;
- action ordering or classification;
- source fingerprints and destination preconditions;
- complete-plan blockers;
- no-clobber link/copy publication;
- narrow cross-device fallback;
- conflict preservation;
- archived run-state deletion rules; or
- fail-closed treatment of non-absence filesystem errors.

Tests for the new root context assert those properties at the Store/worktree
boundary rather than duplicating foundation implementation.

### D5. Split session planning paths from terminal lookup paths

`handleListSessions` continues to filter by `record.space.root` and builds the
planning `changeDir` from that frozen space. Before joining terminal state it
requires:

- a `changeName`;
- a recorded planning space; and
- `record.execution.kind === "project"` with its frozen root still available.

For a usable project execution record, locations are:

1. `ephemeraDir(record.execution.root, changeName)`;
2. legacy work directory resolved read-only with
   `resolveHomeForRoot(record.execution.root)`; and
3. the planning `changeDir` as the oldest sticky-legacy location.

The registry's copied `record.execution` value is authoritative. The listing
does not re-run project selectors, check current Store membership to choose a
new member, or use the daemon launch project.

If execution is missing (older/unattributed record), explicitly
`planning-only`, or its checkout has disappeared, the join returns the existing
wire-compatible `{kind: "absent"}` sentinel. In particular, it does not call
`buildChangeRunEntry` with planning-only locations, because that would turn the
Store into an invented execution root. Availability checking is read-only; an
unexpected inspection error is surfaced through the existing per-entry error
shape rather than triggering a fallback.

Alternative considered: use `record.cwd`. Rejected because cwd is an
observable process field, whereas `record.execution` is the validated and
typed runtime authority.

Alternative considered: fall back to `record.space.root` for old session
records. Rejected because a plausible wrong Store run-state is more dangerous
than an explicit absence, and session records are in-memory/bounded rather than
durable data requiring migration.

### D6. Test roots and path identity independently

Core migration tests construct `WorkMigrationRootContext` directly and inject
both foundation `PathIdentityFlavor` values. Command tests cover selector
threading and assert that the same plan reference reaches apply. Integration
tests create:

- one Store planning root;
- one member Git repository;
- main and linked worktrees; and
- same-named terminal state in competing Store/member/worktree locations.

They verify planning destinations remain in the Store and execution
destinations/legacy-home lookup select only the invocation worktree. Session
tests use frozen registry records to cover member ephemera, execution-owned
legacy home, later registration/pointer changes, missing execution,
planning-only execution, and a removed checkout.

All expected paths are built with `path.join`/`path.resolve`; win32-versus-POSIX
identity assertions use the explicit flavor instead of the host OS or ESM path
namespace identity. The closure child remains responsible for running the
focused suite on actual Windows, macOS, and Linux.

## Risks / Trade-offs

- **[Risk] Additive plan fields expose two names for the planning root.** →
  Keep `projectRoot` as a documented compatibility projection and use
  `rootContext.planningRoot` in all new code; remove the alias only in a future
  deliberate API change.
- **[Risk] A Store migration invoked outside the intended member checkout could
  freeze the wrong execution root.** → Reuse the existing shared selection and
  file-placement execution resolver once at the command boundary, report the
  frozen roots in the plan, and never silently switch them later.
- **[Risk] A checkout can disappear while a supervised session remains in
  memory.** → Return an explicit absent join and preserve the frozen session
  record for diagnostics; never retarget.
- **[Risk] Compatibility report refactoring could change JSON or human
  summaries.** → Test existing output snapshots/field assertions before adding
  optional root data.
- **[Risk] Root work overlaps foundation migration code.** → Limit edits in
  `work-migration.ts` to context inputs, compatibility projections, and report
  projection exposure; do not edit classifier or mutation algorithms.

## Migration Plan

1. Add root-context construction and plan compatibility fields with pure unit
   tests.
2. Refactor `work migrate` to accept shared selectors and use one
   plan/preview/apply sequence.
3. Route Sessions joins through frozen `record.execution` and add fail-closed
   missing/stale cases.
4. Run focused command, migration, and management API suites plus typecheck.
5. Hand the focused evidence and any main-spec wording conflict to the closure
   child for final docs/schema reconciliation and the real-OS matrix.

Rollback is local and additive: revert the command/context/session consumer
changes together. No persisted plan or session migration is required.

## Open Questions

None. The parent design fixes ownership, the foundation fixes apply semantics,
and the existing session runtime context already carries the required frozen
execution authority.
