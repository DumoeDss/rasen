## Why

`store add-project` (shipped 2026-07-10) registers an in-repo project "as a store" — a reuse expedience that conflates two genuinely different things. Because a project occupies the same flat id namespace as stores, a store named `elftia` and a client project folder `elftia` cannot coexist, and the seams already leak: a name collision produces a misleading "cannot be added to itself" error, and `rasen store list` shows projects undifferentiated from stores. The truthful model the user asked for is a type distinction: stores and projects are separate namespaces that may share a name (`elftia` the store, `elftia` the project, alongside `elftia-website`, `elftia-plugins`).

## What Changes

- **Registry entries gain a `type: 'store' | 'project'` field** (absent = `'store'`, so every existing entry keeps meaning store). Uniqueness becomes the `(type, id)` pair: a store `elftia` and a project `elftia` coexist. This stays in the one store registry — the machine-home project registry (`src/core/project-registry.ts`) is untouched.
- **New `--project <id>` CLI flag**, parallel to `--store <id>` and mutually exclusive with it (a friendly error if both are passed), on every command in the two flag-bearing groups (the specs/changes commands and the `pipeline` inspection group). A bare id everywhere still means the store namespace.
- **Config `references:` entries accept a `project:` prefix string** — `references: [other-store, project:elftia]` — to point at the project namespace. Bare ids stay stores. Minimal intrusion into the existing string-list parsing.
- **`store add-project` re-points to the project namespace.** The inferred project name colliding with a store name is no longer a conflict. `--as <id>` is retained for collisions *within* the project namespace (two checkouts sharing a basename).
- **Error-message follow-up folded in:** the self-reference guard compares canonical **paths** (true self = same directory), so a same-name / different-path store and project are not falsely rejected; name-collision errors name the taken id and suggest `--as <id>` with a concrete example.
- **Cross-machine parity:** referenced-store fetch recipes and printed command hints render the project-namespace form (`--project <id>` / the project registration recipe) for project-typed entries, so a teammate following a recipe lands the entry in the project namespace and the reference resolves.
- **No migration verb.** Pre-split "project-as-store" entries stay plain store entries and keep working forever. Backward compatibility is absolute; no version bump.

## Capabilities

### New Capabilities
- `store-project-namespace`: The type-namespaced registry (`(type, id)` uniqueness, absent-type = store), the `--project` selector and its mutual exclusion with `--store`, the `project:` config-reference prefix, project-namespace resolution to a normal Rasen root, and the project-aware fetch recipes / command hints.

### Modified Capabilities
- `store-add-project`: the verb registers into the project namespace by default; the self-reference guard compares canonical paths rather than ids; collision errors suggest `--as` concretely. Existing non-destructive, idempotent, and commit-guidance requirements are unchanged.

(Registry uniqueness and conflict detection becoming `(type, id)`- and `(type, canonical-path)`-aware is NEW spec territory — the store-registration capability never specced registry id-uniqueness as a requirement — so it lands as ADDED requirements in the new `store-project-namespace` capability rather than as a modified delta.)

## Impact

- **Registry schema/parse** (`src/core/store/foundation.ts`): `RegistryEntrySchema` gains an optional `type`; the registry's uniqueness/keying disambiguates the project namespace from the store namespace (design decides the on-disk encoding); `assertValidStoreIds` validates the id portion, not a namespace-qualified key. **Security-relevant parsing surface** — must stay strict and reject malformed/ambiguous entries. `validateStoreId` (id grammar) is unchanged and shared by both namespaces.
- **Conflict checks** (`src/core/store/registry.ts`): `assertNoRegisteredStoreConflict` becomes `(type, id)`- and `(type, path)`-aware; `store_id_conflict` / `store_path_conflict` fix-hints mention `--as` where add-project surfaces them.
- **Selection plumbing** (`src/core/root-selection.ts`): `StoreSelectorOptions` gains `project`; `resolveOpenSpecRoot` resolves `(type, id)`; `emitStoreRootBanner` / `withStoreFlag` render `--project <id>` for a project-selected root.
- **References** (`src/core/references.ts`, `src/core/project-config.ts`): `parseDeclarationList` accepts `project:<id>` entries (validate prefix + id grammar); the index renders the type; `registerFix` fetch recipes round-trip into the correct namespace. **Security-relevant:** the shell-pasteable clone/register recipe must keep its existing `isShellSafeRemote` gating and never emit an unsafe or namespace-ambiguous command.
- **CLI surface** (`src/cli/index.ts`, `src/commands/*.ts`, `src/commands/pipeline.ts`, `src/core/completions/command-registry.ts`): register `--project` on both groups; mutual-exclusion check; `store list` displays type; add-project output wording.
- **Templates** (`src/core/templates/workflows/store-selection.ts` and any expert templates threading `--store`): extend guidance to `--project`; template edits require the build→update flow with hand-synced parity hashes.
- **Out of scope**: a second registry module; a migration verb; changing the machine-home project registry; any capability difference between a store root and a project root (type distinguishes namespace and display only).
