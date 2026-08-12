## Context

Rasen 0.1.7 has two independently sound contracts that do not yet meet at the migration seam:

- `StoreLayoutMigration` inventories a flat Store, resolves project ownership from E1–E4 evidence, builds an immutable content-addressed plan, copies every active Change or Archive entry into a project destination, stages and verifies all output, publishes the layout declaration last, records a receipt, and retires flat sources separately.
- The Store Issue module writes a deliberately small repo-blind `issue.yaml` and immutable Execution Plan v1 revisions. Its public interface is only create, set state, and publish plan; a normal plan publication verifies referenced Change instances against already committed Store evidence.

The old flat model also permitted Change-shaped directories to act as cross-project coordinators. Forcing those directories into one project partition creates false ownership. Copying their tree into an Issue would instead create a second planning model and leak project-specific proposal, task, spec, Pipeline, or repository facts into a repo-blind resource.

The migration already owns the required transaction: one checked-out Store ref, one immutable plan token, destination no-clobber, staging verification, a recovery ledger, receipt publication, the layout-version flip as the linearization point, and separate retirement. The design extends that transaction with generated Issue trees rather than creating another mutation command.

The selected deep seam follows the codebase-design methodology: legacy-input interpretation and canonical Issue serialization are in-process computation hidden behind one small Issue-domain interface; filesystem, Git, publication, and recovery stay behind the existing layout-migration interface. Deleting that compiler would otherwise spread Issue schema, DAG, digest, and serialization knowledge across mapping, staging, CLI, and tests.

## Goals / Non-Goals

**Goals:**

- Preserve mapping version 1 byte-for-behavior compatibility while adding a strict version 2 work-item classification.
- Let trustworthy existing project evidence continue to produce project Changes, while requiring an explicit operator decision for unresolved or conflicting work.
- Compile an explicitly selected coordinator into only the existing Issue record and optional Execution Plan v1 resource shapes.
- Include generated Issue trees in the same whole-ref plan, no-clobber publication, rollback, resume, receipt, and retirement lifecycle as project outputs.
- Preserve every legacy source byte until publication and make tracked bytes independently recoverable from Store Git after retirement.
- Distinguish Store planning-source commits from member code commits in durable provenance.
- Give `rasen archive <legacy-alias>` a narrow, receipt-proven compatibility diagnostic without turning it into Issue alias resolution.
- Keep human and JSON diagnostics, Windows and POSIX paths, and v1/v2 receipt reads consistent.

**Non-Goals:**

- Inferring coordinator status, Issue title, state, plan nodes, dependencies, or targets from legacy content or naming.
- Copying or translating proposal, tasks, specs, planning-context, portfolio, handoff, or other legacy tree content into an Issue.
- Adding a public legacy-import method to `StoreIssues`, a second IssueStore, a coordinator index, an adapter registry, a standalone import command, or dual writes.
- Changing IssueRecordV1, ExecutionPlanRevisionV1, normal Issue reference verification, Change identity, finalization, Archive v2, or member-project repository behavior.
- Implementing Planning Kernel, Dispatch, Reconciler, automatic project routing, Pipeline scheduling, Issue acceptance, phase/health/progress, Delivery, Board, or external tracker behavior.
- Treating archive placement, archived children, a ship log, or a Store commit as Issue completion or acceptance.

## Decisions

### 1. Parse mapping v1 and v2 separately, then normalize to one internal work disposition

Mapping v1 remains its current strict schema. Its loader, E1–E4 reducer interaction, errors, target-line defaults, destinations, and receipt evidence are pinned by characterization tests before any v2 work. It normalizes internally to the project disposition only; it never passes through a heuristic that could discover an Issue.

Mapping v2 has separate closed schemas for active and archived collections:

```yaml
version: 2
defaultTargetLine: release-0-2
targetLines:
  release-0-2:
    storeRef: refs/heads/release/0.2
    projects:
      scene-bridge:
        codeRef: refs/heads/release/0.2

changes:
  child-change:
    kind: project-change
    project: scene-bridge
  coordinator:
    kind: store-issue
    issueId: coordinator
    title: Coordinate the cross-project release
    plan: rasen/migration-inputs/coordinator-plan.yaml

archive:
  historical-coordinator:
    kind: store-issue
    issueId: historical-coordinator
    title: Coordinate the historical release
    state: resolved
    reason: Operator declares the historical intent concluded; acceptance evidence is unavailable.
```

The active `store-issue` branch accepts `issueId`, `title`, and optional `plan`; state is generated as `open`, and state/reason fields are rejected. The archived branch additionally requires an explicit `state: open | resolved | dropped`; `reason` is absent for open and required for either terminal state. The `project-change` branch accepts only `project` and optional `targetLine`. Both branches reject unknown and cross-branch fields.

Normalization follows this order:

1. E1 recorded identity is binding. It produces `project-change`; a v2 `store-issue` declaration or different project is a whole-file contradiction.
2. With no v2 work declaration, one trustworthy member-project result from the existing E2/E3 reducer produces `project-change` unchanged.
3. An absent or conflicting result stays unresolved unless v2 explicitly selects `project-change` with a project or `store-issue` with Issue fields.
4. An explicit v2 declaration is recorded as an operator assertion alongside, not disguised as, derived evidence. E2/E3 evidence remains visible when the operator selects Issue; only E1 forbids that classification.
5. Existing target-line declaration and catalog validation remain the only target-line source for project Changes.

This keeps manual mapping ahead of inference without turning an already recorded project identity into a mutable classification.

**Alternatives rejected:** requiring a declaration for every v2 item would duplicate already trustworthy identity and ownership facts; allowing v1 to opt into Issue conversion would silently change an existing operator contract; content/name heuristics would make receipt provenance irreproducible.

### 2. A plan input is a tracked, digest-bound Store document and never the legacy tree

The `plan` value resolves like the mapping file: from a Store-relative path, through canonical containment that rejects symlink, junction, drive, separator, and case aliases escaping the Store. The loader proves that the exact path is tracked at the plan's Store HEAD, the index and worktree bytes agree with HEAD, and strict UTF-8 decoding succeeds without BOM or replacement characters. Its path, blob/content digest, and Store HEAD are bound into the plan token and revalidated before staging.

The YAML shape matches the existing `store issue plan --from-file` top-level `nodes:` input, with one migration-only addition:

```yaml
nodes:
  - nodeId: child
    kind: change
    projectId: scene-bridge
    targetLineId: release-0-2
    sourceChange: child-change
    dependsOn: []
  - nodeId: documentation
    kind: intent
    projectId: scene-bridge-docs
    targetLineId: release-0-2
    summary: Publish the integration guide
    dependsOn: [child]
```

A canonical `changeInstanceId` node is verified through the existing Store evidence path. A `sourceChange` node must still declare project and target line. The migration planner resolves its selector only against active source items in the same plan that have the `project-change` disposition and one verified or newly minted canonical identity; project and target line must match. It then replaces `sourceChange` with `changeInstanceId` before handing nodes to the Issue compiler. An archived legacy entry has no canonical Change identity and cannot satisfy the selector. The selector never reaches a generated revision, receipt-owned live link, query, or later command.

Issue compilation occurs only after project dispositions, target lines, catalogs, and Change identities have been decided, but before destination uniqueness and the final plan digest are frozen. No input means no node parsing: the plan records a no-plan continuation with the exact existing Issue plan command.

**Alternatives rejected:** parsing legacy proposal/tasks/specs would invent an execution graph; accepting an untracked or dirty plan would bind the receipt to bytes Git cannot reproduce; persisting `sourceChange` would add alias resolution to the runtime schema.

### 3. The Issue domain exposes one pure migration compiler, not a mutation entry point

An internal Issue-domain module accepts only canonical values:

```text
MigrationIssueInput
  issueId, title, state, reason, createdAt
  normalized ExecutionPlanNodeInput[] | no plan

CompiledIssueTree
  issue summary
  issue-root relative address
  generated files [{ role, relative path, UTF-8 content, sha256 }]
```

It calls the same Issue id/text/state validators, node normalizer, graph checker, revision digest, Issue serializer, and Execution Plan serializer as normal Issue operations. With nodes it builds revision `0001`, `supersedes: null`, and a timestamp fixed by the migration plan. Without nodes it emits only `issue.yaml`; it does not create README, plans directory content, or a placeholder node. `createdAt` means when the new Issue resource was created by the migration plan, not a guessed historical date.

The compiler does no filesystem, Git, ref search, lock, staging, receipt, or state-transition work. It does not receive mapping paths, legacy source paths, aliases, `sourceChange`, repositories, or cwd. The layout planner resolves those concerns and passes canonical nodes. This is an in-process deep module; no adapter is justified.

Normal `StoreIssues.publishPlan` is not called during migration because its live mutation contract allocates the next ordinal, takes an Issue lock, writes immediately, and verifies references against already committed refs that cannot yet contain same-migration project outputs. Its public interface stays unchanged.

Locking belongs to the layout publication seam, not to this compiler. Publication uses the same internal Issue-lock abstraction as normal `create`, `setState`, and `publishPlan`; the compiler neither knows that a lock exists nor receives a coordination root. This preserves one serializer and one mutex for the live Issue address without turning the migration compiler into a mutation API.

**Alternatives rejected:** a public `importLegacy` method would permanently expose compatibility vocabulary; duplicating serializers in layout migration would create two Issue schemas; calling CLI or normal mutation methods would split the transaction and fail same-migration references.

### 4. Plan v1 stays byte-identical; plan v2 is selected only for v2-only materialization

The machine-local immutable plan becomes a strict version-dispatched union rather than advancing every plan globally. Mapping version 1, an invocation with no mapping, and every other existing planning path that needs no v2-only materialization continue to emit the current schema version 1 canonical body byte-for-byte. The field set, omission rules, ordering, canonical JSON bytes, and resulting `planId` remain identical for the same clock and inputs. Installing the new reader or planning an old Store cannot change a v1 token.

Schema version 2 is emitted if and only if a version 2 mapping causes the resolved plan to require an explicit materialization/disposition that schema version 1 cannot encode. Its source inventory items retain their existing semantic kinds (`change`, `archive-entry`, `spec`, and so on), evidence, source path, recursive digest, state, and repair. A resolved item's materialization is explicit:

```text
copy-tree
  destination, owner/target line where applicable

generated-tree
  role = store-issue
  destination root
  issue id/state summary
  exact generated files and digests

retain
  source is its destination
```

This separates what the legacy source *was* from how the new Store materializes it. A coordinator stays a source `change` or `archive-entry` for retirement and provenance, but its materialization is generated rather than copied. Generated content is frozen in the stored plan so apply never recompiles, rereads a plan input for policy, or observes a different timestamp. A v2 `planId` is the digest of only the v2 canonical body; it is not an upgrade, alias, or re-hash of a v1 plan.

Stored-plan readers and apply/recovery loaders dispatch strictly on `schemaVersion`. Version 1 is parsed and applied through the existing v1 contract; version 2 is parsed and applied through the materialization-aware contract. Unknown versions, missing versions, or a body whose fields do not belong to its declared version are refused. Readers do not infer a version from fields, normalize v1 into v2 before checking its id, or accept a token whose id does not equal the digest of that version's canonical body.

Destination checks operate on the generated Issue root. Duplicate Issue ids, case-fold-equivalent ids, collisions between two conversion items, existing Issue roots, and aliases that canonicalize to the same location block the entire plan. The retirement set still contains the exact legacy source path, never the generated root.

**Alternatives rejected:** globally advancing every plan would invalidate stored v1 tokens and violate content-address stability; overloading `destination` while assuming every item is copied would risk copying the coordinator tree; a separate Issue-import plan would lose one plan id and rollback boundary; a generic output plugin/registry would add extension machinery with one consumer.

### 5. Stage generated Issue trees as atomic roots inside the existing recovery transaction

Staging dispatches on materialization:

- `copy-tree` retains current copy, Change identity injection, and digest verification.
- `generated-tree` creates its issue root in staging and writes only the files enumerated by the plan.
- `retain` performs no staged write.

Verification reparses generated `issue.yaml` at its final logical path, reparses `0001.yaml` with digest verification when present, checks the issue id/directory invariant, rechecks the exact file inventory and digests, and applies the existing containment and strict UTF-8 rules. No generated file can be discovered by glob; every role and filename comes from the compiled plan's explicit file list.

Publication adds one staged-entry role, `issue-tree`, to the existing order:

```text
project catalog upgrades
target-line catalogs
copied project/spec/archive outputs
generated Issue roots
receipt
layoutVersion: 2 flip (last)
```

The existing implementations constrain the cross-module lock order. A normal Issue mutation resolves its checkout read-only, then takes only the existing `issue` key; `STORE_LOCK_ORDER` already places `issue` before scope, workspace, Change, and integration keys. Layout migration currently takes a separate owner-aware Store/ref migration-run lock and takes none of those workspace semantic keys. The combined publication order is therefore fixed as:

```text
all generated Issue keys in ascending canonical byte order
Store/ref migration-run lock
publication writes
```

Apply first strictly loads the frozen plan without writing, extracts every `generated-tree` Issue id, validates it with the normal Issue-id parser, constructs the existing `(storeUid, issueId)` semantic keys in the same effective machine coordination root, deduplicates equal canonical key bytes, and sorts by unsigned lexicographic comparison of the canonical `issue-lock/v1` key bytes. One layout-publication wrapper structurally nests the migration-run helper inside the Issue-batch helper and asserts that a generated plan cannot enter its run-locked callback without the expected batch held. It never takes an Issue key while holding the migration-run lock, and the migration path takes no scope/workspace/Change/integration key while holding the batch. A plan with no generated Issue has an empty batch and keeps the existing migration-run-only behavior.

Batch acquisition is all-or-release: if key N cannot be acquired, keys 1 through N-1 are released in reverse order before the error escapes. Callback success, callback failure, failed-manifest writing, and rollback also release all acquired handles in reverse order from `finally`; the inner migration-run lock is released before the outer Issue batch. The Issue lock module remains the sole owner of issue-key path derivation, owner-aware acquisition, holder diagnostics, stale-owner policy, held-lock context, and release. No layout-local lock-file implementation is permitted.

The batch is held before `revalidatePlan` performs the first generated-destination precondition check and remains held across prepared-operation persistence, generated-root rename, digest verification, completion marking, receipt publication, the layout flip, staging cleanup, and the final durable `published` manifest update. A failed apply writes its durable failure state before releasing. Resume reloads the same plan, derives the same batch, and reacquires batch-before-run before reconciliation. Rollback that may remove a generated root does the same and persists its rolled-back manifest state before release. Retirement does not write a generated Issue and therefore does not need the Issue batch.

This makes ordinary mutations deterministic at either side of the boundary. A mutation that acquired an Issue key first completes or refuses before migration proceeds; migration then revalidates and refuses any newly existing or changed destination. A mutation that arrives after the migration batch waits within the existing bounded lock policy and writes no Issue byte while publication is in flight. After successful flip, final manifest persistence, and release, a queued `create` sees the canonical Issue and refuses `issue_already_exists`, while queued state or plan publication reads and mutates the canonical live tree through its normal contract. Receipt bytes remain historical migration evidence; the exact generated bytes and digests are proven before release, and only a later successful live mutation may change its permitted resource.

Canonical batch order prevents two migrations on different refs or with overlapping Issue sets from taking the same keys in opposite orders. Migrations on the same Store/ref additionally serialize on the run lock; migrations on different refs may hold distinct run locks but still agree on every shared Issue key. Ordinary commands take one Issue key and never request the migration-run lock, so they cannot close a cycle.

Every destination rename, including a generated Issue root and the receipt, uses a durable two-step recovery operation. Before rename, publication verifies the destination precondition and persists a `prepared` operation containing the migration run identity, operation id, canonical destination, staged/source identity, expected recursive digest, and expected absence. Only after that durable write may rename run. After rename, publication verifies the destination digest and persists the operation as `published`/completed before beginning another operation. Catalog or metadata replacement keeps its existing exact preimage rule, but the preimage is likewise durable before the overwrite.

Process restart reconciles each prepared operation instead of trusting path existence:

- staged present and destination absent means rename has not happened and may be retried;
- staged absent and destination present with the exact expected digest means rename happened for this prepared run and may be marked completed;
- a completed operation is skipped only when the destination still has its planned digest;
- both paths present, a missing recovery identity, an unrecorded destination, or any digest mismatch is an explicit recovery blocker.

The durable prepared operation is the proof that closes the crash window between rename and completion marking. A matching pathname alone is never run ownership. Resume preserves the manifest and continues only after reconciliation under the reacquired Issue batch and migration-run lock. Rollback may remove a completed destination, or a destination proven to be the after-rename result of this run's prepared operation, only while its digest still matches and the same locks are held. Unknown, unrecorded, or mismatched content is never removed; recovery reports it for human action. Retirement continues to be a separate, idempotent phase and removes coordinator source paths only from the plan's explicit retirement set. After retirement, Git remains the recovery path.

**Alternatives rejected:** taking the migration-run lock before Issue keys would reach backward across the existing Issue-first order and permit a future cycle; checking only the destination precondition leaves ordinary state/plan writes free to alter a renamed tree before flip; a layout-local Issue lock would create two mutex truths; recording a path only after rename leaves a process-death window with no durable ownership proof; recording only a pathname lets rollback delete foreign content; publishing Issue files individually could expose a record without its planned revision; retiring during publication would destroy the old readable state before the linearization point.

### 6. Coordinator sources with non-Git bytes are never convertible

The current `--include-untracked` acknowledgement is valid for copied trees because those bytes move into the new partition. It is invalid for a generated Issue: source bytes are intentionally not copied, so any untracked or ignored entry would disappear at retirement and cannot be recovered from the source HEAD.

Planning therefore enumerates untracked and ignored entries below every `generated-tree` source, including files, directories, symlinks, junctions, and platform alias spellings. Any entry is an unconditional blocker even with `--include-untracked`. Tracked modifications and staged differences remain the existing dirty-source blockers. Tracked source bytes are bound by recursive digest, source HEAD, and relative path and remain in place until retirement.

The check uses native `path` operations and existing canonicalization/containment helpers. Receipt paths remain Store-relative POSIX strings for portability; filesystem operations remain native. Reparse points are inspected without traversing outside the Store, and two spellings that identify one path are one candidate, not two sources.

**Alternatives rejected:** embedding the legacy tree in receipt or Issue content would create a second archive and leak domain data; allowing the override would knowingly lose bytes; copying miscellaneous files into README would make narrative an unvalidated planning truth.

### 7. Receipt v2 is typed historical evidence with explicit repository roles

Receipt schema v2 preserves the existing plan/store/ref/item/catalog/phase account and adds typed conversion evidence. The ambiguous top-level source commit becomes an explicit source revision:

```json
{
  "repositoryKind": "store",
  "role": "planning-source",
  "storeUid": "...",
  "ref": "refs/heads/main",
  "headOid": "..."
}
```

Each converted item records:

- source lifecycle (`active-change` or `archive-entry`), old alias, Store-relative source path, and recursive digest;
- `store-issue` classification and operator-assertion evidence;
- Issue id, state, reason, and state nature (`migration-default-open` or `operator-asserted`);
- `acceptanceEvidence: unproven` for every terminal import;
- generated output roles, paths, schemas, and digests;
- optional plan-input path and digest;
- any same-migration alias-to-instance compilation as historical evidence, while the generated node remains canonical.

There is no member code commit because this migration neither reads nor advances one. Existing `changeInstances` continue to record planning identities, not code delivery. The source Store HEAD is never copied into a `codeCommit`-shaped field.

Receipt parsing becomes one strict version-dispatching reader in the layout-migration domain. Version 1 remains readable with its exact interpretation and is never upgraded in place. Version 2 readers expose conversion evidence to diagnostics and the archive compatibility query. Unreadable receipts prove nothing and are reported as incomplete evidence; they are not silently selected.

Receipt state is not live Issue authority. Issue queries and mutations continue to read `issue.yaml` and plan revisions only. The receipt is append-only except for the existing idempotent phase stamping performed by publication and retirement.

**Alternatives rejected:** adding conversion fields to schema v1 would make old and new receipts indistinguishable; treating receipt state as a fallback would create two lifecycle truths; recording Store HEAD in `codeCommit` would falsify member delivery provenance.

### 8. Archive compatibility is an ordinary direct-selector planning refusal with fixed precedence

The compatibility query is reachable only from the ordinary `rasen archive <legacy-alias>` direct-selector planning route. Token-owned `--apply-plan` and `--abort-plan` are dispatched before root resolution, Change lookup, or receipt access exactly as today. A token route combined with a change name or planning options therefore fails with `archive_option_conflict`; it never consults conversion evidence. Other command-shape conflicts that are already decided before planning, such as invalid `--save-plan` use, retain the same precedence.

On the ordinary direct-selector route, after Store scope resolution, the command checks whether the exact active Change source exists. A real Change wins and continues through the current Store v2 outcome contract, including `finalization_outcome_required` when no outcome was declared. When the exact active source is absent, the command may perform the read-only receipt query before interpreting finalization outcome semantics. A unique current-Store/current-ref v2 `active-change` conversion returns `legacy_coordinator_became_issue` even when `--outcome` is absent; this is the one deliberate precedence change needed to make the compatibility refusal reachable. Supplied finalization options are reported as not forwarded and execute nothing.

If no unique conversion is proven, the existing outcome and ordinary unresolved/error ordering resumes; the helper does not turn missing evidence into Issue resolution. Interactive selection, `--intent-template`, archived-source aliases, version 1 receipts, other Store/ref receipts, and invalid/unreadable/ambiguous evidence do not use the compatibility result.

A unique match returns the Issue id and existing show command. Human and JSON render the same structured diagnostic. Human output may list `store issue state` as a separate operator action, but the invocation executes nothing and never claims acceptance.

**Alternatives rejected:** redirecting to Issue state would turn archive flags into acceptance; a durable alias index would duplicate receipt evidence and require lifecycle cleanup; checking receipts before real Change lookup would let history shadow a valid current Change.

### 9. CLI surface stays on existing commands

No `issue import-legacy` or coordinator command is added. Operators use:

1. `rasen store migrate-layout <store-id> --mapping <path>` to preview.
2. The same command with `--apply` to publish the complete v2 state.
3. Existing status/resume/rollback and `--retire-flat` phases.
4. Existing `rasen store issue show`, `plan`, and `state` after publication.

Mapping and plan-input diagnostics are included in the migration plan's human/JSON outputs. A missing plan is applicable and carries the informational continuation `no plan supplied; no nodes invented`; invalid or unsafe input is a blocker. Existing doctor composition does not need a new capability: layout health remains in `store-layout-v2-migration` and both doctor surfaces continue to consume the same diagnosis.

**Alternatives rejected:** a second import command creates a partial state between Change relocation and Issue creation, cannot safely reference identities minted by the first transaction, and needs independent rollback and receipts.

### 10. Direction Alignment / version boundary

The upper Issue-centered automation Direction places complete Issue/Execution Plan/Dispatch work after the 0.2.0 ECP closure, in the 0.3.0 Phase 0–8 roadmap. This Change is a narrowly scoped 0.1.7 storage/import bridge made possible by the already shipped minimal Store Issue resources. It does not claim that the future Issue platform is implemented.

Alignment is explicit:

- **Issue is repo-blind intent:** `issue.yaml` receives only the current minimal record. Repository, project, target line, Change, DAG, cwd, commit, Pipeline, and legacy content stay out.
- **Execution Plan owns execution structure:** project, target line, Change references, intents, and dependencies exist only in optional plan input and the canonical revision.
- **Each Change has one primary project:** a referenced same-migration Change is first resolved as `project-change`; Issue compilation writes no back-reference or second owner.
- **Store is planning root, not execution root:** every write is Store planning content. Member repositories and Session cwd are untouched.
- **cwd and commits are evidence, never ownership truth:** classification uses the existing evidence reducer and explicit mapping. Store source HEAD is labeled provenance, not a code owner or code delivery commit.
- **Pipeline belongs to Change:** no Issue declaration, record, plan compatibility field, or receipt conversion owns a Pipeline.
- **Issue Done is not Change archive:** active imports remain open. Archive imports require an explicit state; terminal state is marked asserted with acceptance unproven.
- **One concept, one truth:** normal Issue validators and serializers produce the only live resources; receipt and mapping are historical migration evidence, not another Issue runtime.

The current IssueRecordV1 is intentionally smaller than the future model: it has no acceptance criteria/result, Dispatch decision, derived phase/health/progress, Delivery, Comment, or Board projection. A terminal import can preserve an operator's historical declaration, but this Change cannot prove or synthesize those missing artifacts. Future consumers must continue to see `acceptanceEvidence: unproven` rather than interpreting migration as a completed 0.3.0 journey.

The compatibility bridge has an exit plan:

- **Owner:** Store layout migration; archive owns only its exact not-found diagnostic.
- **Callers:** `store migrate-layout` for flat refs and `archive` after a missing real Change.
- **Runtime leakage:** none; `sourceChange` compiles away, and public Issue schemas/interfaces remain unchanged.
- **Removal gate:** when the oldest supported Store layout no longer requires flat-to-v2 migration and product support no longer offers this mapping workflow, remove v2 coordinator input, its compiler entry, and the archive compatibility diagnostic together. Retain typed historical receipt readers as long as committed receipts remain supported evidence.

## Risks / Trade-offs

- **[Risk] An operator deliberately classifies implementation-bearing legacy work as an Issue.** → E1 identity forbids relabelling; plan preview shows the entire source disposition and digest; no legacy bytes are copied; retirement is separate and Git-recoverable.
- **[Risk] E2/E3 evidence and an explicit Issue choice appear inconsistent.** → Preserve both derived evidence and the explicit classification in the receipt; only E1 is binding, and no evidence is silently discarded.
- **[Risk] A plan input changes after preview or points outside the Store.** → Require tracked clean HEAD bytes, canonical containment, strict UTF-8, digest binding, and apply-time revalidation before any write.
- **[Risk] A same-migration selector binds the wrong Change.** → Require exact active source alias, explicit matching project and target line, one planned canonical identity, and remove the selector before serialization.
- **[Risk] A normal Issue mutation changes a generated root after its precondition check but before the layout flip.** → Derive the complete canonical Issue-key batch from the frozen plan, acquire it before the Store/ref migration-run lock and before revalidation, hold it through receipt/flip/final manifest persistence, and make apply/resume/rollback release in reverse order from `finally`.
- **[Risk] The process dies after rename but before the manifest completion mark.** → Persist a run-identified prepared operation before rename, reconcile staged/destination state and digest after restart, and never delete content whose prepared identity and planned digest do not both match.
- **[Risk] Ignored files are missed and retirement loses bytes.** → Run an explicit tracked/untracked/ignored census without following reparse points; any non-Git entry below a generated-tree source blocks even under `--include-untracked`.
- **[Risk] Receipt becomes a second live Issue store.** → Keep Issue modules receipt-blind; expose conversion evidence only to migration diagnostics and the narrow archive not-found query.
- **[Risk] Store HEAD is mistaken for member delivery.** → Use `repositoryKind: store` and `role: planning-source`; never emit a member-code field from migration evidence.
- **[Risk] Case folding, long paths, non-ASCII names, symlinks, or junctions produce collisions or escapes.** → Use existing planning-layout addresses, native `path` operations, canonical containment, explicit file inventories, Store-relative receipt paths, and win32/posix/platform integration coverage.
- **[Trade-off] Archived coordinators can import terminal without future acceptance artifacts.** → Require an operator reason and label acceptance unproven; this preserves current 0.1.7 state without claiming future Direction completion.
- **[Trade-off] No plan input leaves an Issue without an execution graph.** → This is more honest than parsing legacy planning content; emit the existing plan command as an actionable continuation.

## Migration Plan

1. Pin mapping v1 and receipt v1 behavior with characterization tests, then add strict v2 schemas and normalized dispositions.
2. Add the tracked clean plan-input loader and whole-plan `sourceChange` resolution, producing only canonical node inputs.
3. Add the pure Issue-domain compiler using existing validators, graph rules, digests, and serializers.
4. Add a strict plan-schema union: keep every existing path on byte-identical schema v1 and emit schema v2 only for mapping-v2 plans requiring explicit materialization; add strict version-dispatched plan and receipt reads.
5. Extend the existing Issue-lock abstraction with canonical batch acquisition, then acquire the complete generated-Issue batch before the Store/ref migration-run lock and hold it through staging revalidation, publication, receipt, layout flip, final manifest persistence, resume, and rollback; keep the pure compiler lock-free and preserve the layout flip.
6. Add the narrow ordinary direct-selector archive query after token-route conflicts and real-source lookup, with explicit `archive_option_conflict` / `legacy_coordinator_became_issue` / `finalization_outcome_required` precedence.
7. Exercise the real scene-bridge legacy shape as a fixture: active `time-qualified-preview-render-job-and-reference-video`, plus archived `2026-08-01-core-project-and-scene-lifecycle`, `2026-08-01-protocol-spine-and-live-cube`, and `2026-08-03-named-camera-shot-camera-path-and-timeline`, each explicitly classified.
8. Run the complete migration journey: committed mapping/plan inputs, dry run, apply, existing Issue reads, resume/rollback fault cases, publication commit suggestion, retirement, Git source recovery, archive alias diagnostic, and v1 compatibility.

Operator rollback remains unchanged: before retirement, use the recorded migration rollback; after retirement, recover the legacy source from the Store source HEAD and path recorded in receipt and verify its recursive digest. No step checks out, commits, merges, fetches, pushes, or mutates a member repository.

## Open Questions

None. The version boundary, mapping classification, state rules, migration-only selector, Issue compiler seam, Issue-batch-before-migration-run lock order, transaction ownership, provenance roles, and archive compatibility behavior are fixed by this design.
