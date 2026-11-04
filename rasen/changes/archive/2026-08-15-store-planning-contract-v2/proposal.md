## Why

On this line a Store is one flat planning home, so two member projects cannot hold a Change with the
same name, a Change's identity changes the moment its directory moves, and an archived Change records
no portable proof of which Store, project, or release line it belonged to. Every later capability the
Store-v2 workstream needs — worktree bindings, Store Issues, layout migration, finalization — has to
agree on those addresses and identities first, and each would otherwise invent its own regular
expressions, hash preimages, and path joins.

This change delivers that agreement as one pure contract layer: portable identifiers, versioned
addresses, stable identities, and outcome-aware Archive records that are correct without touching a
filesystem, a registry, a Git process, or the current working directory. Nothing observable changes
for a user of this release; it is the foundation the next two changes in this portfolio compile
against.

## What Changes

- Introduce Store planning **layout v2**: each member project owns its own planning home, so its
  canonical specs, design docs, active Changes, and Archives no longer share one flat Store root.
  Two projects can hold the same Change alias without collision, and Archives are partitioned by
  stable target-line id while active Changes are not.
- Declare layout v2 **explicitly**. A Store announces it with its own `layoutVersion` field, separate
  from the Store metadata schema version. A Store that does not declare it stays a legacy-layout
  Store, and neither reading nor writing its metadata ever infers or injects the declaration from
  directories found on disk.
- Introduce **portable identifier grammars** for project ids and target-line ids that stay injective
  on case-insensitive filesystems: traversal, path separators, control characters, trailing dot or
  space, Windows reserved device names, and non-canonical case are rejected on every platform, and an
  invalid value is never sanitized into a different — possibly someone else's — identifier.
- Introduce **strict project and target-line catalogs**. A project catalog separates being a planning
  member from having planning truth actually bound, and a target-line catalog maps one stable line id
  to portable, credential-free Git refs. Refs are locators: renaming a branch never renames the line.
- Introduce **stable planning identities** — planning scope, Change instance, worktree instance, and
  workspace pair — each derived from a domain-separated canonical serialization, each carrying its
  own type prefix so one kind can never be passed where another is required. Moving a Change or
  renaming its branch does not change its identity; reusing its alias for a new attempt does.
- Extend Change metadata with an optional portable identity block and an explicit
  `implementation: none` declaration for planning-only Changes. Metadata that carries an identity
  block is re-derived on read and rejected if it has been tampered with; metadata without one stays
  valid and round-trips without gaining fields.
- Introduce **outcome-aware Archive v2 records**: `landed`, `superseded`, `cancelled`, and
  `abandoned`, with landed-only spec synchronization and code-merge proof made structural rather than
  conventional, deterministic serialization, and portable digest-verified evidence accounting.
- **BREAKING (v2 contract only):** a Store that declares layout v2 cannot address project Changes or
  canonical specs in the flat Store root, and a non-landed Archive v2 record cannot carry applied
  spec actions or a code-merge object. No existing Store, Change, or Archive on this line is
  reclassified: v1 records keep parsing through their existing entry points and nothing in this
  change writes v2 data.
- **BREAKING (metadata reads):** Change metadata carrying a field the product does not define is now
  rejected instead of silently ignored, so a typo in `.openspec.yaml` fails loudly instead of being
  dropped on the next write. The quality accounting the archive engine itself records on an archived
  Change is explicitly admitted, so archived Changes stay readable.
- Keep the whole layer **side-effect free**. It selects no root, routes no command, writes no
  catalog, creates no worktree, applies no Archive, and reaches no management API or UI. Those are
  the following changes in this portfolio and later slices of the workstream.

## Capabilities

### New Capabilities

- `store-planning-layout-v2`: Project-partitioned Store planning addresses, explicit layout
  declaration, portable identifier grammars, strict project and target-line catalogs, and pure
  containment-checked path computation across Windows and POSIX semantics.
- `store-planning-identity-v2`: Stable, portable planning-scope, Change-instance, worktree-instance,
  and workspace-pair identities, plus verified v2 Change metadata identity and explicit
  planning-only implementation intent.
- `change-finalization-record-v2`: Finalization outcomes and the strict Archive v2 record, including
  landed-only spec-synchronization invariants, landed proof shape for code-backed and planning-only
  Changes, portable evidence accounting, and deterministic self-verifying serialization.

### Modified Capabilities

None. No existing capability's requirements change: command routing, root selection, file placement,
archive behavior, and Store registration all keep their current contracts. The contracts added here
are consumed by later changes, which will carry those modifications.

## Impact

- **Adds** pure contract modules under `src/core/store/` behind one public planning-foundation entry
  point, plus one neutral canonical-JSON utility under `src/core/` that the existing workflow-package
  helper re-exports so the repository keeps exactly one canonical-JSON implementation.
- **Extends, additively,** Store metadata parsing/serialization with the optional layout declaration,
  the Change metadata schema with optional identity and implementation intent, and the Store project
  record module so the Windows reserved-device-name list has one definition instead of a copy.
- **Adds** pure unit tests under `test/core/store/` covering both Windows and POSIX path semantics on
  any host, a public-surface consumer test, and a layer-purity guard that fails if this layer ever
  gains filesystem, process, environment, cwd, or Git access.
- **No** new runtime dependency, CLI flag, command, management-API endpoint, UI surface, Store
  mutation, Git operation, or archive transaction change.
- **Unblocks** `store-worktree-bindings-v2` and then `store-issue-resources`, which are the remaining
  two changes of this portfolio and compile against this boundary.
