## Why

The current Store model treats one Store checkout as one flat planning home, so different projects and release lines can collide and a Change's identity changes with its physical directory. Before routing, migration, worktree, or finalization commands can safely adopt the accepted Store v2 design, they need one portable, fail-closed set of layout, catalog, identity, outcome, and Archive data contracts.

## What Changes

- Define Store layout v2 and pure, containment-checked paths for project planning homes, project catalogs, target-line catalogs, active Changes, and target-line-scoped Archives.
- Define portable project and target-line identifier grammars that remain injective on case-insensitive filesystems and reject traversal, separators, Windows device names, and case aliases.
- Define strict project and target-line catalog schemas, including a Store project's planning-binding state and stable target-line-to-Git-ref locators.
- Define domain-separated derivation and verification for `PlanningScopeId`, portable `ChangeInstanceId`, planning/execution `WorktreeInstanceId`, and ordered `WorkspacePairId`, and extend Change metadata with optional v2 identity and implementation intent.
- Define finalization outcomes (`landed`, `superseded`, `cancelled`, and `abandoned`) and a strict Archive v2 record whose cross-field validation enforces landed proof shape and landed-only spec synchronization.
- **BREAKING (v2 contract):** a Store declaring layout v2 cannot place project Changes or canonical specs in the flat Store root, and non-landed Archive v2 records cannot carry applied spec actions.
- Keep this foundation side-effect free: command selection, root routing, legacy migration writes, Git worktree operations, Archive plan/apply, management APIs, and UI remain in later portfolio slices.

## Capabilities

### New Capabilities

- `store-planning-layout-v2`: Versioned Store project partitions, portable catalog records, identifier grammar, and pure path/containment contracts.
- `store-planning-identity-v2`: Stable planning scope, Change instance, worktree instance, workspace-pair, and Change metadata identity contracts.
- `change-finalization-record-v2`: Outcome-aware finalization inputs and Archive v2 validation/serialization contracts, including landed-only spec-sync invariants.

### Modified Capabilities

None. Existing command routing, file placement, and archive behavior are changed by dependent portfolio slices after they consume these new contracts.

## Impact

- Adds or extends TypeScript contracts under `src/core/store/`, `src/core/change-metadata/`, and archive accounting modules, exported through stable core entry points.
- Adds pure unit and fixture tests under `test/core/store/` and archive/change-metadata tests, covering POSIX and Windows path semantics without requiring a Git repository.
- Provides the dependency surface for the later Store scope-routing, layout migration, worktree binding, and finalization children; no CLI flags, filesystem mutation flow, Store registry mutation, or Git integration changes in this slice.
