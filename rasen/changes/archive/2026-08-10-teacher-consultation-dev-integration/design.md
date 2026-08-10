## Context

The Teacher consultation runtime was implemented and locally shipped as `3c595019`, its ship evidence was recorded by `f6d6854c`, and it was archived and spec-synced by `914c836a`. Integration remains on the existing `feat/teacher-advisor-workflow` branch at pre-merge `914c836a`; the pinned dev input is `origin/dev/0.2.0@96452f5c`. Their merge base is `91d71d6c`, which is also the direct parent of `3c595019`; the two branches therefore share the complete pre-integration ECP architecture.

The cumulative Teacher branch changes 98 final paths. Only 14 paths also differ between `91d71d6c` and current dev, and a three-way merge reports eight textual conflicts. The later dev work adds Codex dispatch, task-loop runtime guards, reusable-session ownership, cross-platform SessionHost fixes, and revised shutdown behavior. It does not replace the frozen-action executor's daemon-owned `SessionHost` seam.

Current execution ownership has three separate lanes:

- frozen ordinary/source Actions use the ordinary daemon-owned `SessionHost` and its best-effort `ProcessScope`;
- exact Teacher attempts use a dedicated provider-backed `SessionHost`, registry, attempt journal, and exact recursive-retirement authority;
- interactive reusable sessions use `ReusableSessionService`, its durable coordinator, and the management supervisor.

The Teacher source continuation belongs to the first lane, and Teacher execution belongs to the second. The reusable-session coordinator is not canonical frozen-action execution authority. The integration must compose their construction and shutdown without moving authority between them.

The archived runtime evidence proves the original product tree `4dc349a4e947577236f38d73ba9b35f0b3a51e3a` at `3c595019`. It does not prove the combined integration tree. The integration child owns new evidence and must leave the archive immutable.

## Goals / Non-Goals

**Goals:**

- Preserve the original Teacher implementation, evidence, archive, and commit identities while merging pinned current dev into the existing Teacher branch.
- Resolve all eight textual conflicts by retaining both dev and Teacher semantics rather than selecting an entire side.
- Keep `consultable-leaf` restricted to the exact continuable hosted path and reject Codex consultation work before dispatch.
- Recover task-loop consultations after daemon restart with the same trusted workspace observation and report exclusions used by a freshly prepared task-loop runtime.
- Drain reusable, ordinary hosted, and exact-Teacher owners together during clean management-server shutdown.
- Re-run focused, full related, actual-Windows, Linux CI, strict artifact, and independent review gates against the combined tree.

**Non-Goals:**

- Reimplementing or redesigning consultation contracts, exact Teacher authority, workspace fencing, or the archived runtime.
- Moving frozen-action source continuation into the reusable-session coordinator.
- Adding Codex stable hosted continuation or making the current consultable JSON contract a Codex structured-output contract.
- Upgrading ordinary/source SessionHost process authority to exact recursive retirement.
- Adding a macOS exact Teacher provider; macOS remains typed unavailable before Teacher activation.
- Editing the parent portfolio state or treating the old runtime evidence as current integration evidence.
- Implementing the dependent Teacher workflow or Canvas changes.

## Decisions

### 1. Merge pinned dev into the Teacher branch without rewriting its three delivered commits

On the existing `feat/teacher-advisor-workflow` branch, create or retain a backup ref that points to its pre-merge `914c836a` HEAD. Then merge pinned `origin/dev/0.2.0@96452f5c` with `--no-ff --no-commit`. The completed merge commit is the integration product, with Teacher `914c836a` as its first parent and dev `96452f5c` as its second parent; `3c595019`, `f6d6854c`, and `914c836a` remain reachable with their original object identities.

Do not rebase, squash, or cherry-pick the Teacher commits. Those strategies would either rewrite or duplicate the commit named by the archived ship log. A manual file transplant is also rejected: 84 non-overlapping final paths already have an exact three-way history, and recreating them would risk omitting durable authority fields or tests.

Before merging, verify the pinned dev SHA, Teacher pre-merge HEAD, backup ref, and merge base. After merging, verify the parent order as well as reachability; use the merge diff and `git range-diff`/history inspection only as diagnostics. The acceptance gate is the combined behavior and fresh evidence, not textual similarity alone.

### 2. Resolve the eight textual conflicts as a fixed semantic matrix

| Conflict | Required integrated disposition |
| --- | --- |
| `rasen/specs/frozen-action-session-executor/spec.md` | Keep current dev's normalized end-of-file formatting and the complete Teacher requirement append. No requirement or scenario is dropped. |
| `src/core/change-run/internal/facade-runtime.ts` | Preserve dev launch-intent validation, task-loop workspace validation/report regeneration, and completion-stimulus order; preserve Teacher consultation classification, advice settlement, continuation grants, sponsored reservation release, terminal cleanup, and receipt projection. Task-loop and consultation counters remain independent. |
| `src/core/change-run/internal/reconciler.ts` | Preserve task-loop phase inputs, blocked escalation, and eventual-result behavior; preserve Teacher invocation derivation, direct Teacher admission, and source continuation. Consultation transitions never advance task-loop/BoundedLoop progress or strategy attempts. |
| `src/core/change-run/internal/runtime-context.ts` | Use one `node:path` import; preserve task-loop filtered workspace observation/report paths and Teacher frozen bindings, service-scoped reservations, hosted-receipt verification, and stored-runtime reopen. Reopen receives trusted daemon workspace context as described in Decision 5. |
| `src/core/management-api/router.ts` | Preserve dev `runsRoot`, reusable-session endpoints/service, body-abort handling, and reusable shutdown handle; preserve the Teacher continuation endpoint, exact-provider policy, dedicated exact SessionHost/journal, producer resolver, and separate state root. Construct all three lanes without sharing ordinary and exact hosts. |
| `src/core/management-api/server.ts` | Preserve current reusable owner shutdown/error propagation and Teacher host-state/producer defaults. Drain reusable, ordinary, exact-Teacher, and path-chooser owners as one bounded operation, without a second direct supervisor shutdown. |
| `src/core/worker-contracts.ts` | Preserve Codex-required nullable schemas and normalization for ordinary leaf/evaluate results; preserve the separate bounded `consultable-leaf` schema/parser and ordinary leaf rejection of `CONSULT`. Do not make consultable output available to Codex. |
| `test/core/session-host/claude-backend.test.ts` | Preserve the cross-platform `path.resolve` executable fixture and the Teacher sandbox-derived `--permission-mode acceptEdits`/resume argv expectations. |

The other six overlapping paths still require semantic review even if Git merges them automatically:

- `src/commands/agent.ts` must combine Codex dispatch with the Claude-only consultable guard in Decision 4.
- `src/core/change-run/facade.ts` must expose both launch-request digest consistency and continuation grants.
- `src/core/change-run/internal/projector.ts` must project both task-loop and consultation sections from canonical state.
- `src/core/pipeline-registry/index.ts` must export both later dev policy types and Teacher consultation profile types.
- `src/core/session-host/registry.ts` must retain dev's platform-aware absolute-path validation and Teacher exact-attempt persistence fields.
- `test/fixtures/trusted-completion.ts` must retain multi-pipeline provisioning and Teacher trusted-adapter credentials.

### 3. Keep the three session lanes separate and compose only at management ownership

Ordinary/source frozen Actions continue through `ProductionExecutor` and the ordinary `SessionHost`. The exact-Teacher Module continues through its dedicated provider-backed `SessionHost`. `ReusableSessionService` continues through the supervisor-backed durable coordinator. No one lane may use another lane's registry record as execution authority.

The management router owns construction and exposes lifecycle handles. State roots are explicit and disjoint, built with `path.join`/`path.resolve`: ordinary SessionHost state, exact-Teacher SessionHost plus journal state, and reusable-session durable state must not alias. An exact host override must remain paired with its exact attempt committer, and the exact host must never be the ordinary host instance.

Alternative: route source continuation through reusable sessions. Rejected because it would change the frozen execution authority, provider support, request identity, and recovery store after the consultation was already committed.

Alternative: globally use the exact provider-backed host. Rejected because it would widen ordinary/source availability and retirement claims and make macOS ordinary hosted work depend on an exact provider.

### 4. Reject `codex + consultable-leaf` before any agent process starts

The automatic merge of Codex support and the Teacher contract would otherwise make `consultable-leaf` appear valid for Codex. Current Codex execution is an exec/thread lane without the stable hosted Session authority required by continuation, while the Teacher consultable JSON Schema uses conditional/optional shapes that are not the current Codex structured-output contract.

The command/runtime validation must therefore reject the pair `(runtime: codex, contract: consultable-leaf)` with a typed invalid-input result before binary resolution or spawn. Existing Codex `leaf` and `evaluate` behavior remains unchanged. Claude hosted execution retains `consultable-leaf`; ordinary Claude `leaf` still rejects `CONSULT`.

Do not silently downgrade the contract to `leaf`, silently reroute Codex to Claude, or start a replacement source Session. Future Codex continuation requires its own capability/spec change.

### 5. Reopen task-loop consultation state from daemon-owned workspace identity

Current `prepareRuntimeContext` supplies task-loop with a trusted live workspace observer that excludes the generated task-loop report and task-loop ephemera before deriving the workspace revision. The Teacher `openStoredRuntimeContext` restores the persisted plan/profile/Record but predates this dependency. Calling task-loop completion through that reopen path without an observer can fail `workspace-scope-mismatch`, and accepting HTTP `hostedSeam.cwd` would turn caller input into workspace authority.

Extract or reuse one helper that builds the task-loop evidence directory, normalized report path, ephemera exclusion, and observer from a canonical project root. Both fresh preparation and stored reopen use this helper so their path normalization and filtering cannot drift.

For a stored consultation reopen, resolve the source stable Session from the canonical Record/continuation grant, then inspect the daemon-owned ordinary SessionHost registry. Require exact agreement on source Action/Invocation, role, workspace instance, backend, stable Session id, canonical cwd, and cwd digest before constructing the observer. The daemon may use the settled ordinary Session result for the first source `CONSULT` turn or the durable registry for restart; request-supplied cwd is never sufficient.

If canonical source workspace identity is missing, ambiguous, non-canonical, or disagrees with the Session registry, return a typed wait/failure before Teacher admission, advice commitment, continuation, task-loop report generation, or Run mutation. Preserve the task-loop rule that intermediate consultation transitions do not count as progress; only the eventual source result reaches task-loop/BoundedLoop lifecycle evaluation.

Alternative: skip task-loop observation for synthetic Teacher completions. Rejected because it creates two completion safety policies and leaves source continuation/restart dependent on which action happened to trigger reopen.

Alternative: persist a new cwd supplied by the management request. Rejected because the frozen action/session authority already owns cwd identity and caller input cannot strengthen it.

### 6. Treat clean shutdown as one bounded multi-owner drain

`ReusableSessionService.ownerShutdown()` owns supervisor shutdown and its durable reusable-session accounting. The server must not also call `supervisor.shutdownAll()` directly. In parallel with that owner shutdown, drain the ordinary `SessionHost`, optional exact-Teacher `SessionHost`, and path chooser. Use `Promise.allSettled` or an equivalent complete-observation pattern so one early rejection does not prevent the other owners from being asked to stop.

Preserve the reusable drain guard and each SessionHost's own bounded graceful/forced close contract. A successful `stopServer()` means every present lane published a successful shutdown outcome. Any timeout, rejection, retained exact authority, or reusable owner failure is surfaced after all drains are observed; the server must not report a clean stop while an owned process tree is unresolved.

Shutdown does not delete durable registries, exact references, attempt journals, or retained authority. Restart continues to reconcile those stores through their existing owners.

### 7. Separate historical runtime evidence from integration evidence

The archive under `rasen/changes/archive/2026-08-10-teacher-consultation-runtime/` remains byte-preserved. Its review, platform report, ship log, commit, and tree continue to describe the Teacher-only branch. Do not edit those files to mention the merge or copy their PASS into this child as a current result.

The integration child must create its own evidence set after the combined tree exists:

- a verification report identifying the exact target SHA, Teacher merge commits, merge result SHA/tree, commands, counts, and platform classifications;
- an independent review report covering the merge resolution and the two latent semantic risks;
- platform evidence that distinguishes deterministic provider conformance, actual Windows native evidence, and actual Linux CI evidence;
- a ship log produced only after the integration product commit is known.

Old evidence may be cited as historical input, but every current PASS must name and test the integrated tree.

### 8. Verification is layered and cross-platform

During conflict resolution, run the smallest suites for the affected seam. Before completion, run all Teacher consultation/exact-authority suites plus the later dev task-loop, Codex, reusable-session, SessionHost, management shutdown, and cross-platform path suites. Add discriminating regressions for:

- Codex consultable rejection before spawn;
- task-loop source `CONSULT`, daemon replacement, trusted reopen, exact continuation, and unchanged task-loop counters/report guards;
- simultaneous presence and clean shutdown of reusable, ordinary hosted, and exact-Teacher owners, including one-lane failure while the others still drain;
- Windows path identity plus Claude executable/permission argv composition.

Final gates include TypeScript, lint, build, full related Vitest, strict Rasen validation, `git diff --check`, strict UTF-8/no-BOM/mojibake inspection of edited text, provider-neutral conformance, actual Windows native tests, equipped Linux CI, and independent non-author review.

## Risks / Trade-offs

- [A textually clean auto-merge enables unsupported Codex consultation] -> Add a pre-spawn runtime/contract guard and a discriminating no-spawn test.
- [Stored task-loop completion trusts a request cwd or lacks an observer] -> Resolve workspace identity only from canonical Record plus daemon SessionHost facts and share the fresh-runtime observer helper.
- [One shutdown failure short-circuits other owners] -> Start every drain, observe all outcomes, and surface failure only after the full set settles.
- [Calling both reusable owner shutdown and supervisor shutdown races ownership] -> Make reusable owner shutdown the sole supervisor drain and keep ordinary/exact SessionHosts separate.
- [Conflict resolution drops task-loop or consultation stimuli ordering] -> Test combined task-loop consultation journeys and compare canonical Record transitions/counters, not only compilation.
- [Replacing `session-host/registry.ts` with the Teacher side loses current Windows/Linux path fixes] -> Resolve by three-way hunks and retain the platform-specific absolute-path decoder test.
- [Old PASS evidence is presented as integrated proof] -> Keep the archive immutable and require evidence paths owned by this child with the integrated SHA/tree.
- [Linux provider simulation is mistaken for native evidence] -> Label deterministic/cross-target conformance separately and require equipped Linux CI for the native gate.
- [A retained exact Teacher authority is hidden by server shutdown] -> Propagate the exact host's retained/failure result and keep its durable recovery stores intact.

## Migration Plan

1. On existing `feat/teacher-advisor-workflow` at `914c836a`, retain a pre-merge backup ref; pin `origin/dev/0.2.0@96452f5c` and verify `91d71d6c` as the merge base.
2. Merge pinned dev with `--no-ff --no-commit` without rewriting history; the final merge must have Teacher `914c836a` as first parent and dev `96452f5c` as second parent, while preserving `3c595019`, `f6d6854c`, and `914c836a` as reachable original commits.
3. Resolve the eight textual conflicts using Decision 2, then review all six automatically merged overlap paths.
4. Implement the explicit Codex consultable rejection, daemon-owned task-loop reopen observer, and multi-owner shutdown composition.
5. Add the discriminating integration tests and run focused checks until stable.
6. Run the full related, TypeScript, lint, build, strict Rasen, diff/encoding, Windows native, Linux CI, and independent review gates; write only this child's fresh evidence.
7. Commit and deliver the integration result, then archive this child before starting `teacher-advisor-workflow`.

Rollback before delivery abandons the integration branch without changing either source history. After delivery, stop producing new consultation bindings, drain or safely retain every exact Teacher authority, and revert the integration merge as a unit only when the compatible reconciler has no unresolved exact authority. Never downgrade or delete an opaque authority journal merely to make an older binary accept the Record.

## Open Questions

No design decision is intentionally deferred. The implementation must not begin until the merge target still resolves to the pinned SHA or an explicit re-plan updates this change for a newer target.
