## Why

A Store's human-readable id is the only thing that identifies it today. That id is a rename away from breaking every project pointing at the Store, and two independently-created Stores on two machines may legitimately carry the same id — so a project's `store:` pointer cannot state *which* Store it means. Worse, when the named Store cannot be found the system quietly pretends the project has no Store at all: configuration falls through to global/default and the user is told nothing, so a mis-registered or not-yet-cloned Store looks exactly like a project that never had one.

This change gives a Store a permanent identity that survives renames and cannot collide across machines, demotes the id to a display alias, and makes an unresolvable Store an explicit, diagnosable, repairable state instead of silence. It is the foundation the rest of the Store/Context work builds on — project membership, session runtime context, and shared knowledge all need to name a Store durably before they can be built.

## What Changes

- **A Store gets a permanent identity.** Creating a Store mints an immutable UID that is recorded in the Store's own metadata and travels with the Store's repository. The UID never changes, including across renames and re-registration.
- **The Store id becomes a display alias.** It stays useful for typing and reading, may be renamed, and may legitimately be shared by two different Stores. It no longer decides which Store is meant.
- **A project states which Store it plans in, durably.** A project's Store pointer records the Store UID, its alias for display, and a credential-free remote so the Store can be located on a machine that has never seen it. The existing single-string pointer keeps working and resolves whenever its alias matches exactly one Store.
- **Naming a Store by alias has explicit arity.** Zero matches is "not found", one match resolves and hints at upgrading the pointer, and two or more is reported as ambiguous with the candidates listed — never a silent pick.
- **A Store that cannot be resolved fails closed. BREAKING** A project that declares a Store which is not registered, whose checkout is not that Store, or whose pointer is unreadable no longer resolves configuration as though it had no Store. The command stops and prints what was expected, why it could not be used, and a copy-pasteable repair command. Previously this degraded silently to global/default values.
- **`rasen doctor` diagnoses identity without repairing it.** Doctor stays read-only and keeps working precisely in the failure states above — it is how a user finds out what is wrong — reporting the pointer shape, whether a UID or an alias was resolved, alias ambiguity, UID mismatch, and remote divergence.
- **The machine's Store registry records Stores by UID.** The registry keeps an alias index for lookup and display. An existing registry keeps being read as-is; it is only rewritten in its new shape when the user runs a command that changes it.
- **Credentials never enter Store metadata.** A remote carrying a username/password or token is rejected on write and redacted in output.
- **A new all-numeric Store alias warns.** It remains accepted for compatibility, but the warning explains that digits read as an identity and the UID is the real one.

Out of scope for this change (later work in this series): Store-scoped learned knowledge, project membership records inside a Store, the bootstrap clone/register flow, and the migration of legacy adoption source paths.

## Capabilities

### New Capabilities
- `store-identity`: A Store's permanent identity and its display alias, the project-side pointer that names a Store durably, the machine registry keyed by that identity, the single resolution answering "which Store is this and can I use it right now", and the read-only diagnostics for every way that answer can fail.

### Modified Capabilities
- `store-config-inheritance`: a declared Store that cannot be resolved now stops the command with a repair command instead of silently contributing no configuration layer; notices state whether a UID or an alias was resolved.
- `config-resolution`: "no Store layer" now means the project declares no Store — an unresolvable Store is reported, not folded into the same outcome.
- `store-project-namespace`: Store-namespace registry entries are identified by Store UID with the alias as a lookup index that may match several entries; the project namespace and pre-split entries keep their existing `(type, id)` behavior.

## Impact

- **Store metadata** (`<store>/.rasen-store/store.yaml`): gains a version 2 shape carrying the UID. Version 1 files keep being read; version 2 is written only by explicit Store creation or an explicit upgrade command.
- **Project configuration** (`<project>/rasen/config.yaml`): the `store:` key accepts a structured value alongside the existing string form. Nothing machine-specific is ever written there.
- **Machine Store registry** (`~/.rasen/stores/registry.yaml`): gains a version 2 shape keyed by UID. Version 1 is read unchanged and rewritten only after an explicit mutation.
- **Code**: `src/core/store/foundation.ts`, `src/core/store/registry.ts`, `src/core/store/operations.ts`, a new Store identity resolver module, `src/core/project-config.ts`, `src/core/root-selection.ts`, `src/core/effective-config.ts`, `src/core/config-api/project-addressing.ts`, `src/core/relationship-health.ts`, `src/commands/store.ts`, `src/commands/doctor.ts`.
- **Commands**: `rasen store setup`, `rasen store register`, `rasen store list`, `rasen store doctor`, `rasen doctor`, `rasen config` (effective view), and every command that resolves a planning root through a Store pointer.
- **Docs and locales**: `docs/cli.md`, Store troubleshooting, the migration guide, JSON examples, the CLI completion registry, and the `en` / `zh-cn` / `ja` locale bundles.
- **Compatibility**: no data written by an earlier version becomes unreadable. The one intentional behavior break is the fail-closed rule above; it is called out in the migration guide with the repair command for each case.
