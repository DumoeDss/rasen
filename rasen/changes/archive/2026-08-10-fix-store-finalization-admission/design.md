## Context

The parent implementation already has one Store finalization Module and one archive engine. It also has partial defenses for the remaining findings: association/index comparison no longer needs cached heads, the execution association path is derived in `resolveContext()`, the generic landed-skip gate can see preparation blockers, Store abort delegates to `abortArchivePlan()`, and the human abort formatter has a blocker-first helper. The open work is to make those boundaries complete and prove them through the surfaces that actually ship.

The management bridge currently combines admission with persistence: its first subprocess runs `--dry-run --save-plan`, then checks the committed `changeInstanceId`. An identity refusal can therefore leave `plan.json` under the machine transaction store. The same suite tests merge admission and disposition decoding only as direct helpers, so it does not prove that the loopback router, spawned CLI, process exit status, JSON decoder, and HTTP error envelope agree.

Store finalization also receives reconciliation failures only after `SpecReconciliationIssue` has been flattened into `ArchiveBlocker`. That loses the typed capability, requirement, and missing-scenario fields before the finalization plan and management response are built. Separately, the association writer test still expects the workspace protocol's obsolete refusal of an exact unclaimed intent.

This child consumes four review-clean dependencies. It uses spec reconciliation's complete typed issue array, archive recovery's cleaner and abort authority, registry selection's canonical main-first/conflict-aware lookup, and workspace persistence's self-contained-versus-journal-bound authority plus explicit directory-durability tuples. It must not create substitute classifiers for any of them.

## Goals / Non-Goals

**Goals:**

- Make management-route refusal transaction-store neutral until identity and blocker admission succeeds.
- Prove `mergeConfirmed` and incomplete dispositions through real loopback HTTP and real child-process boundaries.
- Preserve every typed reconciliation issue, including duplicate source/capability occurrences, through Store finalization and management JSON.
- Freeze a usable association before mutation, compare immutable pair identity separately from mutable Git facts, and keep workspace persistence on the shared atomic writer.
- Keep Store project selection and recovery on the dependency children's canonical authority paths.
- Guarantee blocker-first human abort guidance.

**Non-Goals:**

- Changing reconciliation rules, archive cleaner classification, archive abort eligibility, project-registry alias reduction, workspace carrier formats, or directory-sync allowlists.
- Adding a second project selector, path-identity comparator, delete authority, recovery classifier, or atomic-write implementation inside finalization.
- Making a stale cached head authoritative, repairing a missing association after publication, or deduplicating diagnostics for presentation.
- Changing finalization outcomes, archive addresses, record formats, or public HTTP success fields.

## Decisions

### 1. Split management admission from persistence and apply the exact saved token

`createFinalizationCliArgv()` will expose three explicit subprocess shapes:

1. `inspect`: the existing scoped `archive <change> ... --dry-run --json` arguments with no `--save-plan`;
2. `save`: the same scoped arguments plus `--save-plan`, run only after the inspection's committed Change instance and blocker set are admitted;
3. `apply(token, mergeConfirmed)`: `archive --apply-plan <token> --json`, adding `--yes` only when the request explicitly carries `mergeConfirmed: true`.

The bridge will parse and admit the unsaved inspection before it can call `save`. It will then parse the saved response again, recheck the Change instance and blockers, and apply only the token returned with that exact saved plan. It will never reconstruct, patch, or re-hash a plan in the server. A path identity mismatch, omitted/false merge assertion, or second blocker stops before the save subprocess, so the transaction-store byte inventory remains unchanged.

The alternative is to keep `--save-plan` in the inspection and clean up on refusal. Cleanup would require abort authority, leave a tombstone, and turn a read-only admission error into a recovery transaction. Passing `--yes` unconditionally to apply was also rejected because it turns omission/false into a merge assertion and can admit a gate that appears after inspection.

### 2. Treat the sole typed merge blocker as the only assertion-admissible blocker at both previews

One shared inspection function will evaluate both unsaved and saved plans. A `true` assertion admits only an array of length one whose direct code or nested archive code is `archive_merge_confirmation_required`. Omitted and false are equivalent for admission. Any second blocker, including a reconciliation, task, identity, selection, or association blocker, refuses before apply.

The saved preview is checked independently rather than trusting the earlier inspection across the subprocess boundary. The exact saved token is the only value passed to apply. Tests will record the complete machine transaction tree before and after each HTTP case: omitted, false, sole-blocker true, and true with a second blocker.

Store finalization dry-run will persist only a blocker-free plan or the one deliberately runtime-satisfiable shape: the sole typed merge-confirmation blocker. A missing association, reconciliation issue, second blocker, or any other non-applicable preview returns no token and creates no transaction-store entry. This persistence admission is shared by CLI and management callers so the second preview cannot manufacture an unreachable blocked token.

The alternative is to strip the merge blocker before general blocker handling. That risks admitting the remaining array incorrectly and obscures whether the saved plan actually contained a second blocker.

### 3. Preserve apply dispositions structurally across child process and HTTP

The decoder will retain the ordered blocker array and its nested archive/spec issue data, plus exactly one applicable disposition field: `recoveryCommand`, `abortCommand`, or `manualRecoveryAction`. The route will place that unchanged structure at `error.finalization` whenever apply exits non-zero or returns a non-complete status. It will derive the top-level code/message from the first blocker without truncating the nested array.

The primary regression will use the real CLI and a real Store fixture to cause an association-phase apply failure after a valid plan, proving the full production chain. Bounded CLI fixtures may additionally force abort-required and manual-only shapes, but they must run as actual spawned processes behind the actual loopback router; direct decoder tests remain supplemental.

The alternative is to trust unit decoding. That cannot catch argv phase mistakes, non-zero exit handling, route flattening, or a server that drops the nested object.

### 4. Carry reconciliation issues as an exact typed side channel, not reconstructed prose

Archive preparation will retain `SpecReconciliationError.issues` as an ordered `SpecReconciliationIssue[]` alongside the generic archive blockers required by the archive engine. `FinalizationArchivePreparation` and `FinalizationBlocker` will carry those exact typed values. `ChangeFinalization.plan()` will emit one finalization blocker per issue, preserving `code`, `source`, `capability`, optional `requirement`, optional `missingScenarios`, and occurrence order. The management decoder will preserve the same nested issue object.

The generic `finalization_spec_skip_conflict` remains only for an intentional `--skip-specs` or prompt-decline `specSync.mode: skip` when spec preparation itself produced no reconciliation issue. A preparation failure with zero actions is non-applicable with its complete typed issue array. No set keyed by source or capability is permitted; two distinct requirements in one file remain two blockers.

The alternative is to enrich an English message after flattening. That loses stable fields, cannot represent duplicate occurrences reliably, and couples APIs to rendering.

### 5. Separate immutable association identity from mutable Git revalidation

Association/index agreement will compare only the pair's immutable identity: Store/project/line/scope, Change and pair identities, roots, repository identities, worktree instance identities, plan id, and lifecycle phase. Cached `ref` and `headOid` projections in an older index do not make an otherwise identical pair disagree.

The plan still freezes the live checked-out refs and heads obtained during planning. Before a fresh apply, `revalidate()` and `assertLiveWorktreePairAgrees()` compare current Git membership/ref/head to those frozen plan facts. Thus ordinary commits made before planning are accepted, while movement after planning still makes the plan stale.

The alternative is to refresh or compare cached index heads during association publication. That makes mutable cache data part of pair identity and can fail only after specs/accounting/publication have advanced.

### 6. Freeze the derived association path and block absence before mutation

For every non-noop pair, planning derives `executionAssociationPath` unconditionally from the admitted execution root and path flavor, stores it in the immutable association block, and inspects that exact file before applicability. Absence becomes a typed `planning_execution_binding_mismatch` preparation blocker and is also represented in the underlying archive plan's blockers, preventing a save/apply path from creating an applicable token. Apply verifies the frozen path against the same derivation and never derives a replacement from current cwd or selectors.

The alternative is to omit the path when the document is absent and fail inside association completion. That permits specs/accounting/publication to succeed before discovering that the immutable token has no recoverable association destination.

### 7. Consume dependency authority at the finalization boundary

`resolveContext()` continues to enter through `StorePlanning.open({ intent: 'finalize-change' })`. Finalization adds no registry lookup: the shared resolver's canonical main-first selection, complete canonical-root claimant group, and normalized registry/config drift refusal are the only admission path. A focused finalization regression will prove drift returns `planning_selection_conflict` before plan persistence or repository mutation.

Stored finalization apply/abort continues to use `withStoredArchivePlanOperation()`, `applyArchive()`, and `abortArchivePlan()`. Cleaner delete authority, abort/retry phase safety, path flavor, destructive operands, and manual disposition therefore remain archive-engine decisions. Finalization only projects the returned status and fields.

Association/index persistence continues to call the workspace dependency's `writeTextAtomic`. An unjournaled exact intent may recover only the independently requested target/bytes/state; a journal-bound call must match its recorded carrier authority and never fall back. Directory durability remains the workspace module's exact platform/stage/error-code table with canonical-directory identity revalidation. No workspace source file is owned by this child.

### 8. Render abort refusal in durable-state order

One formatter remains authoritative for Store and standalone abort refusal. It emits every blocker first, then effective phase and retained paths, then association-pending guidance, then the exact recovery or manual disposition. Ownership/integrity disputes with a manual action receive no generic replay command. Human-output tests will assert relative line order and multi-blocker completeness; JSON ordering remains the source array order.

## Ownership / Touched Set

Owned production files:

- `src/core/management-api/finalize.ts`
- `src/core/management-api/router.ts` and `src/core/management-api/server.ts` only for a bounded finalizer subprocess override used by real loopback tests, if the existing server seam cannot drive it
- `src/core/store/finalization/module.ts`
- `src/core/store/finalization/association.ts`
- `src/core/store/finalization/types.ts`
- `src/core/archive.ts`

Owned focused tests/fixtures:

- `test/core/management-api/store-finalize-api.test.ts`
- a narrowly named fixture under `test/fixtures/management-api/` if needed for child-process disposition cases
- `test/core/store/finalization-association.test.ts`
- `test/core/store/finalization-spec-sync.test.ts`
- `test/core/store/finalization-plan-token.test.ts`
- `test/core/archive.test.ts`
- the smallest existing Store-planning/finalization integration test that can prove registry/config drift refusal without duplicating registry unit coverage

Explicitly not owned: `src/core/specs-apply.ts`, `src/core/archive-engine.ts`, `src/core/project-registry.ts`, `src/core/project-home.ts`, `src/core/store-planning/**`, and `src/core/store/workspace/dependencies.ts`. If a test exposes a defect in one of those dependency-owned implementations, stop and route it to the owning child rather than copying or weakening its contract here.

## Risks / Trade-offs

- [A state change between inspect and save produces a different plan] → Parse and admit the saved plan independently and apply only its exact token; never reuse facts from the unsaved object as mutation input.
- [A blocker is flattened before finalization receives it] → Carry the exact typed issue array separately from generic archive blockers and assert deep equality at plan, CLI JSON, and HTTP layers.
- [A test-only child-process seam becomes a production escape hatch] → Keep it dependency-injected at server construction, default it to the package's resolved CLI, and do not expose it through HTTP or config.
- [Association fixes duplicate workspace recovery] → Make all writes through the existing atomic writer and test its authority modes through finalization; add no carrier parser or directory error table here.
- [Registry coverage accidentally mutates a conflicted registry] → Snapshot registry, config, transaction store, and planning trees and assert byte equality on refusal.
- [Windows path or directory behavior is inferred from a POSIX mock] → Run path-sensitive association/claim tests on native Windows and native POSIX CI; keep explicit platform/stage tuple tests in the workspace child as the authority.

## Migration Plan

1. Add red management tests for unsaved identity admission, the four merge-confirmation HTTP cases, and real apply dispositions.
2. Split inspect/save/apply argv construction and preserve nested response data.
3. Add the typed reconciliation issue channel and red-to-green Store planning/HTTP regressions.
4. Complete association/path admission and update the stale workspace-claim assertion while retaining archive/workspace delegation.
5. Add project-selection and abort-output integration coverage, then run focused suites, TypeScript, ESLint, strict validation, and native platform evidence.

No on-disk schema migration is required. Stored archive plans and workspace claims are not rewritten. Rollback is code-only; any transaction already persisted remains governed by the archive engine's existing exact-token/abort/manual disposition.

## Open Questions

None. The dependency children define the authority mechanisms; this child only closes their Store-finalization admission and projection seams.
