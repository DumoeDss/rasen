## Context

`store-planning-scope-routing` established one scope seam and made three states explicit: standalone planning, legacy flat Store planning (read-only, `legacy_flat_store_requires_migration`), and Store v2 project planning. It deliberately wrote no layout upgrade and no Store content mutation, so today every Store is in a dead end:

- a flat Store refuses `new`, `apply`, and `archive`, and has no path to layout v2;
- a Store that declares `layoutVersion: 2` has no project catalogs, no target-line catalogs, and no partitions, because nothing creates them;
- `src/core/store/migration-ops.ts` still moves adopted specs and Changes into `specsDir(storeRoot)` and `changesDir(storeRoot)`, i.e. the flat `rasen/specs` and `rasen/changes` directories that layout v2 forbids as project addresses;
- `src/core/store/project-records.ts` writes `.rasen-store/projects/<projectId>.yaml` as a strict `version: 1` record carrying an `adoption` name list, while `src/core/store/planning-catalogs.ts` parses the *same path* as a strict `version: 2` project catalog carrying `planningBinding` and no adoption. The two schemas are mutually exclusive and nothing dispatches between them.

The content that must move was written by a layout that never recorded which project owned it. A flat `rasen/changes/fix-a` names no project; a flat `rasen/specs/session-relay` may have been shaped by Changes from several projects; a flat `rasen/changes/archive/2026-01-02-fix-a` names neither project nor target line. `elftia-store` is the concrete case: it has three member projects, and only the entries whose adoption evidence explicitly says `elftia` may be migrated automatically.

Two things follow, and they set the whole shape of this design. First, ownership is a *conclusion drawn from evidence*, so the Module has to model evidence, disagreement, and absence as first-class states rather than resolving them into a best guess. Second, some facts layout v2 needs simply do not exist in the old data — a Change's target line, an Archive entry's outcome, a workspace pair — so the Module must be able to say "this cannot be derived" and stop, and must never manufacture the fact to make its own output well-formed.

This is the third slice in a serial portfolio. It consumes child 1's layout/catalog/identity contracts and child 2's scope seam. It does not own worktree pairing, finalization outcomes, Archive v2 record production, Store Issue aggregation, or the portfolio-wide caller sweep.

## Goals / Non-Goals

**Goals:**

- Give a flat Store exactly one explicit, previewable, resumable route to layout v2, per Git ref.
- Decide project ownership only from auditable evidence with a fixed precedence, and fail closed on absence, contradiction, and shared ownership.
- Make new `adopt`/`eject` writes land in project partitions and make flat Store planning writes structurally unreachable in a v2 Store.
- Guarantee no-clobber in both directions: migration never overwrites existing content, and a failed or rolled-back migration never removes content it did not create.
- Keep every migration decision auditable after the fact through a committed receipt that carries the evidence, the dropped legacy data, and the alias-to-instance mapping.
- Diagnose flat refs, half-migrated Stores, and unresolved ownership read-only, without repairing anything.
- Preserve legacy Archive entries byte-for-byte and never synthesize an Archive v2 record, outcome, or workspace pair for them.

**Non-Goals:**

- Creating, pairing, locking, or deleting Store or execution Git worktrees; resolving target-line refs beyond validating what the mapping declares.
- Producing Archive v2 records, finalization outcomes, reachability proofs, or spec sync. `store_v2_finalization_unavailable` stays closed.
- Store Issue / Execution Plan resources, cross-project query indexes, or management/UI aggregation.
- Migrating any ref that is not checked out in the invoking Store worktree, or performing any Git mutation (checkout, merge, rebase, branch delete, stage, commit, fetch, push).
- Long-term dual-read or dual-write compatibility, automatic layout upgrade on read, or a `--force` escape from the resolution gates.
- Rewriting Store Git history to correct a manually-merged wrong layout; that stays a reported diagnostic.

## Decisions

### 1. One deep `StoreLayoutMigrationModule` with `inventory` / `plan` / `apply`

```ts
interface StoreLayoutMigrationModule {
  inventory(input: InventoryInput): Promise<FlatStoreInventory>;
  plan(input: MigrationPlanInput): Promise<ImmutableMigrationPlan>;
  apply(token: MigrationPlanToken): Promise<MigrationResult>;
  status(input: MigrationStatusInput): Promise<MigrationRunStatus>;
  recover(input: MigrationRecoveryInput): Promise<MigrationResult>;
}

interface InventoryInput {
  readonly storeSelector: string;
  readonly startPath: string;
  readonly globalDataDir?: string;
  readonly pathFlavor?: PlanningPathFlavor;
}

interface MigrationPlanInput extends InventoryInput {
  readonly mappingPath?: string;
  readonly defaultTargetLine?: string;
  readonly includeUntracked?: boolean;
}
```

`inventory` is read-only and total: it never stops at the first problem, because the operator needs the whole picture to write one mapping file. `plan` turns an inventory plus a mapping into an immutable, content-addressed plan that either resolves every item or reports why it cannot. `apply` consumes only a plan token; it re-reads nothing from the current directory, the current branch, or the selector that produced the plan.

The Module hides: ref enumeration and blob reads, the evidence reducer and its precedence, the spec provenance graph, layout/catalog/identity contract calls, staging and digest verification, the ordered publication sequence, recovery-manifest bookkeeping, and receipt serialization. Callers see semantic items, states, and reasons.

Alternative considered: extend `migrateStoreMembership` in `migration-ops.ts` with a layout flag. Rejected — that function is a one-shot record converter with no plan, no staging, and no recovery, and layering a whole-tree relocation onto it would make the flat-layout algorithm and the v2 algorithm live in one body, which is exactly the dual-implementation shape invariant 9 forbids.

### 2. Inventory is per Git ref, and migration only ever touches the checked-out ref

A Store's unmerged planning state lives on several refs, so "this Store is migrated" is not a single fact. Inventory has two levels:

1. **Ref survey.** Enumerate local Store refs and linked worktrees through the read-only Git adapter, read `.rasen-store/store.yaml` at each ref as a blob (`git show <ref>:...`), and classify the ref as `layout-v2`, `flat`, `no-store-metadata`, or `unreadable`. Remote-tracking refs are surveyed and reported but never migration candidates. Nothing is checked out.
2. **Working-tree inventory.** For the ref checked out in the invoking Store worktree, enumerate flat `rasen/specs/<capability>`, `rasen/changes/<changeId>`, `rasen/changes/archive/<entry>`, `rasen/design-docs/<doc>`, plus `.rasen-store/store.yaml`, `.rasen-store/projects/*.yaml`, and `.rasen-store/adoptions.yaml`.

`plan` and `apply` operate only on the checked-out ref. Every other flat ref is reported with the exact command that migrates it, run from a worktree on that ref. This is a fail-closed choice rather than a convenience gap: writing into another ref's tree would require a checkout or an index write, and the design forbids Rasen from doing Git mutation on the user's behalf.

The ref survey result, the working-tree inventory, and a digest of everything read form the **inventory fingerprint**, which is embedded in the plan.

### 3. Ownership is evidence with fixed precedence, and disagreement is a state

Evidence classes, strongest first:

| Class | Source | Applies to |
| --- | --- | --- |
| `E1` recorded-identity | `identity.projectId` in a Change's `.openspec.yaml`; `projectId` in an Archive v2 `archive.json` | Changes, Archive entries |
| `E2` store-records | `.rasen-store/adoptions.yaml` entries and v1 membership record `adoption.specs` / `adoption.changes` name lists | Changes, specs, Archive entries by name |
| `E3` association | machine association / Session records naming a `changeId` and a project that is a member of this Store | Changes |
| `E4` explicit-mapping | the committed mapping file supplied with `--mapping` | every item class |

Resolution rules:

- **E1 is binding and is never overridden.** It is a fact the item carries about itself; E2 is a derived Store-level index. A lower-priority source that disagrees with E1 is recorded in the receipt as superseded evidence and surfaced as a diagnostic, but does not block: refusing to migrate because a stale `adoptions.yaml` disagrees with the Change's own recorded identity would make correct Stores unmigratable.
- **E2 and E3 disagreeing with each other is `evidence-conflict`** and blocks. Neither is self-describing about the item, so there is no principled winner.
- **E4 may resolve an item that is `unknown-owner`, `evidence-conflict`, or `shared-spec`, and may never contradict E1.** A mapping entry that contradicts E1 is itself an error (`mapping-contradicts-recorded-identity`), because the mapping file is an operator statement about unknowns, not a licence to relabel recorded history.
- **Nothing else is evidence.** Change-name prefixes, Git branch names, directory adjacency, sibling ordering, and "the only member project whose name looks similar" are explicitly excluded, and the exclusion is asserted by tests rather than only documented.
- Evidence naming a project that is not a member of this Store, or whose id fails v2 portable validation, is `non-member-owner` / `unrecordable-identity` and blocks. The id is never sanitized into a valid one.

### 4. Spec ownership comes from a provenance graph, and shared specs block

A flat canonical spec cannot be attributed from the Change that happens to sit next to it, because several archived Changes may have shaped the same capability. The Module builds a bipartite provenance graph:

- for each active Change `c`, every `changes/<c>/specs/<capability>/` directory is an edge `owner(c) -> capability`;
- for each Archive entry `a`, every `<a>/specs/<capability>/` directory is an edge `owner(a) -> capability`;
- `owner(...)` is the already-resolved ownership from decision 3, so a Change that is itself unresolved contributes an `unknown` contributor rather than silently dropping out of the graph.

Then, per capability:

| Contributors | Result |
| --- | --- |
| exactly one known project | assigned to that project, evidence `spec-provenance` |
| none | `unknown-owner` unless `E4` assigns it |
| any `unknown` contributor | `unknown-owner` — an unresolved Change must not be allowed to make a spec look single-owner |
| two or more distinct projects | `shared-spec` — blocks unless `E4` declares a resolution |

`E4` may resolve a shared spec in exactly two ways, both explicit:

- `owner: <projectId>` — the capability moves into that project's partition, and every other contributing project is recorded in the receipt as a historical contributor. That record is an audit fact and a diagnostic, **not** a runtime read path: layout v2 defines no Store-level canonical spec and no cross-project spec reference, so nothing resolves another project's spec at runtime.
- `split: [<projectId>, ...]` — the identical spec bytes are copied into each named project's partition, and the receipt records the split. Divergence afterwards is ordinary per-project evolution.

If neither is declared, migration stays blocked. This is the design's "先另行设计共享 contract" outcome, made operational: no anonymous shared spec is carried into layout v2, and nothing is invented to unblock it.

### 5. Store design docs are retained by default, reclassified only by explicit mapping

A flat `rasen/design-docs/<doc>.md` carries no attributable evidence at all — it is prose. Layout v2 narrows the Store-level directory to genuinely cross-project design, but there is no way to prove which documents those are.

Retention is the only action that invents nothing and clobbers nothing, so every Store-level design doc stays where it is by default. The plan lists each retained document explicitly so retention is a visible decision rather than an omission, the mapping file may assign any document to a project (`designDocs: { <name>: <projectId> }`), and doctor reports the retained set as an informational finding so the classification debt stays visible. This resolves a genuine silence in the accepted design, which states the target layout for design docs without specifying an evidence rule.

### 6. Target lines, Change identity, and Archive facts: declare, mint, or refuse

Layout v2 needs three things the old layout never stored. They are treated differently on purpose:

- **Target line — declared.** `PlanningScopeId` needs one, and Archive partitions are keyed by one. No legacy artifact records it. The mapping file therefore declares `defaultTargetLine` and optional per-item overrides, and the plan records the declaration as an operator **assertion**, labelled as such in the receipt, never as derived evidence. An item with no declared target line is `missing-target-line` and blocks.
- **Target-line catalogs — created from the mapping only.** Nothing in the portfolio creates `.rasen-store/target-lines/<id>.yaml` before child 4, so a migrated Store would be unusable without them. The mapping file's `targetLines:` section supplies each line's `storeRef` and per-project `codeRef`; migration validates them through the Foundation contract and writes the catalogs as a plan output. An already-present catalog must match byte-for-byte or the item is `catalog-conflict`. Migration provides no other target-line management; ref resolution and binding remain child 4's.
- **Change identity — minted, and recorded.** For a relocated active Change with a declared target line and a Store that has a permanent UID, migration mints one `instanceSeed`, derives `PlanningScopeId` and `ChangeInstanceId`, verifies the derivation, and writes the v2 `identity:` block. The receipt records `changeId -> changeInstanceId` plus the old association alias, exactly as the accepted design requires. A Store without a permanent UID blocks with the `store upgrade-identity` repair; a Change that already carries a v2 identity is verified, never re-minted.
- **Archive outcome / workspace pair — refused.** Legacy Archive entries are relocated **byte-for-byte under their existing directory names**, into `rasen/projects/<projectId>/changes/archive/<declaredTargetLine>/`. Their `archive.json` is not upgraded, not rewritten, and not wrapped: an Archive v2 record requires an outcome, reachability, a verified `ChangeInstanceId`, and a verified `WorkspacePairId`, none of which legacy evidence can prove, and the v2 entry-name form `YYYY-MM-DD-<changeId>--<instanceShort>` would bake an invented instance identity into a historical directory name. The receipt records each relocated entry as `recordSchema: legacy`, and doctor reports legacy-schema entries inside a v2 Store so a future finalization slice can decide what, if anything, to do with them.

### 7. Item state taxonomy, and one gate with no override

Every inventoried item carries exactly one state:

| State | Meaning |
| --- | --- |
| `resolved` | owner determined, destination computed, no-clobber precondition satisfied |
| `unresolved:unknown-owner` | no evidence in any class |
| `unresolved:evidence-conflict` | `E2` and `E3` disagree |
| `unresolved:shared-spec` | two or more contributing projects and no declared resolution |
| `unresolved:non-member-owner` | evidence names a project with no membership in this Store |
| `unresolved:unrecordable-identity` | the named project id fails v2 portable validation |
| `unresolved:missing-target-line` | no declared target line for an item that needs one |
| `blocked:destination-exists` | the computed destination already exists |
| `blocked:mixed-layout` | the ref declares `layoutVersion: 2` and still holds flat planning content with no matching receipt |
| `blocked:store-identity-missing` | the Store has no permanent UID, so no v2 identity can be derived |
| `blocked:unrecordable-catalog-field` | a v1 membership record's `id` or `remote` cannot satisfy the v2 catalog contract |
| `blocked:target-line-catalog-conflict` | the mapping's target-line declaration disagrees with an existing catalog |
| `blocked:dirty-source` | a plan source path has tracked modifications or staged changes |

`apply` refuses unless every item is `resolved` and no item is `blocked`. There is no `--force`, and there is no subset migration: a Store where half the content is partitioned and half is flat is precisely the dual-truth state the accepted design's invariant 9 forbids, and it is also the state that makes every later reader ambiguous. The escape hatch is the mapping file, which is explicit, reviewable, and committed.

`blocked:dirty-source` deliberately differs from `adopt`'s existing "warn about uncommitted paths": migration relocates a whole tree, and the only cheap recovery for a bad outcome is Git. Tracked modifications and staged changes block. Untracked files inside a moved tree are reported with their count and paths and require `--include-untracked`, because they will move with the tree and Git cannot restore them.

### 8. Immutable plan, content-addressed token, revalidation at apply

The plan is a pure value: ordered item list, per-item source path, destination path, owner, evidence chain, digests, plus the catalog upgrades, target-line catalogs, receipt content, and the retirement set. `planId = sha256(canonicalBytes(plan))` reuses the existing canonical serialization, and `MigrationPlanToken` carries `{ planId, storeUid, ref, headOid, inventoryFingerprint }`.

Plans and recovery manifests are **coordination state and live in the machine root**, keyed by `storeUid` and ref — never inside either Git repository. Writing them into the Store would make an in-flight, machine-local plan look like committed planning truth and would be shared to other machines by a routine commit. This matches the file-placement class rules, where cross-run arbitration state is machine-owned.

`apply` revalidates before its first write and aborts with `migration_plan_stale` on any mismatch:

- Store metadata text and declared layout version;
- Store worktree `HEAD` OID and the ref name;
- the digest of every source path in the plan;
- the non-existence of every destination path;
- the digest of the mapping file, if one was supplied;
- the membership/catalog file text for every catalog upgrade.

A stale plan is invalidated, not repaired. Re-planning is cheap; silently re-resolving to a different destination set is not.

### 9. Staging, ordered publication, separate retirement, recovery manifest

```text
stage    -> verify -> publish (rename + layout flip) -> [user commit] -> retire flat -> [user commit]
```

1. **Stage.** Build the complete destination tree under `<StoreRoot>/.rasen/migration/staging/<planId>/`, inside the Store worktree so every later rename is same-volume and therefore atomic; `.rasen/` is machine-local and ignored. Sources are **copied, not moved**, so the flat tree stays complete and readable through the entire staging phase.
2. **Verify.** Digest-compare every staged file against its source; strict-UTF-8 decode every text file and reject BOM/replacement-character damage; validate every produced project catalog, target-line catalog, and Change metadata file through the Foundation contracts; re-derive and verify every minted identity; assert containment of every destination.
3. **Publish.** Write the recovery manifest first, then rename staged trees into their destinations in a fixed order (project catalogs, target-line catalogs, project partitions, receipt), then write `.rasen-store/store.yaml` with `layoutVersion: 2` **last**. The layout flip is the single linearization point: before it every reader sees a legacy flat Store and reads the intact flat tree; after it every reader sees layout v2 and reads complete partitions.
4. **Retire.** Removing the flat tree is a separate step (`--retire-flat`) so it lands in its own commit, as the accepted design requires. It is idempotent, resumable, and refuses to run unless the receipt for this ref records a completed publication.

`recover` reads the machine-root manifest and offers:

- `--resume` — idempotent continuation from the recorded phase;
- `--rollback` — remove only paths the manifest proves this run created, restore the previous `store.yaml` bytes, and delete staging. Rollback is available while the flat sources still exist, i.e. before retirement. After retirement the recovery path is Git, and the command says so instead of pretending otherwise.

Both directions are no-clobber: publication never overwrites an existing destination, and rollback never deletes a path it did not record creating.

### 10. Membership records upgrade into project catalogs; provenance moves to a receipt

`.rasen-store/projects/<projectId>.yaml` is a v1 record in a flat Store and a v2 catalog in a layout v2 Store. Readers dispatch on the Store's declared layout version rather than sniffing the file, so a half-written file can never be read as the other schema. Migration is the only writer that flips it.

| v1 field | v2 catalog |
| --- | --- |
| `projectId`, `id`, `remote`, `knowledgeBundle` | carried over; a value that fails the stricter v2 validators blocks with `unrecordable-catalog-field` |
| `roles` | carried over unchanged |
| `adoption` present | `planningBinding: { state: bound, boundAt }`, `boundAt` = canonicalized `adoptedAt` |
| `adoption` absent | `planningBinding: { state: unbound }` unless the project's own config proves a pointer-without-local-planning binding |
| `adoption.specs` / `adoption.changes` | dropped from the catalog; preserved verbatim in the receipt and used as `E2` evidence |

Membership alone never produces `bound`. The v2 contract already rejects `bound` without `roles.planning`, and this rule adds the converse discipline: binding is a claim that planning truth moved, and only adoption evidence proves it.

The committed **migration receipt** at `.rasen-store/migration/receipts/<planId>.json` carries the schema version, store UID, ref, plan id, timestamps, per-item source/destination/owner/evidence, the minted `changeId -> changeInstanceId` and old-alias mappings, the dropped adoption lists, the legacy `adoptions.yaml` content, relocated legacy Archive entries with `recordSchema: legacy`, shared-spec resolutions with their contributors, retained design docs, superseded-evidence findings, and the publication/retirement phases. It is a new committed artifact family; it is additive beside `.rasen-store/projects/` and `.rasen-store/target-lines/` and changes none of child 1's strict schemas.

### 11. Adopt and eject write and read project partitions

**Adopt** into a layout v2 Store:

1. Refuse when the Store's declared layout is not v2 (`legacy_flat_store_requires_migration`, naming `store migrate-layout`).
2. Resolve the project's permanent id and require it to satisfy the v2 portable-id contract.
3. Compute destinations through the Foundation layout: `rasen/projects/<projectId>/{specs,design-docs,changes}`, and `changes/archive/<targetLineId>/` for the archive, which requires an explicit `--target-line` naming an existing catalog.
4. Precheck collisions **inside that project's partition only**, case-insensitively. Two projects adopting a Change with the same alias is the point of partitioning and is no longer a collision.
5. Write the project catalog with `planningBinding: bound` **before any source deletion**, preserving the existing "manifest written before source deletion" resume guarantee with the v2 record. The bound catalog is the resume marker.
6. Copy → verify → delete as today; write an adopt receipt in the same family; stage, commit, and push nothing.

**Eject** from a layout v2 Store: the partition *is* the ownership record, so there is no name list to consult and no `--all` consent path — `--all` is rejected in a v2 Store with an explanation, and remains available for legacy flat Stores. Eject restores the partition into the repository's in-project layout, sets the catalog to `unbound` while keeping roles, and removes the partition. Archive line subdirectories are flattened into the repository's single archive directory **with a no-clobber check**: a name collision across two lines refuses with both source paths rather than overwriting, because the in-project layout has no line dimension and a nested line directory would be misread as an archive entry.

### 12. No-dual-write is enforced at three levels

- **Structural:** after retirement the flat directories do not exist, so there is nothing to write to.
- **Runtime:** one shared `assertStoreLayoutForWrite(storeRoot, intent)` precedes every Store planning mutation — adopt, eject, archive relocation, membership record writes, and the migration Module itself. A v2 Store refuses flat destinations; a flat Store refuses v2 destinations; a mixed state refuses both and points at recovery.
- **Compile/source:** a bounded source guard, in the shape child 2 introduced, rejects new joins of `rasen/specs`, `rasen/changes`, and `rasen/changes/archive` against a Store root outside the frozen legacy adapter and the migration Module's own source-side reader.

`archive relocate --to store` is the remaining flat-Store archive writer. In a v2 Store it requires `--target-line <id>` and a bound project, and lands in that project's stable target-line Archive directory; without a target line it fails closed rather than choosing one.

### 13. Diagnostics are read-only and name their repair

New stable codes, reported identically in human and JSON output by both `rasen doctor` and `rasen store doctor`:

| Code | Meaning |
| --- | --- |
| `store_layout_flat_requires_migration` | one or more local refs still carry flat planning content; lists every such ref |
| `store_layout_mixed_residue` | `layoutVersion: 2` with flat planning content still present |
| `store_layout_migration_incomplete` | a machine-root manifest records an unfinished or failed run for this Store and ref |
| `store_layout_unresolved_ownership` | a read-only inventory finds items with no or conflicting ownership evidence |
| `store_layout_shared_spec_unresolved` | a capability has contributors from several projects and no declared resolution |
| `store_layout_partition_orphan` | a partition with no project catalog, or a catalog marked `bound` with no partition |
| `store_layout_legacy_membership_record` | a v1 membership record inside a Store declaring layout v2 |
| `store_layout_legacy_archive_record` | a relocated Archive entry whose record is not Archive v2 (informational) |
| `store_layout_design_doc_unclassified` | Store-level design docs retained without classification (informational) |

Diagnosis re-runs inventory and provenance in a strictly read-only mode: no plan is written, no staging directory is created, no registry entry is touched, and no file under either repository or the machine data directory is modified. Because Git can bypass Rasen entirely, these checks are what catch a manually merged wrong layout, and they report rather than rewrite.

### 14. Dependencies stay behind the Module's own adapters

- **In-process:** Foundation layout/catalog/identity contracts, the evidence reducer, the provenance graph, plan construction, and diagnostic formatting. Composed directly; no adapter.
- **Local-substitutable:** filesystem and canonicalization, read-only Git (ref enumeration, blob reads, worktree list, status, HEAD OID), Store and project registries, association/session reads, the machine-root coordination store, clock, and entropy for seed minting. Production uses the existing implementations; tests use deterministic in-memory adapters, including a fixed clock and a seeded entropy source so plans are reproducible.
- **Consumer adapters:** the `store migrate-layout` Commander surface and the doctor reporters. They format; they hold no resolution logic.
- **Remote:** none. Migration never clones, fetches, pushes, or contacts a network.

## Risks / Trade-offs

- [Risk] The gates make a messy real Store unmigratable without operator work. → That is the intended trade: the alternative is silently reassigning one project's planning history. Inventory is total and previewable so the operator writes one mapping file once, and the plan names every unresolved item with its reason and the mapping key that would resolve it.
- [Risk] The mapping file becomes a way to launder guesses into "evidence". → It is recorded as an operator assertion, never as derived evidence; it may never contradict `E1`; it is committed inside the Store; and its digest is bound into the plan token and the receipt.
- [Risk] Retaining Store-level design docs leaves classification debt. → The plan lists every retained document, the receipt records the retention, and a standing informational diagnostic keeps it visible instead of silent.
- [Risk] Relocating legacy Archive entries verbatim leaves two record schemas in one Archive directory. → Preferable to fabricating outcome, reachability, and workspace-pair facts. The receipt labels them and a diagnostic reports them; upgrading them, if ever, belongs to the finalization owner.
- [Risk] The window between publication and retirement has both trees on disk. → The layout flip is the single linearization point, so no reader ever sees a partial tree; the residue is a *read* duplicate for one commit, not a dual write, and doctor reports it until retirement completes.
- [Risk] `.rasen/migration/staging/` inside the Store worktree could be committed by a careless `git add -A`. → It is under the already-ignored `.rasen/` directory, the command prints pathspec-scoped commit suggestions, and staging is removed on success, rollback, and resume.
- [Risk] Same-path dual schemas (`projects/<id>.yaml` v1 vs v2) could be read with the wrong parser. → Readers dispatch on the Store's declared layout version rather than sniffing content, migration is the only writer that flips a record, and a v1 record found in a v2 Store is a diagnostic rather than a tolerated variant.
- [Risk] Windows case-insensitive filesystems can alias two capabilities or two project ids onto one destination. → Destination uniqueness is checked on the case-folded normalized form as well as the exact form, and containment/validation reuses the Foundation portable validators with explicit `path.win32` fixtures.
- [Risk] Cross-device rename during publication would fail mid-way. → Staging lives inside the Store worktree, guaranteeing same-volume renames; the recovery manifest still covers a failure at any individual rename.
- [Risk] A second machine migrates the same Store concurrently. → Migration takes the Store-scoped owner-aware lock used by the existing membership writers, keyed by `storeUid` and ref, and `apply` revalidates `HEAD` and metadata under it.

## Migration Plan

1. Land child 2's routing seam first; this child assumes `legacy_flat_store_requires_migration` and the v2 project scope already exist.
2. Add the Module contracts, read-only adapters, and the inventory implementation behind a new public entry point, with no write path enabled.
3. Add the evidence reducer, provenance graph, item state taxonomy, and plan construction, with the mapping-file schema and its strict validation.
4. Add staging, verification, ordered publication, retirement, the recovery manifest, and the committed receipt.
5. Add the catalog upgrade and layout-dispatching membership readers, then switch `adopt` and `eject` onto project partitions and add the `archive relocate` target-line requirement.
6. Add the runtime and source no-dual-write guards, then the doctor diagnostics.
7. Verify: focused Module suites, adopt/eject partition suites, CLI and end-to-end migration journeys, Windows/POSIX and Unicode/long-path fixtures, typecheck, lint, build, strict Change validation, and a strict UTF-8 audit of every changed file.

Rollback before any Store has been published to layout v2 is removal of the unused Module and the adapter switch. After a Store has been published, rollback must keep reading the v2 partitions it created; it may disable further migration and further v2 adopt/eject, but it may never reinterpret or relocate published content, and no rollback path writes flat Store planning content.

## Open Questions

None blocking. Three decisions above resolve silences in the accepted design and are the ones worth re-reading in review: retaining unclassified Store-level design docs (decision 5), requiring an operator-declared target line and creating target-line catalogs from the mapping file (decision 6), and relocating legacy Archive entries verbatim without an Archive v2 upgrade (decision 6). Cross-project spec references, target-line ref management, and Archive record upgrades remain owned by later slices and can consume the receipt and the catalogs without changing this Module's Interface.
