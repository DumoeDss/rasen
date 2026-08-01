# Review report - file-placement-hardening-archive-engine

- Mode: dispatched, report-only
- Rounds: 1-3
- Branch: `fix/pr121-file-placement-hardening`
- Authoritative baseline: `04cea87ae5bea9af2d90f526455b6ea513cd57e8`
- Scope: archive-engine implementation, archive CLI/accounting integration, generated archive consumers, and archive-focused tests/artifacts only
- Excluded: sibling root-routing/foundation implementation except where it is a direct archive dependency
- Verdict: **FINDINGS**

## Scope check

**REQUIREMENTS MISSING**

- Intent: one preview-first archive engine must derive a complete immutable plan, consume that exact plan, fail closed, stage and publish without clobbering, record truthful partial progress, resume the same transaction, finalize immutable evidence/accounting, and remove the active source last.
- Delivered: the delta centralizes substantial archive behavior in `src/core/archive-engine.ts`; validates sidecar, Git, evidence, cleaner, and quality inputs; uses same-parent staging and journals; hashes final evidence; writes accounting atomically; and has a useful direct-engine fault suite.
- Scope drift: no archive-owned implementation drift was found. Sibling work/root changes were excluded.
- Missing or partial requirements: the real CLI cannot apply or resume a displayed plan; source identity is content-only; final and spec publication are check-then-rename; cleaner progress is not crash-atomic; recommended generated consumers mutate specs outside the engine; blocked/partial JSON is not truthful; recovery skips payload re-verification; planning tree-state drift is not rejected; and consumer tests do not execute the generated workflows.

## Findings

### Standards

#### 1. Blocker - same-byte replacement of the active change passes both source checks and is recursively deleted

- Evidence: `ArchiveTreeEntry` records only path, kind, mode, size, hash, and symlink target at `src/core/archive-engine.ts:78-84`. `fingerprintArchiveTree` builds that semantic inventory at `src/core/archive-engine.ts:427-470`; it records no root or entry filesystem identity. Apply compares only the digest/serialized entries at `src/core/archive-engine.ts:2007-2014` and again at `src/core/archive-engine.ts:2260-2268`, then recursively removes the active path at `src/core/archive-engine.ts:2270-2272`.
- Failure: after planning, another process can remove the active directory and recreate the same paths with the same bytes and modes. The checks accept the new filesystem objects, publish the archive, and delete the replacement tree. Content equality is not authorization to delete a different path occupant.
- Reviewer reproduction: in a temporary planning root, plan an active change containing `proposal.md`, remove and recreate the entire active directory with identical bytes, then call `applyArchive(plan)`. The result was `complete`, and the recreated active directory did not survive.
- Test gap: `test/core/archive-engine.test.ts:144-154` exercises visible source drift by adding a file, not same-byte file or whole-root replacement.
- Spec/task: `specs/file-placement/spec.md:5` requires either an unchanged active source or exact recovery after interruption; `specs/file-placement/spec.md:22` requires no overwrite/destructive ambiguity; `tasks.md:55-56` requires exact disk-byte and no-clobber assertions for injected failures.
- Recommended action: bind the plan to platform-appropriate root and entry identities, perform stable-read checks while hashing, and revalidate the exact deletion authority immediately before source removal. Add same-byte file replacement and same-byte whole-directory replacement regressions.
- Triage: **ASK** - this changes the archive deletion authority model.

#### 2. Blocker - final publication is a check-then-rename and can replace a concurrently created target

- Evidence: `ensureDestinationAbsent` checks the final path at `src/core/archive-engine.ts:1493-1502`. Apply calls it at `src/core/archive-engine.ts:2191` and only afterward renames the stage to the final path at `src/core/archive-engine.ts:2193`. There is no exclusive reservation or no-replace publication primitive spanning that gap.
- Failure: on POSIX, a concurrent process can create an empty destination directory after the check; directory rename may replace that directory. A second archive transaction or unrelated creator can therefore be clobbered or cross-wired even though the contract claims exclusive publication.
- Test gap: `test/core/archive-fault-matrix.test.ts:224-244` creates a non-empty target before apply begins. It proves the preliminary check but not an interleaving between the check and rename, nor the POSIX empty-directory case.
- Spec/task: `specs/cli-archive/spec.md:13-14` requires publication without overwrite; `specs/file-placement/spec.md:22` requires a concurrently created target never to be overwritten; `design.md:89-96` requires exclusive same-parent publication.
- Recommended action: publish with a platform-correct atomic no-replace primitive or atomically acquired destination reservation, and inject a target creation exactly at the publication boundary on Windows, macOS, and Linux.
- Triage: **ASK** - the publication primitive is a cross-platform design decision.

#### 3. Blocker - spec create/update/delete actions have the same no-clobber race

- Evidence: `applySpecActions` validates every target first at `src/core/archive-engine.ts:1705-1776`, then mutates the pending actions in a separate loop at `src/core/archive-engine.ts:1778-1795`. Create/update writes a temporary file and calls `rename(temporary, action.target)` at `src/core/archive-engine.ts:1782-1789`, which replaces a concurrent target on POSIX. Delete recursively removes the capability directory at `src/core/archive-engine.ts:1779-1780` without rechecking its full identity or children.
- Failure: a spec created or changed after validation can be silently overwritten; a file added to a capability directory after validation can be recursively deleted. These mutations occur before final archive publication and before source-last removal, so a target race can alter planning specs while the archive returns only a recoverable result.
- Test gap: `test/core/archive-engine.test.ts:423-488` injects a partial spec-write failure but no concurrent create/update/delete at the mutation boundary.
- Spec/task: `specs/cli-archive/spec.md:5-7` requires the exact confirmed plan to be consumed without reclassification; `specs/file-placement/spec.md:22` requires no-clobber behavior; `design.md:97-101` requires ordered, recoverable prepared spec actions.
- Recommended action: give each spec action an atomic compare-and-publish/delete protocol. Create must be exclusive; update must replace only the validated identity; delete must bind and revalidate the complete capability-directory identity. Add boundary fault/race tests for all three actions.
- Triage: **ASK** - this requires a durable multi-file mutation protocol.

#### 4. Blocker - cleaner deletion can occur without ever becoming durable accounting

- Evidence: the cleaner loop unlinks first at `src/core/archive-engine.ts:2221`, updates only the in-memory `ephemeraDisposed` array at `src/core/archive-engine.ts:2222`, and writes the progress journal afterward at `src/core/archive-engine.ts:2223-2228`.
- Failure: a process or machine crash after unlink and before the journal write leaves the prior journal with no record of the actual deletion. On retry the planned candidate is already absent, so no new deletion is returned and final `archive.json` can omit a file that the archive transaction actually disposed.
- Test gap: `test/core/archive-fault-matrix.test.ts:604-650` throws before a later candidate is deleted. It does not inject a hard interruption after deletion and before journal durability.
- Spec/task: `design.md:97-101` requires per-candidate journal progress; `specs/file-placement/spec.md:5` requires exact recovery; `tasks.md:56` requires truthful actual cleaner progress for every injected failure.
- Recommended action: journal a durable per-candidate intent/result state around deletion and define recovery of an absent candidate from the durable pre-delete record. Add a post-unlink/pre-journal crash simulation that verifies final accounting.
- Triage: **ASK** - the journal schema and recovery semantics must change together.

#### 5. Major - recoverable results erase spec mutations that already happened

- Evidence: spec mutations are made one by one at `src/core/archive-engine.ts:1778-1795`, but `applyFailure` always returns `specsUpdated: false` and zero totals at `src/core/archive-engine.ts:1392-1422`. The journal is advanced only after the entire `applySpecActions` call returns at `src/core/archive-engine.ts:2169-2180`, so it also contains no per-action completion record.
- Failure: if action two fails after action one has changed a planning spec, the public result and recovery journal claim no spec update. Operators cannot distinguish no mutation from partial mutation, and retry infers completion by inspecting current bytes rather than consuming durable progress.
- Test gap: `test/core/archive-engine.test.ts:423-488` confirms the first target exists after the injected failure but does not assert truthful totals/status in the first result or durable per-action progress.
- Spec/task: `specs/cli-archive/spec.md:112-128` permits only runtime outcome drift and requires it to be disclosed; `tasks.md:50` requires deterministic ordering, idempotent retry, and truthful partial success.
- Recommended action: journal each completed prepared-spec action and compute recoverable result totals from durable progress. Preserve that structured result through the CLI.
- Triage: **ASK** - result and journal schemas need a coordinated change.

#### 6. Major - a matching journal phase is trusted without re-verifying the staged or published payload

- Evidence: a matching stage/final journal sets `currentPhase` at `src/core/archive-engine.ts:2017-2066`. Full payload rebuild and fingerprint verification occurs only when `currentPhase === 'planned'` at `src/core/archive-engine.ts:2081-2118`. A journal at `staged` or later bypasses that check; a published resume likewise does not re-hash the non-evidence archive payload before accounting and source removal.
- Failure: corruption or external mutation of `proposal.md`, `design.md`, task/spec content, or other owned payload in a staged/published transaction can be accepted on resume. Evidence accounting hashes only the evidence inputs, so it does not repair this broader payload-integrity gap.
- Test gap: recovery tests reuse the matching plan/journal but do not mutate the owned stage or final payload between attempts.
- Spec/task: `specs/file-placement/spec.md:5` requires exact recovery; `specs/cli-archive/spec.md:24-26` requires staged payload verification and successful completion of all archive phases.
- Recommended action: record the expected transformed-stage fingerprint for the relevant phase and revalidate it on every resume before further mutation or source removal. Add stage and published corruption regressions.
- Triage: **ASK** - transformed payload identity must be defined for each phase.

#### 7. Major - directory metadata in the payload fingerprint is not reproduced by the copier

- Evidence: directory entries include `mode` and filesystem `size` at `src/core/archive-engine.ts:449-455`. The copier creates directories with plain `mkdir(to)` and never restores their mode at `src/core/archive-engine.ts:1460-1462`. Staging then requires exact serialized entry equality at `src/core/archive-engine.ts:2101-2108`.
- Failure: on POSIX, a source directory with non-default permissions can fail a safe archive because umask-derived destination mode differs. Directory `st_size` is allocation metadata and can also differ between otherwise identical trees/filesystems. The equality contract therefore rejects valid payloads and is not portable across the required hosts.
- Test gap: the focused suite uses fresh temporary directories with default modes; no POSIX permission/allocation-history case exists.
- Spec/task: `specs/file-placement/spec.md:68-72` requires native Windows/POSIX path behavior; `tasks.md:57` asks for helper cases but leaves real native execution to closure task 7.6. The implementation support itself is missing, independent of the still-open three-host CI gate.
- Recommended action: either reproduce semantically required directory metadata or exclude volatile directory allocation fields from the payload identity. Add native POSIX permission cases.
- Triage: **ASK** - the archive payload's portable metadata contract must be explicit.

#### 8. Major - planning tree-state drift is written into accounting but not revalidated

- Evidence: planning Git state includes `treeState` at `src/core/archive-engine.ts:1053-1062`. `revalidateArchiveGitPlan` compares execution facts, planning state, and branch at `src/core/archive-engine.ts:1836-1854`, but omits `actual.git.planning.treeState`. Accounting later writes the stale planned value at `src/core/archive-engine.ts:2244-2248`.
- Failure: the planning worktree can move from clean to dirty, or dirty to clean, after preview and still be recorded with the old state in final accounting. This makes a required ledger fact untruthful even when the rest of the archive succeeds.
- Test gap: Git fault cases cover failures and execution commit/branch conditions but not planning tree-state drift between plan and apply.
- Spec/task: `specs/sha-cross-stamping/spec.md` requires fail-closed, truthful Git facts; `tasks.md:23-24` requires planning branch/tree state and revalidation before mutation.
- Recommended action: compare planning `treeState` during Git revalidation and add clean-to-dirty and dirty-to-clean regressions.
- Triage: **AUTO-FIX** - the planned fact already exists and the missing comparison is narrow.

#### 9. Minor - ship-log finalization rewrites pre-existing bytes before appending the archive section

- Evidence: both write paths call `content.replace(/\s+$/, '')` before appending at `src/core/archive-engine.ts:1598-1602`.
- Impact: trailing whitespace/newlines in an existing ship-side log are removed in the archive copy, so the ship-side section is not byte-identical. This also makes the archive mutation broader than the declared append.
- Test gap: ship-log tests assert the resulting fields, not preservation of the exact pre-existing byte prefix.
- Spec/task: `specs/sha-cross-stamping/spec.md` requires the existing ship-side record to remain byte-identical while archive-side facts are appended before hashing.
- Recommended action: append without normalizing the existing prefix and assert byte-for-byte prefix preservation.
- Triage: **AUTO-FIX** - this is a narrow append behavior correction.

**Standards count:** 9 findings - 4 Blocker, 4 Major, 1 Minor, 0 Trivial.

### Spec

#### 10. Blocker - dry-run, apply, and recovery cannot consume the same immutable plan

- Evidence: `ArchiveOptions` exposes no serialized plan, plan path, or transaction selector at `src/core/archive.ts:50-60`. Every CLI execution creates a fresh plan at `src/core/archive.ts:404-427`; dry-run returns it at `src/core/archive.ts:429-430`, but apply has no way to receive it. Generated consumers explicitly issue separate dry-run and apply commands at `src/core/templates/workflows/archive-change.ts:141-143`, `src/core/templates/workflows/bulk-archive-change.ts:135`, and `src/core/templates/workflows/ship.ts:207`. The CLI also rejects an existing final target before planning at `src/core/archive.ts:274-285`, preventing a normal second invocation from discovering and resuming a published incomplete transaction.
- Failure: the displayed plan is advisory, not authoritative. Any sidecar, spec, Git, task, cleaner, evidence, target, or timing change between invocations is silently replanned. Even the generated single command changes flags: preview lacks `--yes`, while apply uses it. Retry works in tests only because they call `applyArchive` again with the same in-memory object, an operation unavailable to CLI users.
- Reviewer reproduction: a dry-run plan in a temporary project had `cleaner.effectiveDelete: []`. After preview, a valid `auto-run.json` was added. The subsequent ordinary apply generated a different plan hash and deleted that newly introduced path even though it was absent from the displayed plan.
- Test gap: recovery tests at `test/core/archive-engine.test.ts:383-420` and the fault-matrix helper at `test/core/archive-fault-matrix.test.ts:189-194` reuse one in-memory plan. No test performs preview and apply through separate real CLI invocations and proves identical plan hash/action bytes.
- Spec/task: `specs/cli-archive/spec.md:5` says apply consumes the exact plan; `specs/cli-archive/spec.md:91` says dry-run emits the same immutable plan apply consumes; `specs/cli-archive/spec.md:124-128` says only runtime outcomes may differ; `design.md:89-101` requires retry of the same transaction.
- Recommended action: make the serialized plan a durable, authenticated apply input (for example a plan file/token/stdin contract), and add transaction discovery/resume so later invocations reuse the exact plan and recovery identity. Generated consumers must pass that artifact unchanged.
- Triage: **ASK** - this is the primary CLI/API contract.

#### 11. Blocker - generated single and bulk workflows mutate specs outside the engine, and the recommended path can make engine apply fail

- Evidence: the single workflow tells the agent to invoke `rasen-sync-specs` at `src/core/templates/workflows/archive-change.ts:124`, then adds `--skip-specs` only when the user chose *not* to sync at `src/core/templates/workflows/archive-change.ts:141`. Bulk does the external sync at `src/core/templates/workflows/bulk-archive-change.ts:128-135` and then invokes the archive engine without skipping its prepared spec actions. The spec apply implementation rejects an `ADDED` requirement that the earlier sync has already inserted at `src/core/specs-apply.ts:314-319`.
- Failure: the recommended "Sync now" single path and the bulk sync path can apply the delta once outside the transaction, then have the archive engine prepare/apply it again and fail as already existing. Planning specs have already mutated, but no engine journal owns that mutation. This defeats the single authoritative mutation path and its recovery guarantees.
- Test gap: the consumer integration test prebuilds fixture specs/sidecar and calls `ArchiveCommand` directly; it does not execute `rasen-sync-specs` followed by the generated archive sequence.
- Spec/task: `specs/cli-archive/spec.md:5-7` requires direct CLI, single, bulk, and in-ship consumers to use one authoritative plan/apply operation; `specs/opsx-archive-skill/spec.md:5` requires single/bulk archive mutations to route through the engine; `tasks.md:48-50` assigns spec planning/application to that engine.
- Recommended action: remove pre-engine spec mutation from archive consumers and let the engine own prepared spec actions in the resolved order. If an explicit no-sync choice is retained, encode that intent in the exact plan.
- Triage: **ASK** - consumer semantics and engine ownership need one agreed flow.

#### 12. Major - blocked dry-runs exit successfully and several blockers are never represented in the plan

- Evidence: `renderDryRun` prints or returns plan blockers at `src/core/archive.ts:681-740` but never sets a nonzero exit code. Target existence is rejected before `createArchivePlan` at `src/core/archive.ts:274-285`; task/timing/validation gates likewise run before the planner. For non-dry JSON apply, blocked/recoverable results are converted to a generic thrown diagnostic at `src/core/archive.ts:432-465`, which loses the structured result/progress.
- Failure: automation can treat a blocked dry-run as success. Consumers also cannot inspect one complete blocker projection because some conditions bypass the plan entirely. On recoverable apply, JSON reports `archive: null` rather than the engine's partial progress and exact structured blocker fields.
- Reviewer reproduction: a temporary change with a schema-version-99 sidecar returned a JSON dry-run plan with `complete: false` and a `sidecar-validate` blocker while the process exit status remained zero.
- Test gap: focused tests inspect blocker arrays but do not assert real CLI exit status and JSON shape for blocked preview or recoverable partial apply.
- Spec/task: `specs/cli-archive/spec.md:91-128` requires a complete dry-run projection, nonzero blockers, and truthful runtime outcomes; `tasks.md:5-7` requires structured diagnostics and correct exit codes.
- Recommended action: put all pre-mutation blockers into the plan, set nonzero status for incomplete dry-runs, and preserve the structured engine result in JSON for blocked/recoverable apply.
- Triage: **ASK** - this changes the CLI result/exit contract.

#### 13. Major - real generated consumers do not construct complete sidecar/probe intent, and the integration test substitutes direct CLI calls

- Evidence: single archive gives a literal sidecar example at `src/core/templates/workflows/archive-change.ts:128-137`, but says an absent/empty handoff makes the step a no-op at line 137, so probe-only intent is never discovered or written. Bulk and in-ship templates invoke the engine at `src/core/templates/workflows/bulk-archive-change.ts:135` and `src/core/templates/workflows/ship.ts:207` without constructing handoff/probe intent. In `test/core/archive-consumer-integration.test.ts:124-138`, the test itself writes the complete sidecar; at `test/core/archive-consumer-integration.test.ts:161-165`, every consumer label is implemented by a direct `new ArchiveCommand().execute(...)` call rather than executing the generated workflow.
- Failure: real bulk and in-ship consumers preserve handoffs as unjudged and omit probe accounting unless an external actor happens to pre-seed the sidecar. Single archive can also omit probes when there is no handoff. The passing parity/integration evidence therefore does not prove the checked real-consumer requirement.
- Test gap: no executable consumer adapter or harness follows generated single, bulk, and in-ship instructions through sidecar discovery, preview confirmation, exact-plan apply, and result reporting.
- Spec/task: `specs/opsx-archive-skill/spec.md:67-93` requires validated sidecar/handoff disposition and `specs/opsx-archive-skill/spec.md:127-140` requires probe intent/accounting; `tasks.md:52` requires real-consumer integration.
- Recommended action: define one executable consumer adapter that discovers/writes sidecar intent and carries the exact plan into apply; have all generated consumers call it. Test each actual consumer path rather than relabeling direct CLI execution.
- Triage: **ASK** - this needs a real consumer boundary, not a string-only assertion.

#### 14. Minor - bulk completion text still claims an archive commit is written into the ship log

- Evidence: `src/core/templates/workflows/bulk-archive-change.ts:219` says the archive section contains "ship commit, archive commit, outcome." The same template correctly says not to append an archive commit after evidence hashing at `src/core/templates/workflows/bulk-archive-change.ts:139`.
- Impact: generated operator guidance contradicts the non-self-referential chain contract and can prompt consumers to expect or append an impossible post-hash archive commit.
- Spec/task: `specs/sha-cross-stamping/spec.md` and `specs/opsx-ship-command/spec.md` require no self-referential archive commit in hashed evidence.
- Recommended action: change the summary wording to the actual pre-hash archive facts: ship commit when already known, archive path/timestamp/outcome/transaction, and accounting verification.
- Triage: **AUTO-FIX** - wording-only correction.

**Spec count:** 5 findings - 2 Blocker, 2 Major, 1 Minor, 0 Trivial.

## Coverage diagram

```text
CODE PATH COVERAGE
==================
[+] archive planning
    |-- [TESTED] sidecar schema/path/change validation and fail-closed reads
    |-- [TESTED] Git/evidence discovery failures and cleaner blocker projection
    |-- [TESTED] deterministic direct-engine plan serialization
    `-- [GAP]    dry-run artifact carried unchanged into CLI apply/retry

[+] stage / publish / source removal
    |-- [TESTED] copy failure, staged mismatch, ordinary target conflict
    |-- [TESTED] visible source drift and source-remove failure
    |-- [GAP]    same-byte source/root replacement identity
    |-- [GAP]    target creation between absence check and rename
    |-- [GAP]    stage/final payload corruption before journal resume
    `-- [GAP]    portable directory mode/size semantics

[+] spec / cleaner / accounting
    |-- [TESTED] prepared-spec ordering and injected partial write
    |-- [TESTED] cleaner partial failure before next deletion
    |-- [TESTED] evidence hashes and atomic archive.json write/verify
    |-- [GAP]    spec target races at create/update/delete mutation
    |-- [GAP]    per-spec durable progress and truthful recoverable totals
    `-- [GAP]    hard crash after cleaner unlink but before journal

USER FLOW COVERAGE
==================
[+] direct engine success and many named faults
[+] generated template parity/string guards
[-] separate CLI preview/apply use different plans and transactions
[-] published recovery cannot be selected by ordinary CLI
[-] blocked preview exits zero and some gates bypass the plan
[-] recommended sync-first consumer path double-applies specs
[-] consumer integration pre-seeds intent and substitutes direct CLI calls
```

## Test and validation evidence

- Reviewer-focused archive suite:
  - `test/core/archive-engine.test.ts`
  - `test/core/archive-consumer-integration.test.ts`
  - `test/core/archive-fault-matrix.test.ts`
  - `test/core/archive-path-semantics.test.ts`
  - `test/core/archive-accounting.test.ts`
  - `test/core/archive-ephemera.test.ts`
  - `test/core/templates/archive-engine-consumers.test.ts`
- Result: **7/7 files, 53/53 tests passed**.
- Change validation: `node bin/rasen.js validate file-placement-hardening-archive-engine --json` passed, 1/1 item valid.
- `git diff --check` passed with line-ending conversion warnings only.
- Reviewer reproductions outside the workspace established:
  1. preview/apply replanning can delete an undisclosed newly introduced cleaner candidate;
  2. same-byte whole-source replacement is accepted and removed;
  3. a blocked sidecar dry-run returns exit status zero.
- No implementation, test, task, or run-state file was edited by this reviewer.
- Native Windows/macOS/Linux CI task 7.6 remains closure-owned. This report does not count the still-open matrix itself as a child finding; finding 7 is implementation support missing before that matrix can succeed meaningfully.

## Verdict

**FINDINGS - 14 total: 6 Blocker, 6 Major, 2 Minor, 0 Trivial.**

The direct-engine suite is valuable, but the current implementation does not yet meet the archive safety contract. In particular, a user cannot apply the plan they reviewed, filesystem-object replacement can be deleted, publication/spec races can clobber concurrent state, and actual destructive progress can escape durable accounting.

## Round 2 - remediation review

- Mode: dispatched, report-only
- Reviewed inputs: this Round-1 report, `handoff/review-remediation-1.md`, `handoff/fixer-1.md`, and the current archive-owned delta
- Verdict: **FINDINGS**
- Delta result: 8 findings resolved, 4 partially resolved, 2 still open
- Remaining severity: **1 Blocker, 5 Major, 0 Minor, 0 Trivial**

### Remaining findings

#### Blocker - finding 2: retry clears unverified occupants from the reserved final directory

- The first-publication path now acquires the exact final directory with exclusive `mkdir` and flushes its parent at `src/core/archive-engine.ts:2028-2034`; marker publication is also no-replace via a hard link at `src/core/archive-engine.ts:2036-2064`. This resolves the original check-then-rename boundary.
- Recovery is still destructive without authority. If the final directory exists for the matching transaction, `clearOwnedArchiveReservationPayload` recursively removes every non-control child at `src/core/archive-engine.ts:2096-2107`. Apply calls it at `src/core/archive-engine.ts:3376-3378` before it records the `final-reserved` before/expected fingerprint at `src/core/archive-engine.ts:3387-3393`. A crash after durable reservation but before that fingerprint leaves no deletion capability for those children.
- Reviewer reproduction: inject `EIO` on the first `readdir(final)` after the reservation journal is durable, write `CONCURRENT.txt` into the empty reserved directory, then retry the same plan with normal adapters. The first result was `recoverable`; the retry returned `complete`; `CONCURRENT.txt` was deleted.
- Existing coverage at `test/core/archive-fault-matrix.test.ts:313-371` checks a target present before reservation and a creator that wins the `mkdir` boundary. It does not cover an occupant introduced after a durable reservation and before the first final-payload intent record.
- Required correction: never recursively clear a reservation merely because its journal matches. Record the empty reservation identity before exposing a retry point, and on recovery remove only entries proven to be this transaction's partial copy by a durable before/expected/observed capability. Any unaccounted entry must stop recovery and survive.

#### Major - finding 1: deletion identities are fixed, but file reads are not bound to those identities

- Root and entry deletion authority now includes filesystem identities at `src/core/archive-engine.ts:528-551` and `src/core/archive-engine.ts:565-706`; apply requires both payload and authority equality at `src/core/archive-engine.ts:719-729`, claims the source, and removes it bottom-up with immediate identity checks at `src/core/archive-engine.ts:2122-2169` and `src/core/archive-engine.ts:3547-3627`.
- The original same-byte replacement failure is resolved and covered at `test/core/archive-fault-matrix.test.ts:224-310`.
- The stable-read part of the remediation is incomplete. A regular file is still read by pathname between two `lstat` calls at `src/core/archive-engine.ts:647-665`. The implementation does not open the object with no-follow semantics, compare `fstat` before/after the handle read, and compare the final pathname identity. A path can therefore temporarily resolve to another object during `readFile` and be restored before the second `lstat`, binding bytes from one object to deletion authority for another. `ArchiveStatIdentity` also stores number-valued `dev`/`ino` fields at `src/core/archive-engine.ts:92-99` and `src/core/archive-engine.ts:528-536`, rather than lossless bigint identities.
- Required correction: implement handle-bound no-follow reads (`lstat -> open/no-follow -> fstat -> read -> fstat -> lstat`) and serialize lossless identity fields. Add a deterministic adapter regression that swaps a pathname only during the read.

#### Major - finding 3: no-clobber spec claims are fixed, but publish/cleanup crash windows do not reconcile

- Create now publishes with a no-replace link, update claims the validated original before publishing, and delete claims and guarded-removes the full capability at `src/core/archive-engine.ts:2476-2626`. The concurrent create/update/delete tests at `test/core/archive-engine.test.ts:604-747` establish that unrelated targets and claimed originals survive the tested races.
- Recovery recognizes an already-published create/update only when the durable state is already `published` or `verified` at `src/core/archive-engine.ts:2455-2473`. The filesystem mutation precedes that state flush at `src/core/archive-engine.ts:2496-2498` and `src/core/archive-engine.ts:2548-2550`. A crash after the hard link succeeds but before the journal flush leaves `intent-durable` or `claimed`; retry treats the transaction's own exact target as a concurrent `EEXIST` instead of reconciling it.
- Reviewer reproduction: stop a create at its publication link with an `intent-durable` journal, create the exact hard link that the interrupted operation would have created, and retry the same plan. Retry returned `recoverable` with `spec/EEXIST` while the target contained the exact planned bytes.
- Update has another terminal cleanup gap: it flushes `verified`, unlinks the claimed backup, removes the claim directory, and only then flushes `complete` at `src/core/archive-engine.ts:2639-2654`. A crash between cleanup and the final flush makes retry require a backup that the transaction already removed.
- Required correction: reconcile every durable state against the exact transaction-owned temp/target/backup identities and expected hashes before classifying a conflict. Add post-link/pre-state-flush and post-backup-unlink/pre-complete-flush crash tests for create and update.

#### Major - finding 6: the completed resume fast path still skips final payload verification

- Incomplete staged and published recovery now records before/expected/observed fingerprints and rejects tested corruption at `src/core/archive-engine.ts:2861-2998` and `src/core/archive-engine.ts:3128-3151`; the regressions at `test/core/archive-fault-matrix.test.ts:425-481` cover those incomplete phases.
- Once the active source is absent and the published journal says `complete`, apply returns success immediately at `src/core/archive-engine.ts:3030-3064`. It does not read the marker, rehash the final payload, or reverify final accounting.
- Reviewer reproduction: complete an archive, replace final `proposal.md` with `# CORRUPT\n`, and apply the same plan again. Both calls returned `complete`; the second returned `resumed: true` and left the corrupt bytes accepted.
- Required correction: the terminal idempotent path must validate the final marker, its payload digest, the completed phase fingerprint, and accounting before returning `complete`. Add a completed-transaction corruption regression.

#### Major - finding 12: exit/result handling is fixed, but several blockers still bypass the immutable plan

- Blocked previews now set a nonzero status at `src/core/archive.ts:830-903`, and blocked/recoverable apply preserves the structured engine result at `src/core/archive.ts:223-253`, `src/core/archive.ts:589-610`, and `src/core/archive.ts:296-315`.
- A missing/non-directory source is still rejected before planning at `src/core/archive.ts:385-399`. Human timing, validation, and task decisions can also return before `createArchivePlan` at `src/core/archive.ts:422-495`; a human spec-preparation error returns `null` at `src/core/archive.ts:817-827`. The immutable plan is not constructed until `src/core/archive.ts:539-563`.
- Reviewer reproduction: `node bin/rasen.js archive __round2_missing_change__ --dry-run --json --save-plan` exited 1, but returned `archive: null` and no plan token. Thus source availability is still not represented as a blocker in the supposedly complete saved preview.
- Required correction: after root and argument parsing, project source, timing, validation, task, and spec-preparation failures into one serializable plan. Interactive refusal may prevent apply, but the preview must still expose the complete blocker projection.

#### Major - finding 13: generated guidance improved, but the required real-consumer integration is still substituted

- Single, bulk, and ship templates now prescribe intent-template, completed intent, saved preview token, exact-token apply/retry, and no external mutation at `src/core/templates/workflows/archive-change.ts:135-141`, `src/core/templates/workflows/bulk-archive-change.ts:135`, and `src/core/templates/workflows/ship.ts:207`.
- The integration test verifies those strings at `test/core/archive-consumer-integration.test.ts:148-159`, but then implements every generated consumer itself with direct `new ArchiveCommand()` calls at `test/core/archive-consumer-integration.test.ts:170-216`. It does not execute Commander argv emitted by the single, bulk, or ship consumer, so a template/adapter/CLI wiring error remains invisible.
- The test also authors and mutates the intent itself at `test/core/archive-consumer-integration.test.ts:173-194`, rather than exercising a consumer-owned adapter across empty-handoff, probe-only, multiple-probe, absent-intent, and skip-spec variants.
- Required correction: give the generated consumers one executable adapter or test harness, capture the actual argv each emits, and run those argv through the real Commander entrypoint for the required matrix. Keep the current direct-controller test as engine parity evidence, not consumer integration evidence.

### Fourteen-finding disposition

| Round-1 finding | Round-2 status | Current evidence |
|---|---|---|
| 1. Stable deletion identity/reads | **PARTIAL - Major remains** | Same-byte object replacement and guarded removal are fixed (`archive-engine.ts:565-729`, `:2122-2169`; fault matrix `:224-310`), but pathname `readFile` is not handle-bound (`archive-engine.ts:647-665`). |
| 2. Exclusive final publication | **OPEN - Blocker** | Exclusive reservation/marker exist (`archive-engine.ts:2028-2064`), but retry recursively clears unverified occupants (`:2096-2107`, `:3376-3378`). |
| 3. Spec claim/publish/delete | **PARTIAL - Major remains** | Boundary clobber is fixed (`archive-engine.ts:2476-2626`; engine tests `:604-747`), but post-link and terminal-cleanup crash states do not reconcile (`archive-engine.ts:2455-2498`, `:2639-2654`). |
| 4. Cleaner intent | **RESOLVED** | Durable `delete-intent` precedes deletion and absent-after-intent is accounted (`archive-engine.ts:3446-3476`); post-unlink recovery is covered (`archive-fault-matrix.test.ts:900-942`). |
| 5. Spec progress/totals | **RESOLVED** | Per-action journal progress and durable totals are present (`archive-engine.ts:308-325`, `:1947-1965`, `:2424-2432`); partial-action reporting/resume is covered (`archive-engine.test.ts:531-602`). |
| 6. Transformed resume integrity | **OPEN - Major** | Incomplete phases rehash, but completed recovery returns before validation (`archive-engine.ts:3030-3064`). |
| 7. Portable directory fingerprint | **RESOLVED** | Directory payload entries exclude volatile mode/size while file executable metadata remains (`archive-engine.ts:82-90`, `:632-660`); native POSIX case is present at `archive-engine.test.ts:135-166` and correctly skipped on Windows. |
| 8. Planning `treeState` | **RESOLVED** | Revalidation compares the current planning state at `archive-engine.ts:2689-2750`; clean/dirty transitions are covered at `archive-fault-matrix.test.ts:664-707`. |
| 9. Ship-log prefix | **RESOLVED** | Finalization appends without trimming at `archive-engine.ts:2278-2288`; exact-prefix coverage is at `archive-engine.test.ts:208-220`. |
| 10. Persisted exact-plan CLI | **RESOLVED** | Saved-token load/apply is wired at `archive.ts:190-207`, `:265-315`, and `:565-569`; round-trip/tamper/controller coverage is at `archive-engine.test.ts:107-133` and `archive.test.ts:86-131`. All four Commander flags are exposed and startup passed. |
| 11. No external spec sync | **RESOLVED** | All three generated consumers use the engine-only token flow and explicitly prohibit external sync (`archive-change.ts:135-141`, `bulk-archive-change.ts:135`, `ship.ts:207`); no `rasen-sync-specs` reference remains. |
| 12. Blocker/partial JSON | **PARTIAL - Major remains** | Nonzero blocked previews and structured partial apply are fixed (`archive.ts:223-253`, `:589-610`, `:830-903`), but pre-plan exits remain (`archive.ts:385-399`, `:422-526`). |
| 13. Real consumers | **PARTIAL - Major remains** | Template intent/token guidance is fixed, but the test substitutes direct controller calls (`archive-consumer-integration.test.ts:148-216`). |
| 14. Bulk wording | **RESOLVED** | Completion text now names the recorded ship commit/archive facts and explicitly rejects a post-hash identifier (`bulk-archive-change.ts:219`); string regression is at `archive-engine-consumers.test.ts:55-64`. |

### Round-2 coverage delta

```text
ARCHIVE TRANSACTION
===================
[+] exact saved plan token -> apply/retry
[+] stable source/root identity -> source claim -> guarded bottom-up removal
[+] exclusive initial final reservation -> no-replace publication marker
[-] reserved-final retry -> recursively clears children without a durable capability
[+] incomplete stage/final resume -> transformed fingerprint verification
[-] completed resume -> early success without payload/accounting verification

SPEC / CLEANER
==============
[+] create/update/delete boundary races preserve unrelated state
[-] post-publish/pre-journal and post-cleanup/pre-complete crash reconciliation
[+] per-spec durable progress and truthful totals
[+] cleaner delete-intent and absent-after-intent accounting

CLI / CONSUMERS
===============
[+] blocked preview exit and structured recoverable JSON
[+] generated intent -> preview/save -> exact-token apply guidance
[-] source/timing/validation/task blockers are not all represented in the plan
[-] generated consumer integration still executes direct controller substitutes
```

### Round-2 validation evidence

- `pnpm build`: **PASS**.
- Exact focused archive suite, run in three local groups to avoid worker contention: **10/10 files passed, 155/155 tests passed, 1 POSIX-only test skipped on Windows**.
- `pnpm exec vitest run test/commands/work.test.ts --pool=forks --maxWorkers=1`: **20/20 passed**.
- CLI startup:
  - `node bin/rasen.js --help`: exit 0.
  - `node bin/rasen.js archive --help`: exit 0; `--save-plan`, `--apply-plan`, `--intent-template`, and `--intent-file` present.
  - `node bin/rasen.js work migrate --help`: exit 0.
- `node bin/rasen.js validate file-placement-hardening-archive-engine --json`: **PASS**, 1/1 valid.
- Reviewer reproductions were performed in temporary directories and cleaned up. No implementation, test, task, or run-state file was edited.
- Native POSIX execution remains closure-owned and is not counted as a finding.

## Final verdict after Round 2

**FINDINGS - 6 remaining: 1 Blocker, 5 Major, 0 Minor, 0 Trivial.**

The remediation closes the original plan-token, ordinary no-clobber, cleaner-accounting, progress, portability, Git-ledger, prefix, external-sync, and wording defects. It is not yet safe to approve: a retry can delete an unaccounted concurrent occupant from the reserved final directory, completed recovery accepts corrupted archive bytes, spec crash states can strand their own successful publication, reads are not handle-bound to deletion identity, some blockers remain outside the immutable plan, and the generated-consumer integration proof still substitutes direct controller calls.

## Round 3 - final remediation review

- Mode: dispatched, report-only
- Reviewed inputs: the Round-2 section above, `handoff/fixer-2.md`, and the current archive-owned delta
- Prior-findings result: all six Round-2 findings are resolved
- New-regression result: one Major finding remains
- Verdict: **FINDINGS**

### Round-2 finding dispositions

| Round-2 item | Round-3 status | Current evidence |
|---|---|---|
| Reserved-final unaccounted occupant | **RESOLVED** | Journal v2 now binds the reservation identity and per-entry intent/copy identity at `src/core/archive-engine.ts:310-319`; recovery rejects unaccounted or intent-only occupants without deleting them at `src/core/archive-engine.ts:2337-2401`; copy uses exclusive creation and durable entry progress at `src/core/archive-engine.ts:2403-2500`. The exact `CONCURRENT.txt` reproduction is covered at `test/core/archive-fault-matrix.test.ts:429-480` and passed locally. |
| Handle-bound lossless reads | **RESOLVED** | Identities are decimal-string bigint facts at `src/core/archive-engine.ts:94-101` and `src/core/archive-engine.ts:553-595`. Regular reads use `lstat -> O_NOFOLLOW open -> bigint fstat -> handle read -> bigint fstat -> final lstat` at `src/core/archive-engine.ts:608-645`, and fingerprint/spec paths consume that helper at `src/core/archive-engine.ts:736-758` and `src/core/archive-engine.ts:2841-2864`. The deterministic pathname-swap and identity-shape regressions at `test/core/archive-fault-matrix.test.ts:246-302` passed. |
| Spec post-link and cleanup reconciliation | **RESOLVED** | Durable claim/temp/published identities and exact rebuilt hashes are reconciled at `src/core/archive-engine.ts:2961-3165`; verified update cleanup accepts an absent backup only when verification was durable before the attempt at `src/core/archive-engine.ts:3167-3197`. Create/update post-link and post-backup-unlink regressions at `test/core/archive-engine.test.ts:604-730` passed. |
| Completed marker/payload/accounting verification | **RESOLVED for integrity detection** | `verifyCompletedTransaction` binds the marker to the accounting phase, rehashes the complete final payload, validates ledger plan/journal facts, and re-runs accounting/evidence verification at `src/core/archive-engine.ts:3552-3627`; the source-absent terminal path invokes it before returning success at `src/core/archive-engine.ts:3658-3695`. Corruption is now rejected by `test/core/archive-fault-matrix.test.ts:1095-1117`. The failure-result regression below is separate from the integrity check itself. |
| Serializable missing-source/post-root blockers | **RESOLVED** | Source availability no longer exits ordinary planning at `src/core/archive.ts:385-395`; timing, validation, task, spec-preparation, sidecar/evidence, and source failures are accumulated before the plan is created at `src/core/archive.ts:421-643`; blocked dry-runs persist and return that plan at `src/core/archive.ts:645-649` and `src/core/archive.ts:906-979`. Missing-source saved-plan coverage at `test/core/archive.test.ts:165-211` passed. Commander apply now ignores the default positive validation value and conflicts only with explicit negation at `src/core/archive.ts:270-283`. |
| Generated argv through real Commander and variants | **RESOLVED** | The shared argv/intent adapter is at `src/core/archive-consumer-invocation.ts:1-109`, and all three templates consume its command examples. Integration executes the exact single/bulk/in-ship argv via `createProgram(...).parseAsync(...)` at `test/core/archive-consumer-integration.test.ts:163-251` and covers empty-handoff, probe-only, multiple-probe, absent-intent, and `--skip-specs` variants at `test/core/archive-consumer-integration.test.ts:351-556`. All cases passed locally. |

### Standards

#### Major - a completed-integrity failure reports a nonexistent stage journal and is not made durable

- `applyArchive` initializes `resumed`, `finalReserved`, `ownsRecoveryState`, `currentPhase`, and `journalSnapshot` to the fresh-apply values at `src/core/archive-engine.ts:3376-3386`. The source-absent completed path reads the real published journal and invokes terminal verification at `src/core/archive-engine.ts:3658-3669`, but it does not establish those recovery variables before verification can throw.
- The shared catch therefore selects `plan.paths.journal` (the already-removed stage journal) whenever `finalReserved` is still false, and it persists no detected failure because `ownsRecoveryState` is false at `src/core/archive-engine.ts:4328-4351`. `applyFailure` then returns that wrong path, `resumed: false`, and an ordinary same-token recovery command at `src/core/archive-engine.ts:2040-2072`.
- Reviewer reproduction: complete an archive, corrupt final `proposal.md`, and apply the same plan. Integrity detection correctly returned `recoverable/accounting/ESTALE`, but the result had `resumed: false`, `journalPath === plan.paths.journal`, and that path did not exist. The authoritative `plan.paths.publishedJournal` remained `phase: "complete"` with no failure record.
- The new regression at `test/core/archive-fault-matrix.test.ts:1095-1117` asserts only status, blocker, and preservation of the corrupt bytes; it does not assert `resumed`, `journalPath`, durable published-journal state, or whether the advertised recovery action is actually safe.
- Impact: JSON consumers and operators are directed to recovery state that does not exist, while the only durable transaction record continues to claim success. This violates the exact recovery-state/result contract and can hide a detected integrity failure from later journal inspection.
- Required correction: establish final recovery ownership and the authoritative published-journal path before terminal verification, then represent detected post-completion corruption with a truthful durable integrity-failure state and an explicit safe/manual recovery action. Do not advertise an ordinary resumable command unless that command can make progress. Extend the regression to assert all result and journal fields.
- Triage: **ASK** - whether post-completion corruption transitions the completed journal or uses a distinct durable integrity record is a transaction-state design decision.

**Standards count:** 1 finding - 0 Blocker, 1 Major, 0 Minor, 0 Trivial.

### Spec

**REQUIREMENTS PARTIAL - 1 Major.** `specs/file-placement/spec.md:5` requires a journal that identifies the exact transaction phase, paths, and safe resume action, while `specs/cli-archive/spec.md:7` requires a failed apply to leave a journal reporting the recoverable state. The terminal verifier now detects the corruption, but its returned and durable recovery facts do not satisfy those requirements. No other Round-3 spec mismatch or archive-owned scope drift was found.

### Round-3 coverage delta

```text
FINAL TRANSACTION SAFETY
========================
[+] durable empty-reservation capability
    `-- unaccounted/intent-only occupant -> block and preserve
[+] handle-bound bigint identity reads
[+] exact spec publish/cleanup crash reconciliation
[+] completed marker -> payload -> ledger/evidence validation
[-] completed validation failure
    |-- returned journal -> deleted stage path
    |-- resumed -> false
    `-- durable published journal -> still complete, no failure record

CLI / GENERATED CONSUMERS
=========================
[+] missing source and post-root gates -> serializable saved plan
[+] single/bulk/in-ship argv -> real Commander
`-- [+] empty handoff / probe-only / multiple probes / absent intent / skip specs
```

### Round-3 validation evidence

- `pnpm build`: **PASS**.
- `pnpm lint`: **PASS**.
- Exact focused archive suite, run in two groups: **10/10 files passed, 169/169 tests passed, 1 POSIX-only test skipped on Windows**.
- `test/commands/work.test.ts` plus `test/core/completions/command-registry.test.ts`: **27/27 passed**.
- CLI startup:
  - `node bin/rasen.js --help`: exit 0.
  - `node bin/rasen.js archive --help`: exit 0; all four transaction flags present.
  - `node bin/rasen.js work migrate --help`: exit 0.
- `node bin/rasen.js validate file-placement-hardening-archive-engine --json`: **PASS**, 1/1 valid.
- `git diff --check`: **PASS**, with repository line-ending conversion warnings only.
- Reviewer reproductions used temporary directories and were removed. This reviewer edited no implementation, test, task, handoff, or run-state file.
- Native macOS/Linux execution remains closure-owned and is not counted as an archive-engine finding.

## Final verdict after Round 3

**FINDINGS - 1 remaining: 0 Blocker, 1 Major, 0 Minor, 0 Trivial.**

All six findings carried into this final review round are substantively fixed, and the focused gates are green. The archive engine is not CLEAN because the newly added completed-integrity check returns and durably records the wrong recovery state when it detects corruption. This is the maximum review round; the remaining Major requires explicit disposition outside this review loop.

## Strategy attempt 1 re-review

- Mode: dispatched, report-only, independent non-author review
- Reviewed inputs: the Round-3 finding above, `handoff/strategy-fixer-1.md`, and only the terminal-integrity implementation/test delta named there
- Scope check: **CLEAN** - the delta is confined to terminal journal metadata/result projection and its two regressions
- Round-3 Major result: **RESOLVED on the ordinary successful journal-write path**
- New-regression result: **one Major finding**
- Verdict: **FINDINGS**

### Verified behavior

- The source-absent completed path establishes `resumed`, publication/final ownership, the published journal path, the historical phase, journal snapshot, disposal facts, and spec totals before terminal verification at `src/core/archive-engine.ts:3717-3739`.
- Successful detection creates structured manual-only metadata, atomically writes it through the temp/write/fsync/rename/directory-flush journal writer, leaves `phase: complete`, and returns the published journal with `resumed: true` and no ordinary recovery command at `src/core/archive-engine.ts:1895-1947` and `src/core/archive-engine.ts:3740-3773`.
- A later ordinary invocation short-circuits on the durable alert at `src/core/archive-engine.ts:3740-3742`; the regression at `test/core/archive-fault-matrix.test.ts:1095-1147` proves byte-identical result/journal repetition and preserved corrupt payload bytes.
- Saved-token JSON retains `manualRecoveryAction` and suppresses synthesized retry guidance at `src/core/archive.ts:301-317`; `test/core/archive.test.ts:86-166` passes through that real CLI adapter.
- The published journal and marker remain top-level control files in `ARCHIVE_CONTROL_FILENAMES` at `src/core/archive-engine.ts:39-45` and are excluded from payload fingerprinting at `src/core/archive-engine.ts:668-687`. The complete 10-file archive suite remains green.

### Standards

#### Major - a transient integrity-journal write failure escapes the manual-only terminal state

- After corruption is detected, the new branch mutates `journalSnapshot.integrityFailure` and calls `writeJournal` at `src/core/archive-engine.ts:3756-3773`. If that atomic write throws, the shared catch at `src/core/archive-engine.ts:4427-4471` treats it as an ordinary recoverable operation: it persists the published journal as `phase: failed` with `resumePhase: complete`, then calls `applyFailure`, which always adds the same-token `recoveryCommand` at `src/core/archive-engine.ts:2072-2104`.
- The saved-token CLI consequently also advertises that command because it suppresses synthesis only when `manualRecoveryAction` is present at `src/core/archive.ts:301-307`.
- Reviewer reproduction injected one `EIO` from the terminal journal temp handle's `sync`, after a completed archive's `proposal.md` was corrupted. The first detection returned `recoverable`, `resumed: true`, and the published journal path, but `manualRecoveryAction` was absent and the ordinary `rasen archive --apply-plan ... --yes` command was present. The durable journal contained the correct `integrityFailure` but had been rewritten to `phase: failed`, `failure.operation: journal`, and `failure.resumePhase: complete`.
- Repeat is not deterministic in that state. The terminal short-circuit accepts only `phase: complete` or `phase: failed` with `resumePhase: source-removed` at `src/core/archive-engine.ts:3717-3742`. A `failed/complete` journal falls through normal resume, fails final-payload verification at `src/core/archive-engine.ts:3838-3927`, returns another ordinary recovery command, and rewrites the journal again. The reproduction observed unequal first/repeat results and unequal journal bytes. The corrupt archive bytes were preserved.
- Impact: an I/O fault precisely while making terminal corruption durable reintroduces the Round-3 operator contract failure. The durable record carries a manual-only alert, but both engine and CLI ignore it and direct operators into an automatic retry loop. This is a plausible recovery fault and a significant correctness regression, but not a Blocker because the corrupt payload remains untouched.
- Required correction: once an `integrityFailure` exists in memory or in any matching published journal, terminal manual-only handling must dominate the generic failure path. A journal-write error must not change the historical complete phase or call `applyFailure`; any valid durable `integrityFailure` must short-circuit regardless of a stale generic failure wrapper. Add a fault regression at the integrity-alert journal write and assert manual action, no recovery command, complete phase, deterministic repeat, stable journal bytes after the alert becomes durable, and preserved payload bytes.
- Triage: **ASK** - the fail-closed behavior when the terminal alert itself cannot be durably flushed is a transaction-state decision, though ordinary retry must be prohibited.

**Standards count:** 1 finding - 0 Blocker, 1 Major, 0 Minor, 0 Trivial.

### Spec

**REQUIREMENTS PARTIAL - 1 Major.** The normal path now satisfies the safe/manual recovery requirements in `specs/file-placement/spec.md:5` and `specs/cli-archive/spec.md:7`, but the journal-I/O fault path again advertises ordinary resume while its own durable integrity metadata requires manual recovery. No other strategy-attempt spec mismatch or scope drift was found.

### Strategy-attempt coverage delta

```text
COMPLETED CORRUPTION
====================
[+] bind authoritative published journal before terminal verification
[+] successful alert write -> phase complete + manual-only result
[+] ordinary repeat -> same result/journal + payload preserved
[+] saved-token JSON -> manual action, no retry command
[-] alert journal write fails once
    |-- generic catch -> phase failed / resumePhase complete
    |-- result + CLI -> ordinary retry command, no manual action
    `-- repeat -> different result and rewritten journal

REGRESSION SAFETY
=================
[+] journal/marker remain excluded control files
[+] 10 archive/accounting/ephemera/template files pass
`-- [+] corrupt payload remains preserved in both reviewer reproductions
```

### Strategy-attempt validation evidence

- Exact new regressions: **2/2 passed**.
- High-risk archive group: **3/3 files passed, 58/58 tests passed, 1 POSIX-only test skipped on Windows**.
- Remaining archive/accounting/ephemera/template group: **7/7 files passed, 111/111 tests passed**.
- Combined focused suite: **10/10 files passed, 169/169 tests passed, 1 expected skip**.
- `pnpm lint`: **PASS**.
- `pnpm exec tsc --noEmit`: **PASS**.
- `pnpm build`: **PASS**.
- CLI startup: root, `archive`, and `work migrate` help all exited 0; all four archive transaction flags remain present.
- `node bin/rasen.js validate file-placement-hardening-archive-engine --json`: **PASS**, 1/1 valid.
- `git diff --check`: **PASS**, with repository line-ending conversion warnings only.
- Reviewer fault reproductions were executed from stdin against temporary directories and removed. This reviewer edited no implementation, test, task, handoff, or run-state file.

## Final verdict after strategy attempt 1

**FINDINGS - 1 remaining: 0 Blocker, 1 Major, 0 Minor, 0 Trivial.**

The original completed-corruption Major is fixed when the terminal journal write succeeds, and no control-file, fingerprint, CLI projection, or prior archive regression was found. Attempt 1 is not CLEAN because a transient failure in that new journal write escapes to the generic recovery path, contradicts the durable manual-only alert, changes the historical complete phase, and makes repeat nondeterministic.

## Strategy attempt 2 re-review

- Mode: dispatched, report-only, independent non-author review
- Reviewed inputs: the Strategy-attempt-1 Major above, `handoff/strategy-fixer-2.md`, and only the named archive-engine/fault-test delta
- Scope check: **CLEAN** - the implementation is confined to the terminal-integrity persistence boundary, published-alert precedence, and one deterministic fault regression
- Strategy-attempt-1 Major result: **RESOLVED**
- Verdict: **CLEAN**

### Verified behavior

- `bindPublishedRecoveryJournal` establishes truthful recovery state from the real published journal at `src/core/archive-engine.ts:3688-3701`: the result is resumed, final/published recovery ownership is set, the authoritative journal path and historical resume phase are retained, and totals/disposal facts come from that journal.
- `persistCompletedIntegrityFailure` contains alert-write exceptions locally at `src/core/archive-engine.ts:3703-3765`. It never throws the terminal fault into the generic `applyFailure` catch, and therefore never synthesizes an ordinary same-token recovery command or rewrites the historical phase to `failed`.
- After a persistence exception, the engine rereads the published journal at `src/core/archive-engine.ts:3717-3736`. A matching durable `integrityFailure` is authoritative and returns its original accounting/evidence blocker; when no durable alert exists, the result instead reports the actual published-journal persistence failure with `resumed: true`, explicit manual-only guidance, and no `recoveryCommand` at `src/core/archive-engine.ts:3738-3764`.
- Matching durable alerts dominate ordinary phase handling before Git, probe, source, and resume branches at `src/core/archive-engine.ts:3768-3787`. This includes a stale `phase: failed` wrapper whose `failure.resumePhase` is `complete`; the alert result is returned without rewriting journal bytes.
- Completed source-absent verification binds the published journal before verification and routes newly detected corruption through the terminal-local persistence boundary at `src/core/archive-engine.ts:3800-3848`.
- The regression `keeps completed corruption manual-only when its first integrity journal sync fails` at `test/core/archive-fault-matrix.test.ts:1150-1295` proves the pre-rename sync-failure/no-durable-alert path, retained `phase: complete`, manual-only published-journal result, preserved corrupt bytes, durable retry, deterministic later repeats, and stale-wrapper dominance.
- An independent reviewer reproduction injected `EIO` from the final-directory sync after the alert rename, so the persistence call threw with the alert already durable. The reread returned the original accounting `ESTALE` manual-only result, retained `phase: complete`, produced byte-identical result/journal on repeat, and preserved the corrupted payload. Its temporary fixture was removed.
- The complete 32-case fault matrix passed, including prior source, stage, publication, accounting, cleaner, and source-removal recovery cases; no normal recovery regression was observed.

### Standards

**No findings.** The local terminal boundary removes the conditional side-effect mismatch from Strategy attempt 1: disk authority now determines the result after a failed write, while every uncertain outcome remains manual-only and non-mutating.

**Standards count:** 0 findings - 0 Blocker, 0 Major, 0 Minor, 0 Trivial.

### Spec

**SATISFIED.** The delta preserves the safe-source/manual-recovery requirements in `specs/file-placement/spec.md:5` and `specs/cli-archive/spec.md:7` across both successful alert persistence and alert-persistence faults. No scope drift or partial strategy requirement remains.

### Strategy-attempt coverage delta

```text
TERMINAL ALERT PERSISTENCE
==========================
[+] alert write succeeds -> durable alert, historical phase retained
[+] sync fails before rename -> old complete journal retained, manual journal blocker
[+] flush fails after rename -> reread durable alert, original integrity blocker wins
[+] reread finds durable alert under any phase -> manual alert dominates
[+] no durable alert -> published-journal/resumed/manual-only result, no auto command

REPEAT AND REGRESSION SAFETY
============================
[+] retry after absent alert -> durable accounting ESTALE alert
[+] stable durable alert -> byte/result deterministic repeat
[+] stale failed/complete wrapper -> alert dominates without journal rewrite
[+] corrupt payload -> preserved in regression and reviewer reproduction
`-- [+] normal recovery paths -> complete 32-case fault matrix passes
```

### Strategy-attempt validation evidence

- Exact injected sync-fault regression: **1/1 passed**.
- Full archive fault matrix: **32/32 passed**.
- Independent post-rename/durable-alert flush-fault reproduction: **PASS**; published journal, resumed/manual-only result, historical phase, deterministic repeat, and corrupt bytes all verified.
- `pnpm lint`: **PASS**.
- `pnpm exec tsc --noEmit`: **PASS**.
- `pnpm build`: **PASS**.
- `node bin/rasen.js validate file-placement-hardening-archive-engine --json`: **PASS**, 1/1 valid.
- `git diff --check`: **PASS**, with repository line-ending conversion warnings only.
- This reviewer edited only this canonical report section; no implementation, test, task, handoff, or run-state file was changed.

## Final verdict after strategy attempt 2

**CLEAN - 0 remaining: 0 Blocker, 0 Major, 0 Minor, 0 Trivial.**

The terminal-integrity alert now owns its error boundary. Whether its atomic write fails before publication, fails after durable publication, or is later encountered under a stale generic wrapper, the engine returns the authoritative published-journal/manual-only state, preserves the corrupt payload and historical journal phase, and never falls back to ordinary automatic recovery.
