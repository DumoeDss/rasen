## Context

The accepted Store v2 design separates a physical Store checkout from each project's planning home and requires target-line state to be isolated by Store Git worktrees. The archived `store-planning-foundation-v2` child supplies pure layout, catalog, portable-name, planning-identity, Change-metadata, and Archive-record contracts, but deliberately does not activate command routing or writes.

The current routing seam is shallow and root-shaped:

- `src/core/root-selection.ts` resolves a Store or project registry entry and `makeRoot()` always returns `path`, `changesDir`, `specsDir`, and `archiveDir` under flat `rasen/` children;
- `--store` and `--project` are rejected together even though Store v2 needs both dimensions;
- `src/core/planning-home.ts` and `toPlanningHome()` project the same single-repository assumption;
- workflow, list/show/validate/archive, pipeline, discovery, placement, and management callers either consume the naked directories or rebuild `rasen/changes`, `rasen/specs`, design-docs, and Archive paths from a root;
- `resolveRootForCommand()` also owns CLI notices, JSON failure rendering, version warnings, and registry self-healing, mixing invocation concerns with planning authority;
- a Store integration checkout can therefore look indistinguishable from the correct planning checkout to a downstream caller.

This is the second slice in a serial portfolio. It must consume the Foundation contracts without taking ownership of legacy layout migration, Git worktree creation/pairing, finalization outcomes, or the later Store Issue/query/UI model. Those later Modules need a stable capability seam rather than another root DTO.

## Goals / Non-Goals

**Goals:**

- Establish one deep `StorePlanning` Module as the sole Store/project planning-scope resolver.
- Make Store, project, target line, layout, intent, and checkout authority explicit and conflict-checked.
- Give callers closed typed planning addresses and capability-specific operations instead of a path-construction recipe.
- Keep standalone behavior compatible, keep legacy flat Stores on their frozen flat adapter, and prevent split truth or Store integration-checkout writes. Making legacy flat Stores read-only is deferred to `store-layout-v2-migration`, which ships the migration that makes that refusal survivable — enforcement and remedy land together, in one PR, so no user sees a Store they can neither write to nor migrate.
- Let existing read callers migrate through a narrow compatibility projection while all new/mutation code crosses the new seam directly.
- Activate Store v2 `new change` identity creation only when existing planning-worktree authority can be proved.
- Produce deterministic, localized-compatible diagnostics and machine-readable scope descriptions on Windows, macOS, and Linux.

**Non-Goals:**

- Inventorying, mapping, or migrating legacy flat Store content; changing adopt/eject/bind data.
- Creating, pairing, repairing, merging, or deleting Store/execution Git worktrees.
- Implementing Archive v2 plan/apply, outcome validation, spec sync, bulk/ship finalization, or code reachability proof.
- Implementing Store Issue/Execution Plan resources, cross-project query indexes, or new UI aggregation.
- Persisting scope capabilities, absolute paths, or branch-derived identity.
- Providing arbitrary relative-path resolution, extension registration, dual write, or automatic layout upgrade.

## Decisions

### 1. Put the only root-routing seam in a deep `StorePlanning` Module

The external Interface has one operation, overloaded by intent, and returns narrow capabilities:

```ts
interface StorePlanning {
  open(input: OpenStoreRead): Promise<StoreAggregateReadScope>;
  open(input: OpenProjectRead): Promise<ProjectReadScope>;
  open(input: OpenChangeCreation): Promise<ChangeCreationScope>;
}

interface OpenBase {
  readonly startPath: string;
  readonly selection?: {
    readonly store?: string;
    readonly project?: string;
    readonly targetLine?: string;
  };
}

interface OpenStoreRead extends OpenBase {
  readonly intent: "store-read";
}

interface OpenProjectRead extends OpenBase {
  readonly intent: "project-read";
  readonly change?: { readonly changeId: string; readonly expectedInstanceId?: string };
}

interface OpenChangeCreation extends OpenBase {
  readonly intent: "create-change";
}
```

The Module never reads `process.cwd()`; CLI and management adapters snapshot and pass `startPath`. It hides registry namespaces, Store alias/UID disambiguation, binding semantics, layout detection, catalog validation, source precedence, checkout-role inspection, path containment, scope fingerprints, and diagnostic construction.

The three returned capabilities prevent an aggregate read from becoming a project write merely because it contains a path:

```ts
interface StoreAggregateReadScope {
  readonly kind: "store-aggregate";
  readonly ref: StoreAggregateRef;
  locate(address: StoreReadAddress): ScopedReadLocation;
  describe(): PlanningScopeDescription;
}

interface ProjectReadScope {
  readonly kind: "project";
  readonly ref: StandaloneProjectRef | LegacyStoreReadRef | StoreProjectRef;
  locate(address: ProjectReadAddress): ScopedReadLocation;
  openChange(selector: ChangeSelector): Promise<ScopedReadChange>;
  describe(): PlanningScopeDescription;
}

interface ChangeCreationScope {
  readonly kind: "change-creation";
  readonly ref: StandaloneAuthoringRef | StoreProjectAuthoringRef;
  createChange(input: CreateScopedChangeInput): Promise<ScopedAuthoredChange>;
  describe(): PlanningScopeDescription;
}
```

Capabilities are immutable, short-lived, in-process values. Their tokens and absolute paths are not wire or persistence formats. Mutation methods always revalidate internally; callers are not asked to remember a separate `revalidate()` ordering rule.

Alternative considered: expand `ResolvedOpenSpecRoot` with Store/project/target-line fields and more naked directories. This keeps the Interface nearly as complex as its Implementation and lets every caller keep making path and permission decisions, so the complexity reappears when the Module is deleted; it is rejected as shallow.

### 2. Design it three ways, then use a hybrid

Three independent Interface designs were compared:

1. **Minimal Interface:** one `open`, then `scope.locate` and `scope.createChange`. It has the highest apparent Depth and keeps revalidation inside mutation. Its single broad scope, optional per-address project ids, and aggregate enumeration surface make illegal capability combinations easier to express.
2. **Flexible capability Interface:** one overloaded `open` returns Store-read, project-read, or project-mutation scopes with separate address unions and optional `authorize`. It gives the strongest type-level narrowing and future extension points, but exposes more concepts than current callers need and risks a prematurely shallow Store-read capability before `StoreQueryModule` exists.
3. **Common-caller Interface:** `open`, `openArtifacts`, and `openAuthoring` optimize list/context, status/show, and new/instructions respectively. Typical execution-checkout calls are very short, but three resolution entry points create a larger Interface and make it easier for semantics to drift even if they share an Implementation.

The selected hybrid retains one overloaded `open()` seam from designs 1 and 2, uses design 2's capability-specific closed address sets, keeps design 1's internal mutation revalidation, and lets the invocation adapter supply design 3's trivial common-case input. This gives callers one concept—open a scope for a declared intent—while keeping aggregate, read, and authoring authority distinct at compile time.

### 3. Use closed typed addresses; never an arbitrary relative path

Read addresses are deliberately finite:

```ts
type StoreReadAddress =
  | { kind: "store-design-docs" };

type ProjectReadAddress =
  | { kind: "project-home" }
  | { kind: "project-config" }
  | { kind: "project-schemas" }
  | { kind: "project-work" }
  | { kind: "specs" }
  | { kind: "spec"; capabilityId: string }
  | { kind: "project-design-docs" }
  | { kind: "active-changes" }
  | { kind: "active-change"; changeId: string }
  | { kind: "archive-line" };
```

Store v2 addresses delegate to the Foundation `resolveStorePlanningLayoutV2Path()` contract. The routing Implementation adds only collection/project-config variants missing from the Foundation address union, with the same portable validators and containment policy. Standalone and legacy-read adapters map the same semantic addresses to existing layouts. The result is a branded absolute `ScopedReadLocation` carrying owner and scope token; mutation authority is never inferred from the brand.

Issue/Execution Plan, migration sources/destinations, Archive entries, and spec-sync write addresses are not added here. Their owning future Modules receive scope capabilities or stable refs, then expose lifecycle-specific Interfaces.

The experimental Direction work area is exposed as the read-only semantic
`project-work` address. This keeps generated Direction guidance from deriving a
`work` sibling from `changesDir` while granting no new mutation capability;
Direction still owns validation and writes beneath that returned project
location.

Alternative considered: return `projectHome` and let callers join child segments. This shortens the union but immediately recreates path policy in list, status, management, and templates, so it fails the deletion test.

### 4. Resolve evidence once with fixed precedence and conflict constraints

`open()` follows one deterministic algorithm:

1. Require and canonicalize an absolute `startPath`; validate explicit selector syntax and continue the deliberate `--store-path` rejection.
2. Snapshot the Store/project registry once.
3. Collect explicit selectors, frozen session facts, execution-worktree association, Store planning-worktree marker, durable project planning binding, nearest qualifying standalone root, Store metadata, project catalog, target-line catalog, and read-only Git checkout/worktree facts.
4. Merge scope fields in this precedence order: explicit selectors, session, execution association, planning marker, project binding, standalone discovery. A weaker source fills only absent fields. Every overlapping unequal fact is a constraint violation, not an override opportunity.
5. Treat Change metadata as a final relationship constraint rather than a lower-precedence source; it can confirm or reject a scope but is never rewritten by flags.
6. Resolve Store alias to permanent UID, project alias to canonical project identity, and target-line id to its catalog; branch/ref names remain locators.
7. Read `layoutVersion` from Store metadata. Directory presence never implies layout v2.
8. Validate project catalog filename/content, `planningBinding`, target-line membership, split planning truth, checkout role, and containment.
9. Apply the requested intent guard and derive/verify `PlanningScopeId` whenever Store/project/target-line are complete.
10. Freeze a scope evidence fingerprint, refs, typed locators, notices, and description.

Explicit `--store` without `--project` is semantically meaningful: `store-read` opens an aggregate scope, while `project-read` or `create-change` fails `project_scope_required`. It does not borrow the ambient cwd project. `--project` alone selects the registered-project namespace, then follows a verified planning binding or stays standalone. `--store S --project P` validates P in S instead of resolving two independent roots. `--target-line` selects a stable id and never authorizes the integration checkout.

The Module reports stable diagnostic codes including:

- existing selector/identity errors such as `store_path_not_supported`, `store_alias_ambiguous`, `unknown_store`, and Foundation validation families;
- `unknown_project`, `project_not_in_store`, `planning_selection_conflict`;
- `project_scope_required`, `target_line_required`, `planning_worktree_required`;
- `split_planning_truth`, `legacy_flat_store_requires_migration`;
- `planning_scope_stale`, `planning_address_not_available`, and `change_already_exists`.

`store_project_mutually_exclusive` is retired. Human and JSON adapters render the same typed diagnostic; they do not define separate error semantics.

### 5. Keep layout compatibility explicit and one-way

Resolution produces one of four states:

| State | Project read | Project mutation | Path authority |
| --- | --- | --- | --- |
| standalone | existing behavior | existing behavior | standalone adapter |
| legacy flat Store | existing behavior | existing flat behavior; `work migrate` refuses with `legacy_flat_store_requires_migration` | one frozen legacy adapter |
| Store v2 aggregate | Store-level read only | `project_scope_required` | Store-level addresses only |
| Store v2 project | typed project read | only with target line and verified planning worktree | Foundation v2 layout |

Legacy content is never unioned with v2 content. A project catalog marked `bound` makes the Store partition authoritative. If a local planning tree remains, ordinary reads use only the Store truth and report `split_planning_truth`; mutations fail. Doctor and the future migration Module may inspect both trees through their own diagnostic/migration Interfaces.

No feature flag selects a layout. `layoutVersion: 2` is an explicit data fact. The routing child writes no layout/catalog upgrade and never turns directory existence into v2.

### 6. Make `createChange()` the only planning mutation owned by this slice

Leaving Change creation in `new-change.ts` would scatter the exact concerns this Module exists to hide: target-line guard, active-Change path, seed minting, identity derivation, no-clobber reservation, and metadata ordering. Therefore `ChangeCreationScope.createChange()` owns:

1. Change id/schema/implementation intent and caller metadata validation;
2. revalidation of the frozen layout, binding, catalogs, and checkout-role fingerprint;
3. Foundation seed minting and `PlanningScopeId`/`ChangeInstanceId` derivation for Store v2;
4. rejection of caller-supplied identity-controlled fields;
5. staging the minimal complete Change in a sibling location, no-clobber publication, and read-back identity verification;
6. cleanup that leaves either no target or one complete target after failure.

Standalone creation retains current metadata compatibility and does not invent Store identity. A legacy flat Store obtains a `ChangeCreationScope` that writes its existing flat layout through the frozen legacy adapter and mints no Store v2 identity; withdrawing that capability belongs to `store-layout-v2-migration`, whose proposal already claims the refusal and ships the migration alongside it. Store v2 creation remains unavailable when routing can prove only an integration checkout; it becomes enabled for already-verifiable planning worktrees and needs no Interface change when the later pairing Module supplies association evidence.

All other planning mutations remain guarded at routing adapters but are not reimplemented here. Archive keeps its existing standalone and legacy flat Store behavior, while Store v2 finalization refuses mutation until `ChangeFinalizationModule` activates it. Migration and worktree pairing retain their later-slice ownership.

### 7. Isolate compatibility projections in adapters and prevent mutation use

`root-selection.ts` becomes the CLI invocation/compatibility adapter. It maps Commander options to `PlanningSelection`, supplies the cwd snapshot, renders banners/notices/errors, performs existing best-effort version warning behavior, and limits registry self-healing to the actual standalone/execution project rather than a Store checkout.

For read callers not migrated in the first implementation commit, the adapter may derive a deprecated `ResolvedOpenSpecRootReadProjection` from `ProjectReadScope.locate()`:

```ts
interface ResolvedOpenSpecRootReadProjection {
  readonly planningCheckoutRoot: string;
  readonly projectHome: string;
  readonly changesDir: string;
  readonly specsDir: string;
  readonly archiveDir?: string;
  readonly source: OpenSpecRootSource;
}
```

The projection accepts project-read scopes only. It cannot represent a Store aggregate or authoring capability. Every directory comes from typed addresses; `planningCheckoutRoot` no longer implies `changesDir === join(root, "rasen/changes")`. A Store project read without a verified target line omits Archive location rather than returning its parent. Mutation functions do not accept this type.

`PlanningHome` becomes an equally read-only derived view. New production code may not construct either projection directly. Compile-time import/consumer fixtures and source guards prevent Store business callers from importing Foundation path constructors or joining Store layout segments outside the Module.

### 8. Migrate callers by authority cluster, not by superficial command name

The implementation inventory divides into these clusters:

1. **Seam and CLI selection:** `root-selection.ts`, `planning-home.ts`, CLI option registration, root output, banners, follow-up hints, context, and doctor diagnostics.
2. **Change workflow:** `new-change.ts`, status/instructions/shared workflow helpers, artifact graph/context loaders, schema/config lookup, action context, and per-class landing output.
3. **Read commands:** list, change/spec show, validate, item discovery, references, task progress, and Change parsing.
4. **Lifecycle/orchestration reads and guards:** archive entry, pipeline Change lookup/run recovery, agent wait/change lookup, work/doctor; this slice routes and refuses unsupported Store v2 mutations without taking finalization or migration ownership.
5. **Placement and guidance:** file placement, status landing fields, design-doc consumers, and built-in workflow templates that currently teach sibling or root-join algorithms.
6. **Management read models:** changes, archive, task detail, runs, session launch/context, and space resolution. Existing endpoints consume project scopes; Store aggregate query behavior remains deferred.

Each cluster first gains Interface-level routing tests, then its implementation switches, then obsolete root-join tests are removed rather than layered beneath the new seam. Completion requires a source inventory proving no supported Store v2 consumer still treats a physical Store root as a project planning home.

### 9. Keep local dependencies behind internal adapters

Dependency categories are:

- **In-process:** Foundation validators/layout/identity, selector reconciliation, intent narrowing, deterministic diagnostics. These are directly composed; no adapter is added.
- **Local-substitutable:** filesystem/canonicalization, Store and project registries, session/association/marker reads, read-only Git checkout/worktree inspection, Change metadata/no-clobber publication, clock, and entropy. Production uses existing Node/Git/registry implementations; tests use in-memory or deterministic adapters.
- **Consumer adapters:** Commander flags/human/JSON output and management selector/wire mapping. They translate to/from the Module Interface and contain no resolver.
- **Remote dependencies:** none. Scope opening never clones, fetches, registers, upgrades, or repairs.

Filesystem/Git/registry seams stay internal to the Module. They are real seams because production and test adapters both exist; they are not exposed as caller configuration.

### 10. Scope descriptions are diagnostics, not replayable authorization

`describe()` returns a stable projection for `rasen context --json`, status/instructions, management diagnostics, and follow-up hints:

```ts
interface PlanningScopeDescription {
  readonly kind: "standalone" | "legacy-store" | "store-aggregate" | "store-project";
  readonly intent: "store-read" | "project-read" | "create-change";
  readonly source: "explicit" | "session" | "execution-association" |
    "planning-worktree-marker" | "project-binding" | "nearest-standalone";
  readonly ref: StablePlanningRef;
  readonly paths: Readonly<Record<PlanningAddressKind, string | undefined>>;
  readonly evidence: readonly ScopeEvidence[];
  readonly notices: readonly PlanningNotice[];
  readonly followupSelection: PlanningSelection;
}
```

Collections and evidence are sorted by canonical identity so output does not depend on filesystem enumeration or locale. Follow-up selectors prefer permanent Store/project identities over ambiguous display aliases and preserve Store, project, and target line in order. Description paths are local locators; callers cannot feed a serialized description or path back to obtain a write capability.

## Risks / Trade-offs

- [Risk] The closed address union grows as new planning classes appear. → Treat that edit as the intentional fail-closed extension point; require one mapping and cross-platform containment tests at the Module Interface.
- [Risk] TypeScript brands and capability types can be bypassed by unsafe casts or JavaScript. → Keep runtime validation/revalidation and source-level caller inventory; brands improve ordinary use but are not the security boundary.
- [Risk] A read-only compatibility projection could become permanent. → Give it a read-only name, reject aggregate/mutation scopes, forbid direct construction, track remaining consumers explicitly, and remove old tests as clusters migrate.
- [Risk] Some Store v2 commands become stricter before worktree pairing lands. → Report stable actionable errors and never trade correctness for writing the integration checkout; later association evidence activates the same Interface.
- [Risk] Scope evidence can change between open and write. → Fingerprint ownership/layout facts and revalidate inside `createChange()` immediately before publication; stale scopes fail without redirect.
- [Risk] Store aggregate capability is shallow until Store Query lands. → Keep only Store-level addresses now and pass the capability to the future query Module; do not add ad hoc directory enumeration to make it look deeper.
- [Risk] Existing management Store-space endpoints expect flat project content. → Return project-scope diagnostics for project endpoints and retain Store aggregate metadata reads; richer cross-project behavior belongs to the later query/UI slice.
- [Risk] Registry self-healing currently assumes the selected planning root is a project. → Move it to the invocation adapter and key it on actual execution/standalone project context, never a Store planning checkout.
- [Risk] Windows canonicalization and case-insensitive aliases can create false conflicts or escapes. → Reuse Foundation portable validation and existing canonical path helpers, test with explicit `path.win32`, mixed-case drives, reserved names, separators, symlinks, and containment fixtures.

## Migration Plan

1. Land/merge the archived Foundation contracts before implementing this child.
2. Add `StorePlanning` Interface, internal filesystem/registry/context/Git adapters, deterministic evidence reducer, layout dispatch, typed errors, and Interface-level tests. Store v2 mutation remains closed unless planning-worktree authority is already verifiable.
3. Convert `root-selection.ts` and `planning-home.ts` into invocation/read-projection adapters; add orthogonal selector parsing and `--target-line` registration without changing standalone behavior.
4. Migrate workflow/read clusters to scope capabilities and typed locations. Switch Store v2 `new change` to `createChange()` and add identity/no-clobber tests.
5. Migrate placement/guidance and management read clusters; make unsupported Store aggregate/project mutations fail with stable diagnostics.
6. Delete obsolete Store-root joins, mutation use of root projections, and superseded tests. Run a bounded source inventory for remaining `rasen/{changes,specs,design-docs}` joins and classify every hit as standalone adapter, fixture, later-slice owner, or defect.
7. Verify focused Module tests, CLI contract/E2E matrices, legacy and standalone compatibility suites, management reads, TypeScript, lint, build, strict Change validation, and Windows CI path cases.

Rollback before any Store v2 Change is written is removal of the unused Module and adapter switch. After Store v2 Change creation is enabled, rollback must retain read support for the written v2 metadata and project layout; it may disable further authoring but must not reinterpret or move existing content. No rollback path writes flat Store planning content.

## Open Questions

None for this slice. Store aggregate query shape, migration ownership receipts, the authoritative planning/execution association format, and finalization write addresses remain decisions for their explicitly later Modules and can consume the scope/ref capability without changing this routing Interface.
