## Why

Today a project exists in exactly one of two shapes: a single-project in-repo root (its `rasen/specs` and `rasen/changes` live inside the project's own repo) or a store (a standalone Rasen repo registered on this machine and shared across projects via `--store` and the `references:` index). There is no supported path to let a store share-read the specs of an in-repo project without moving that project's planning out of its repo. Teams that keep a project in-repo but want its specs to inform work happening in a shared store currently have to choose one shape or the other. This change adds a non-destructive bridge: register the in-repo project as a store and wire an existing store to reference it, so the store's instructions carry an index of the project's specs while the project's in-repo workflow keeps working unchanged.

## What Changes

- **New `rasen store add-project <path> --to <store-id>` command.** In one step it (a) registers the project at `<path>` as a store on this machine if it is not already registered, and (b) appends that project's store id to the target store's `rasen/config.yaml` `references:` list. The target store then indexes the project's specs through the existing referenced-store mechanism.
- **Non-destructive to the in-repo project (HARD requirement).** The only artifact written inside the project repo is `.rasen-store/store.yaml` (store identity metadata). The project's `rasen/specs`, `rasen/changes`, and existing config are never rewritten, moved, or deleted. The in-repo project continues to resolve as a `nearest` root and run every command exactly as before.
- **Idempotent and additive.** Re-running against an already-registered project and an already-present reference is a no-op that reports success. Appending to `references:` de-duplicates and preserves every other field of the target store's config.
- **Guidance surfaced, not enforced.** The command reports whether the new `.rasen-store/` metadata should be committed or gitignored (cross-machine teammate resolution relies on it being present in the checkout) and points the user at `rasen store setup <id>` when they want to create a brand-new store to add the project to.
- No version bumps; backward compatible. Existing `store register`, `store setup`, and referenced-store index behavior are unchanged.

## Capabilities

### New Capabilities
- `store-add-project`: The composite verb that registers an in-repo project as a store and adds it to a target store's referenced-store list, with a non-destructive guarantee for the project repo and idempotent, field-preserving config edits.

### Modified Capabilities
<!-- No existing capability's REQUIREMENTS change. store-registration's inspect/register contract is reused as-is; the referenced-store index (assembled from a resolved root's config `references:`) is reused as-is. A store root already resolves through the same makeRoot() path as an in-repo root, so index assembly over a store root is an existing-contract verification (covered by a task/test), not a requirement change. -->

## Impact

- **New code**: a `store add-project` subcommand in `src/commands/store.ts`; a core operation (in `src/core/store/operations.ts` or a sibling module) that composes `registerExistingStore` with a config-`references:` append helper; a raw-YAML round-trip writer for `rasen/config.yaml` following the established pattern in `src/core/archive.ts` (read raw YAML, mutate one field, `stringifyYaml` back, preserving other fields).
- **Completions**: a new `add-project` entry under the `store` group in `src/core/completions/command-registry.ts`.
- **Reused unchanged**: `registerExistingStore` / `registerStore` (`src/core/store/registry.ts`, `operations.ts`), `assembleReferenceIndex` and `parseDeclarationList` (`src/core/references.ts`, `src/core/project-config.ts`), `resolveOpenSpecRoot` / `makeRoot` (`src/core/root-selection.ts`).
- **Not touched**: the machine-wide project registry (`src/core/project-registry.ts`) and its `ProjectMode` — keeping it untouched is the most non-destructive, backward-compatible choice; a project that becomes a store gains a store-registry entry, not a project-registry mode change.
- **Out of scope**: federated/union spec resolution (a store showing an in-repo project's specs as its own in `rasen list --store`). Sharing is index-level only.
