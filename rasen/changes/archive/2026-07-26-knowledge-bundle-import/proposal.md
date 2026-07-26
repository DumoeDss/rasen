## Why

A Store's knowledge is shared the moment someone clones the Store — it lives in Git. A project's own learned knowledge is not: it lives on the machine that learned it, under the project's identity, and a second machine that clones the same project starts empty. That is the correct default. `~/.rasen` is not a directory anyone should synchronize wholesale, and a project's knowledge is entangled with what a specific machine generated, owns, and can verify.

The explicit export and Store-transport route now produces a portable bundle, but the receiving machine still has no deliberate, conflict-safe way to validate and import it. This change completes that route: import the project's own knowledge on another machine, validate everything before writing, and stop rather than choose when local knowledge differs.

## What Changes

- **Import validates everything before it writes anything.** The bundle's version, its structure, whether the project identity is *this* project, and whether every record's content still matches its digest. A bundle for another project, a tampered record, or a version from the future is refused by name, and nothing is written.
- **Import never overwrites and never removes.** If the receiving machine already holds a record with the same identifier and different content, the whole import stops and names both sides — including the records that would have imported cleanly, because a half-applied bundle leaves a state the user cannot describe. Records already present and identical are reported as such and left byte-identical. Records the bundle does not carry are never removed or retired. A record retired on one side and active on the other is a conflict, not an overwrite.
- **`--dry-run` answers the whole question first.** It runs every check and every comparison, reports everything that would be added, everything already present, and *every* conflict rather than the first, and leaves no trace — so the user resolves conflicts once and then imports once.
- **Transport grants no ownership.** Importing a bundle that travelled through a Store produces the *project's* knowledge — no Store is recorded as a source, no scope is widened, nothing is published, and none of what publishing into a Store or promoting beyond one requires is satisfied by having arrived this way.
- **Import is one explicit command.** `rasen knowledge bundle import <bundle> --project <projectId|root> [--dry-run] [--json]` reports the same validation and classification facts in human and machine-readable output.

Out of scope: machine-preparation integration and declared-bundle confirmation (F4); any Phase E4 behavior; export or Store-transport redesign; interactive conflict reconciliation; portable run checkpoints; and automatic synchronization.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `portable-project-knowledge`: add four new requirements for complete validation, all-or-nothing conflict handling, project ownership after import, and a non-writing complete preview; no existing requirement is modified.

## Impact

- **Project knowledge:** import only ever adds records to the project's own stored knowledge. It never rewrites, retires, or removes one.
- **Store repositories:** importing a transported bundle writes nothing into any Store catalog, project record, metadata, membership, Git index, commit, or remote.
- **Code:** a new `src/core/knowledge-bundle/import.ts` that composes the landed strict reader, canonical project knowledge home, and learned-record persistence boundaries; plus the import subcommand under `src/commands/knowledge.ts`.
- **Commands:** `rasen knowledge bundle import <bundle> --project <projectId|root> [--dry-run] [--json]`.
- **Docs and locales:** import and conflict guidance, JSON examples, the explicit-export/import distinction, and the `en` / `zh-cn` / `ja` CLI locale bundles.
- **Compatibility:** purely additive. A machine that never imports behaves exactly as before.
- **Depends on:** the F1/F2 schema, reader, canonical serialization, path assertion, and Store transport already integrated at `d2549d87`; F3 has no Phase E dependency.
