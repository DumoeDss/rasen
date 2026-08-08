## Context

Child 1 shipped `change-finalization-record-v2` as pure validation: `src/core/store/finalization-v2.ts` can decide whether an outcome is shape-valid, whether a supersession preserves project ownership, whether a landed proof is complete, and whether an Archive v2 record round-trips deterministically. Nothing calls it. It has a `validateFinalizationOutcome`, an `ArchiveV2Schema`, and a `serializeArchiveV2` with zero production writers, and its `ChangeInstanceIdSchema` comment says so out loud: "Archive JSON does not carry a Change seed/planning-scope preimage, so these schemas intentionally return format-valid wire ids rather than verified ids." Producing verified ids is this change's job.

Underneath sits a transaction engine that already solves the hard part of archiving and knows nothing about any of this. `src/core/archive-engine.ts` is 4,500 lines of staged copy, fingerprint verification, no-clobber publication, per-phase journalling, quarantined source removal, and resumable recovery. Its plan carries `roots`, `paths`, `specActions`, `sidecar`, `cleaner`, `shipLog`, and an ordered action list; its accounting (`src/core/archive-accounting.ts`) records `change`, `archivedAt`, `codeCommit`, `planningBranch`, `planningTreeState`, `evidence`, `probes`, `handoffAbsorbed`, `ephemeraDiscarded`, `missing`. There is no outcome, no project, no target line, no Change instance, no workspace pair, and `resolveArchiveTransactionPaths` composes exactly `${date}-${change}`.

Between the two, `src/core/archive.ts` refuses. `storeFinalizationDiagnostic()` returns `store_v2_finalization_unavailable` for any `store-project` scope, and `storedPlanFinalizationDiagnostic()` refuses a stored plan whose recorded scope says the same. Both were written by `store-planning-scope-routing` as deliberate fail-closed placeholders naming this change. Three journeys assert the code by name — `test/cli-e2e/store-lifecycle.test.ts:621` and `:763`, `test/cli-e2e/capstone-journeys.test.ts:327`, `test/commands/store-v2-planning-scope-journey.test.ts:497` — precisely so the claim cannot rot into a stale pass. Updating them is this change's designed-in work, not collateral damage.

Two facts shape everything below. First, the accepted design splits archiving into a *semantic terminal state* and a *physical filing* (§8.1), and only the first of the four terminal states may touch canonical specs. That split has to be structural, because a boolean "should I sync specs?" is exactly the kind of flag that is correct in review and wrong three refactors later. Second, everything the record needs beyond the old accounting — project, target line, Change instance, workspace pair, outcome, reachability — is a fact some earlier child owns, and this change must consume verified values rather than re-derive them. Where a fact cannot be obtained verified, the correct answer is to refuse, never to synthesize a well-formed placeholder that makes the record validate.

This is the fifth slice in a serial portfolio. It does not own Store Issues, Execution Plans, Store aggregate query, the management UI, the portfolio-wide read-caller sweep, or the doctor/CI consistency gates.

## Goals / Non-Goals

**Goals:**

- Give every Change exactly one explicit terminal state, and make `landed` the only one that can change a canonical spec — structurally, not by a conditional.
- Prove a landed Change landed, against the code ref its own target line declares, and refuse when the proof is missing, unresolvable, or negative.
- Let a Store express "this attempt is dead, the work moved" without lying in its specs and without leaving the Change active forever.
- Make an Archive v2 entry unique by construction across same-day retries, repeated attempts, and concurrent release lines.
- Keep the existing crash-consistency guarantees intact by wrapping the transaction engine, and extend the transaction so the binding's terminal state is inside it rather than after it.
- Give direct, bulk, ship, and API exactly one finalization algorithm, proven by a parity test rather than by inspection.
- Retire `store_v2_finalization_unavailable` honestly: remove the code, rewrite the journeys that assert it into journeys that finalize, and let the removal be visible.

**Non-Goals:**

- Merging a planning branch into a Store integration ref, merging code into a target line's code ref, or any Git write at all. Finalization reads Git and refuses; the merges in the accepted design's §9.1 stay the user's.
- Creating, reusing, pairing, or removing worktrees; authoring or re-pointing target lines. Those are `store-planning-worktree-bindings`'.
- Upgrading, rewriting, or wrapping a legacy `archive.json`. Entries `store-layout-v2-migration` relocated stay byte-identical, and no outcome, target line, or workspace pair is invented for them.
- Store Issue / Execution Plan resources, cross-project aggregation, or management UI surfaces for outcomes.
- The portfolio-wide migration of read-only archive consumers, the doctor/CI gates that cross-check Archives against target-line records, and the full acceptance matrix. Those are `store-v2-compat-hardening`'s.
- Any change to standalone or legacy flat Store archiving beyond what the shared engine changes force. Both keep their current implicit behavior and their v1 `archive.json`.
- A forge adapter, a network call, or any `gh` invocation.

## Decisions

### 1. One deep `ChangeFinalizationModule` with `plan` / `apply`

```ts
interface ChangeFinalizationModule {
  plan(input: FinalizeChangeInput): Promise<ImmutableFinalizationPlan>;
  apply(token: FinalizationPlanToken): Promise<FinalizationResult>;
  describe(input: DescribeFinalizationInput): Promise<FinalizationDescription>;
}

interface FinalizeChangeInput {
  readonly scope: ChangeFinalizationScope;
  readonly changeId: string;
  readonly outcome: FinalizationOutcomeRequest;
  readonly codeCommit?: string;
  readonly successorTargetLine?: string;
  readonly skipSpecs?: boolean;
  readonly keepEphemera?: boolean;
  readonly intentFile?: string;
}
```

`plan` is read-only and total: it resolves the scope, the frozen identity, the outcome, the successor, the reachability proof, the spec actions, the destination, the record draft, the evidence inventory, and the lock keys, and reports every unsatisfied precondition rather than stopping at the first. `apply` consumes only the token. The Module hides outcome semantics, Git reachability, successor search across Store refs, layout addressing, record serialization, association completion, and the underlying transaction; callers see an outcome, a plan, blockers, and a result.

`StorePlanning` gains a fourth intent, `finalize-change`, returning a `ChangeFinalizationScope` that carries the verified Store, project, target line, planning worktree, and — via child 4's index — the workspace pair. Finalization is a distinct intent from `create-change` because its authority requirements differ: it needs the Change to already exist, its frozen identity to verify, and its target line to match, none of which creation checks.

Alternative considered: add outcome handling directly to `ArchiveCommand`. Rejected — that puts Git reachability, successor resolution across refs, and record production in a Commander adapter, and the accepted design's §13 lists `ChangeFinalizationModule` as its own deep Module precisely so finalization and migration can evolve independently of the transaction implementation.

### 2. The outcome model is a closed union, and the plan's *type* carries it

```text
                  ┌──────────────► landed      (spec sync, code proof, no reason)
active Change ────┼──────────────► superseded  (no spec sync, reason + successor)
                  ├──────────────► cancelled   (no spec sync, reason)
                  └──────────────► abandoned   (no spec sync, reason)
```

There is one transition, it is one-way, and there is no path between terminal states. Re-finalizing a Change that is already archived is not a transition; it is `finalization_already_complete`, decided from the published entry and the journal rather than from a directory scan. Correcting a recorded outcome is not offered: an Archive is passive history, and rewriting it would make the audit record mutable. The stated repair is a new Change instance.

The critical structural choice is that `ImmutableFinalizationPlan` is a discriminated union on `outcome`, and **only the landed variant has a `specActions` field at all**:

```ts
type ImmutableFinalizationPlan =
  | (FinalizationPlanBase & { outcome: 'landed'; specActions: readonly PreparedArchiveSpecAction[]; codeMerge: ArchiveCodeMerge | null })
  | (FinalizationPlanBase & { outcome: 'superseded'; reason: string; supersededBy: ChangeInstanceId })
  | (FinalizationPlanBase & { outcome: 'cancelled' | 'abandoned'; reason: string });
```

A passive plan has nothing to populate, so "did we remember to skip spec sync?" is not a question the code can get wrong. The engine call site reads `plan.outcome === 'landed' ? plan.specActions : []` at exactly one place, and a test asserts that the passive variants are not assignable to a shape carrying spec actions. This is the accepted design's invariant 6 expressed in the type system rather than in a branch.

Child 1's `validateFinalizationOutcome(value, currentScope, successorScope?)` is the sole validator for the request half; this change adds no second outcome parser. Standalone and legacy flat Store archiving does not enter this union at all — it keeps the existing plan and the existing implicit behavior, dispatched on the resolved scope kind, never on a path substring.

### 3. Wrap the transaction engine; extend it at four named seams

The engine stays the transaction. It is where staged copy, fingerprinting, no-clobber publication, journalling, quarantine, and resume already live, and re-implementing crash consistency to add an outcome field would be the worst trade in the portfolio. Four extensions, each small and each named:

| Seam | Extension |
| --- | --- |
| `CreateArchivePlanInput` | optional `finalization: { outcome, record, destination, associationTargets, lockKeys }`. Absent for standalone and legacy archives, which behave exactly as today. |
| `resolveArchiveTransactionPaths` | accepts an explicit `finalPath` override. Store v2 supplies the Foundation-computed `archive-entry` address; everything else keeps composing `${date}-${change}`. |
| accounting adapters | `resolveArchiveAccounting` / `writeArchiveJson` / `verifyArchiveAccounting` dispatch on the presence of the finalization block: v2 writes the validated `ArchiveV2Wire` through `serializeArchiveV2`, v1 writes today's `ArchiveAccounting`. Both write atomically and verify by re-parse before the active source is removed. |
| journal | one new phase, `association-finalized`, between `accounting-finalized` and `source-removed`. |

Everything else — `ArchivePlan.scope`, `sourceFingerprint`, `preconditions`, `decisions`, `cleaner`, `sidecar`, `shipLog`, the action list, the blockers — is reused unchanged. The finalization plan *embeds* the engine plan rather than duplicating it, and `planId = sha256(canonicalBytes(finalizationPlan))` covers both halves, so a change to either invalidates the token.

Two schemas will share the filename `archive.json`. They are dispatched by the Store's declared layout and the plan's recorded scope, never by sniffing the file — the same discipline child 3 established for `projects/<id>.yaml`. A reader that encounters a v1 record inside a v2 partition is reporting a relocated legacy entry, which is a diagnostic for child 7, not a variant to tolerate silently.

### 4. Landed reachability is a proof, and `implementation: none` is the only way around it

For a code-backed landed Change, the plan resolves in order and records which source it used:

1. `--commit <oid>` if supplied;
2. the ship log's `**Commit:**` line, which `resolveShipLogPlan` already extracts;
3. the execution worktree's `HEAD`.

Then it proves, in the execution repository, through the read-only Git adapter:

- the commit resolves to a commit object (`rev-parse --verify <oid>^{commit}`);
- the target line's `projects[projectId].codeRef` resolves to a commit (`target_line_ref_unresolved` otherwise, naming the field and the repository, reusing child 4's contract);
- `merge-base --is-ancestor <commit> <codeRef>` succeeds.

Any of those failing is a refusal, with the two OIDs and the ref named. An indeterminate Git result — the adapter cannot confirm either way — is `landed_proof_unavailable` and refuses; `reachable` is never defaulted, and child 1's schema helps by typing it `z.literal(true)`, so an unproven landed record cannot even be constructed.

The honest limitation, stated in the plan and in the recorded evidence: **Rasen fetches nothing**, so the proof is "reachable from this ref as it stands locally". The plan freezes the code ref's OID at proof time and `apply` re-proves under the lock; if the ref moved, the plan is stale rather than silently re-proven against new history. Archive v2's `codeMerge` has no field for the ref OID, so it is recorded in the plan and in the evidence inventory rather than invented into the record. If the local ref is behind the remote, the proof can only fail closed, never falsely succeed — an ancestor of an older ref is an ancestor of its descendant.

`implementation: none` is read only from the Change's committed `.openspec.yaml`, whose schema already carries it (`src/core/change-metadata/schema.ts:103`) and whose meaning child 1 fixed: "the explicit portable declaration that a Change has no code implementation; absent implementation intent retains code-backed compatibility". There is deliberately **no** `--implementation` flag on archive. The accepted design is explicit that a planning-only Change declares itself at creation and cannot bypass the proof at archive time, and a flag would be exactly that bypass. A Change with no declaration and no reachable commit refuses and names the repair: declare the intent in the Change and commit it, or land the code.

### 5. Successor resolution reads blobs across Store refs, and refuses ambiguity

`--outcome superseded --by <changeInstanceId>` needs the successor's *scope*, not just its id, because child 1's rule is that supersession must preserve Store and project and may cross target lines — and the whole motivating case (abandon 0.1.7, do 0.2.0) puts the successor on a different line, i.e. on a different Store ref that is not checked out here.

The accepted design is silent on how to find it. This change resolves the silence with the read-only, per-ref technique child 3 already established for inventory:

1. Enumerate the Store's target-line catalogs and take each line's `storeRef`.
2. For each ref, list the candidate Change metadata paths under every project partition as Git blobs (`git show <ref>:rasen/projects/<p>/changes/<c>/.openspec.yaml`) — plus the archive entries, because a Change may be superseded by one already finalized.
3. Parse each blob's v2 identity block and re-derive its `ChangeInstanceId`; keep the ones that equal `--by`.
4. Require exactly one match. Zero is `successor_scope_unverified`. More than one is `successor_ambiguous`, listing every claimant and choosing none. A match in another project is refused by child 1's `validateFinalizationOutcome`; a match in another Store cannot occur because only this Store's refs were searched.

`--by-target-line <id>` narrows the search to one line for a large Store, and is a filter, never a substitute for verification. Nothing is checked out, merged, or fetched. A ref that cannot be read is reported as an unsearched ref rather than treated as "not found", so an unreadable ref can never turn a real successor into `successor_scope_unverified` silently.

### 6. The target-line guard fires before anything is read or written

The Change's target line is frozen in its v2 identity block. Finalization resolves a target line from the scope, compares it to the frozen one, and refuses with `target_line_mismatch` naming both **before** computing a destination, reading a canonical spec, or touching the engine. The destination is then computed from the *frozen* line, so even a bug in scope resolution cannot file a 0.1 Change under 0.2.

This reuses child 4's gate rather than adding a second one. The reason it must also fire here, and not only at scope resolution, is that finalization is where the consequence is irreversible: a Change filed under the wrong line takes its Archive, and any landed spec action, into the wrong release line's Git history.

### 7. Landed-only spec sync reuses the prepared actions and adds the digests

Spec synchronization mechanics do not change; their authority does. The existing pipeline — `findSpecUpdates(changeDir, specsDir)` → `buildUpdatedSpec` → `PreparedArchiveSpecAction { capability, action, source, target, sourceSha256, targetPrecondition, rebuilt, counts }` → the engine's `write-spec` / `delete-spec` actions with `targetPrecondition` revalidation — is exactly what a landed Store v2 finalization uses, resolved against the project partition's `specs` location from the scope seam.

The Archive v2 record's `specSync.actions` is derived from the same prepared actions, so the record cannot describe a sync that did not happen:

| Prepared action | `beforeSha256` | `afterSha256` |
| --- | --- | --- |
| `create` | `null` | `sha256(rebuilt)` |
| `update` | `targetPrecondition.sha256` | `sha256(rebuilt)` |
| `delete` | `targetPrecondition.sha256` | `null` |

`capabilityId` is the capability directory name, validated through `parseChangeId` as child 1's schema requires. A `create` action whose `targetPrecondition.state` is not `absent`, or an `update`/`delete` whose precondition is `absent`, is a planning bug and blocks rather than being coerced into a shape that validates.

For a passive outcome the plan has no `specActions` field (decision 2), the engine receives an empty action list, and the record carries `specSync: { applied: false, actions: [] }` — which child 1's `PassiveSpecSyncSchema` types as `z.tuple([])`, so a non-empty passive list cannot be serialized. The acceptance evidence for this is a byte-identity fixture: finalize a Change with real delta specs as `abandoned` and assert every file under the project's `specs/` is byte-identical before and after, not merely "no diff reported".

`--skip-specs` with `--outcome landed` refuses when deltas exist, because the landed record asserts `specSync.applied: true` and an empty action list would make that assertion false. It stays valid for a landed Change with no deltas, where `applied: true` with an empty list is exactly what child 1's "Landed record may apply no-op spec plan" scenario describes.

### 8. Association completion is a journaled phase, not an epilogue

The accepted design's §13.1 requires the association's terminal state to become "a completion condition of the same recoverable transaction". Today there is no such update at all, and the shape it must *not* take is a best-effort write after publication: a crash in that window leaves a bound workspace pair pointing at a Change directory that has moved, which is precisely the state child 4's index treats as a conflict and refuses to operate against.

So `association-finalized` is a journal phase between accounting and source removal, and the transaction is not complete until it lands:

1. Update the machine workspace-index entry for the pair to its finalized terminal state, recording the outcome, the published entry address, and the archive timestamp.
2. Update the execution-side `.rasen/planning-binding.json` to record its Change as finalized, so a later mutation from that checkout does not resolve an archived Change as active.
3. Leave the planning-worktree marker alone. The worktree remains usable until cleanup, which is child 4's plan/apply and has its own preconditions.

Failure handling follows child 4's rule exactly — conflict fails, absence is repaired. A **missing** index entry is reconstructed from the markers and live Git before the update, writing no fact not already true on disk. A **disagreeing** entry fails closed with `planning_execution_binding_mismatch` and the transaction stops recoverable, with the archive published and the journal naming the phase, so the operator repairs the binding and re-applies the same token. A scope with no workspace pair — standalone, legacy, or a hand-run Store v2 finalization where child 4's index has no entry and no markers exist — makes the phase a recorded no-op rather than a failure, and the plan says so in advance.

### 9. Two locks, and an honest note about the third

Finalization acquires child 4's owner-aware machine-root locks in child 4's fixed order:

| Key | Material | Taken here |
| --- | --- | --- |
| scope | `(storeUid, projectId, targetLineId)` | yes — the destination and the canonical specs are scope-owned |
| workspace | `(workspacePairId)` | no — no worktree is created, moved, or removed |
| change | `(changeInstanceId)` | yes — two finalizations of one Change instance must be mutually exclusive |
| integration | `(storeUid, targetLineId)` | **no** |

The accepted design's §10 lists the integration lock for "合入同一 Store integration ref 时串行". This change performs no merge into a Store integration ref, and its writes all land in the invoking planning worktree's own tree — two Changes on one line finalizing in two planning worktrees write two different trees and cannot collide on the filesystem. Taking a lock that protects nothing would make it look enforced when the operation it guards has not been built. The key is therefore left defined-and-unheld, and the condition is stated: the first slice that merges a planning branch into an integration ref must take it. Contention retries within a bounded deadline; a semantic conflict never retries.

### 10. Every surface consumes one plan, proven by parity

| Surface | What it adopts |
| --- | --- |
| direct | `rasen archive <change> --outcome … [--by] [--reason] [--commit]`, plus the existing `--dry-run` / `--save-plan` / `--apply-plan` triad, which now round-trips the finalization plan. The stored-plan gate is replaced by a stored-plan **revalidation**. |
| bulk | `rasen-bulk-archive-change` keeps invoking the same CLI per change through `GENERATED_ARCHIVE_COMMAND_EXAMPLES`; its gate paragraph loses the refusal and gains the rule that every change in the batch needs its own explicit outcome, and that a batch never infers one from a sibling. |
| ship | `rasen-ship`'s in-ship archive passes `--outcome landed`, and refuses when the delivered commit is not yet reachable — replacing "we shipped, therefore archive" with the same proof the direct path uses. |
| API | `POST /api/v1/stores/:storeUid/projects/:projectId/lines/:targetLineId/changes/:instance/finalize`, mutating only by spawning the CLI, as `management-http-api`'s security requirement already mandates for every mutation. It requires the complete scope in the URL and the outcome in the body, and infers nothing from a UI filter. |

Parity is asserted, not assumed: one test drives all four entry points with the same inputs and compares the canonicalized plan bytes, in the shape `createGeneratedArchiveConsumerArgv` already established for the three CLI consumers. That is what makes "one finalization algorithm" a measurable property rather than a claim in a proposal.

The API deliberately adds only the mutation. The `/api/v1/stores/**` read family, Issue and Execution Plan resources, and project/line aggregation are `store-scoped-issues-management`'s, and that child will extend the same security requirement this change is modifying — a serial dependency worth flagging, because its delta must copy the post-this-change scenario set.

### 11. What this change takes from child 4, which is unimplemented

`store-planning-worktree-bindings` is proposal-only. Five things are consumed from it, each with the fallback this change takes if the contract shifts:

| Consumed | Why | Fallback if it shifts |
| --- | --- | --- |
| `WorkspacePairId` completion on Change creation | Archive v2 requires a verified pair on **every** record, including passive ones | If the pair is unavailable, finalization refuses with `workspace_pair_unavailable` rather than minting one. It never fabricates a pair id to satisfy the schema. |
| Target-line `resolve` to refs and OIDs | The landed proof needs the project's code ref | Falls back to reading the target-line catalog directly through the Foundation contract and resolving the ref with this change's own read-only Git adapter. The catalog schema is child 1's and is already canonical. |
| The `target_line_mismatch` gate | Decision 6 | Implemented locally against the frozen identity block if child 4's gate is not present; the check is a comparison of two validated ids and does not need child 4's machinery. |
| The four lock keys and their acquisition order | Decision 9 | Falls back to deriving the two keys this change takes from the same canonical serialization, using `acquireOwnerAwareFileLock` directly. |
| The machine workspace index and the execution association marker | Decision 8 | With no index and no markers, the association phase is a recorded no-op. This is the standalone/legacy path anyway and is already specified. |

There is one genuine contract tension to flag rather than paper over. Child 1's Archive v2 requires a `workspacePairId` on every record, and `WorkspacePairId` is derived from a Change instance plus a **planning and an execution** worktree instance. A planning-only Change (`implementation: none`) has no code, yet still needs an execution worktree to have a pair id. Child 4's `plan` prepares both sides unconditionally, so a Change prepared through it does have one, and the pair then means "where the work happened", not "where code landed" — which is coherent, because `codeMerge: null` already carries the "no code" fact. If child 4 later gains a planning-only preparation mode with no execution side, the record contract needs a nullable pair for that case, and that is a `change-finalization-record-v2` amendment, not something this change may work around by inventing a synthetic execution worktree identity.

### 12. Dependencies stay behind this Module's adapters

- **In-process:** child 1's outcome and record validators, the Foundation layout/identity/catalog contracts, the scope seam, the spec-apply pipeline, and the archive engine. Composed directly; no adapter.
- **Local-substitutable:** filesystem and canonicalization; read-only Git (`rev-parse`, `show`, `for-each-ref`, `merge-base --is-ancestor`, `status --porcelain`); the machine-root coordination store for plans, locks, and the workspace index; clock; entropy. Tests use deterministic in-memory adapters with a fixed clock so a plan is reproducible byte for byte.
- **Consumer adapters:** the Commander archive surface, the four generated workflow templates, and the management route. They format and forward; they hold no outcome logic.
- **Remote:** none. No fetch, no push, no `gh`, no network. The Git write verb set is empty — finalization is the only slice in this portfolio that mutates the Store's working tree while making no Git call that writes.

## Risks / Trade-offs

- [Risk] Requiring `--outcome` makes the first Store v2 archive fail for everyone who types the command they know. → The refusal names all four outcomes, states which ones need a reason and which needs a successor, and shows the exact command. An implicit default would have to be `landed`, which is an implicit spec sync — the one thing the accepted design's invariant 6 exists to prevent.
- [Risk] Two schemas under one `archive.json` filename could be read with the wrong parser. → Dispatch is on the Store's declared layout and the plan's recorded scope, never on file content, and this is the same rule child 3 applied to `projects/<id>.yaml`. A v1 record found in a v2 partition is a relocated legacy entry and is reported as a diagnostic rather than tolerated as a variant.
- [Risk] The landed proof is only as good as the local ref, so a user whose target ref is behind sees a false refusal. → It can only fail closed, never falsely succeed. The diagnostic names the ref, its local OID, and the commit, and says to fetch. Fetching on the user's behalf is outside the closed verb set for the same reason child 4 closed it.
- [Risk] Successor resolution reads every Store ref's project partitions and could be slow on a large Store. → It reads blobs, never checks out, and `--by-target-line` narrows it to one ref. The cost is bounded by the number of target lines, which is small by construction, and it runs only for `superseded`.
- [Risk] Making association completion a transaction phase means a broken binding blocks a finalization whose files are already published. → That is the intended trade: the alternative is a bound pair pointing at a moved directory, which child 4's index treats as a conflict and refuses to operate against — so a "successful" archive would leave the workspace unusable. The archive stays published, the journal names the phase, and re-applying the same token completes after the binding is repaired.
- [Risk] Wrapping a 4,500-line engine and threading an optional block through it risks changing standalone behavior by accident. → The finalization block is absent for standalone and legacy plans, a baseline suite captures current standalone and legacy archive behavior before any seam moves, and the destination override defaults to today's `${date}-${change}` composition.
- [Risk] Retiring `store_v2_finalization_unavailable` breaks agent skills installed from earlier builds. → It is a first-class BREAKING bullet, `rasen update` reinstalls the templates, and the template guard test is updated in the same commit so the clause cannot survive by inattention — which is exactly how it survived once already (child 2's round-3 finding R3-1).
- [Risk] The `store-planning-scope-routing` delta modifies a requirement that only exists in child 3's unarchived delta, so archiving out of order fails with `archive_spec_update_failed`. → It is called out in `tasks.md` as an ordering precondition, and the pairwise title/scenario comparison runs before the archive step, as the portfolio's ship gotchas require.
- [Risk] Depending on an unimplemented child 4 could leave this change unbuildable or, worse, quietly stubbed. → Decision 11 names every consumed contract with a concrete fallback, and the fallbacks are all "do it locally with contracts that are already canonical" rather than "assume it". The one case with no fallback — a missing workspace pair — refuses.
- [Risk] Windows case-insensitive filesystems could alias two archive entry addresses. → The address comes from the Foundation layout contract, which is already containment- and case-checked, and the instance suffix is a lowercase hex digest prefix. Destination fixtures run against `path.win32` and `path.posix` explicitly.

## Migration Plan

1. Land children 3 and 4 first; this change assumes project partitions, catalogs, the layout write guard, prepared worktree pairs, and resolvable target lines exist.
2. Add the Module contracts, the `finalize-change` scope intent, the `archive-entry` address, and the read-only adapters, with no write path enabled and no gate removed.
3. Add outcome resolution, the reachability prover, successor resolution, and the target-line guard as pure/read-only logic, fully tested before anything writes.
4. Add the four engine seams and the Archive v2 accounting writer, keeping standalone and legacy paths on the v1 writer and proving it with the baseline suite.
5. Add plan construction, the token, revalidation, the locks, and `apply`; then remove both `store_v2_finalization_unavailable` gates in one commit with the journey rewrites and the template updates, so the tree is never in a state where the code claims a refusal the CLI no longer performs.
6. Add association completion as a journal phase and its recovery cases.
7. Adopt the four surfaces and add the parity test.
8. Verify: focused Module suites, byte-identity fixtures for passive outcomes, the recovery matrix, cross-platform destination fixtures, the rewritten journeys, typecheck, lint, build, `rasen validate store-finalization-outcomes-v2 --strict`, `git diff --check`, and a strict UTF-8 audit of every changed file.

Rollback before any Store v2 Change has been finalized is removal of the unused Module and restoration of the two gates. After entries exist, rollback must keep *reading* them: a reverted build must still resolve and display a target-line-scoped Archive v2 entry, and must refuse a Store v2 finalization it can no longer perform rather than falling back to the v1 writer, which would produce a second record schema inside an entry address only v2 understands. No rollback path rewrites, downgrades, or deletes a published Archive.

## Open Questions

None blocking. Four decisions resolve silences or tensions in the accepted design and are the ones worth re-reading in review: resolving a superseding Change by reading blobs across the Store's target-line refs, which the design requires but never specifies (decision 5); leaving the integration lock defined-and-unheld because this change performs no merge, which diverges from the design's lock table (decision 9); making association completion a blocking transaction phase whose failure leaves a published archive in a recoverable state (decision 8); and the `WorkspacePairId` requirement on a planning-only Change, which is a real tension between child 1's record contract and what a planning-only workspace means (decision 11). Merging a planning branch into its integration ref, upgrading relocated legacy Archive entries, Store Issue aggregation, and the doctor/CI consistency gates remain later slices and can consume the Archive v2 records and the outcome vocabulary without changing this Module's Interface.
