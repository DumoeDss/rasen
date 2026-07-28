## Why

A Store's knowledge is shared the moment someone clones the Store — it lives in Git. A project's own learned knowledge is not: it lives on the machine that learned it, under the project's identity, and a second machine that clones the same project starts empty. That is the correct default. `~/.rasen` is not a directory anyone should synchronize wholesale, and a project's knowledge is entangled with what a specific machine generated, owns, and can verify.

But the default leaves no answer at all for the person who wants to carry their project's knowledge to a new laptop, or hand it to a colleague working on the same project. Today they either copy an internal directory by hand — which brings machine paths, ownership records for files that do not exist on the other side, and generated output along with it — or they lose the knowledge.

This change adds the first half of the deliberate route: export the project's own knowledge to one portable file and carry it however you like. It is explicit, and it carries only what is portable.

## What Changes

- **Export produces one portable file.** `rasen knowledge bundle export` reads the project's own stored knowledge and writes a single versioned bundle naming the project by its identity. It changes nothing it read, and it refuses to replace a file that is already at the destination.
- **A bundle contains a stated list of things and nothing else.** The schema version, the bundle's own identity, the project's identity, when it was created, the project commit it was captured against, and per record the identifier, the knowledge key, the content digest, the managed record, and its canonical content. **Not** machine paths, **not** the ownership records describing generated files on the exporting machine, **not** the generated files themselves, **not** tokens or sessions or run state. A record that cannot be represented without one of those fails the export by name instead of being written.
- **Only the project's own knowledge is exported.** Knowledge owned by a Store travels by cloning the Store; machine-wide knowledge is not a project's to carry. Neither goes into a project bundle.
- **A non-writing reader validates the format before any later writer can consume it.** The reader enforces the same strict versioned schema, explicit permitted-field list, and all-platform machine-path assertion as the exporter, while writing nothing.

Out of scope: Store transport; bundle import, preview, conflict handling, and ownership-on-import; machine-preparation integration; where a project's knowledge lives on a machine and migration of existing per-clone catalogs; and carrying an in-flight run to another machine.

## Capabilities

### New Capabilities

- `portable-project-knowledge`: the closed field contract for producing a portable bundle of a project's own learned knowledge, including the guarantee that no machine-owned or transient state travels in it.

### Modified Capabilities

None. The bundle-field requirement is added against a new capability; the broader export-and-import requirement remains whole for a later child.

## Impact

- **Project knowledge**: export reads the project's own stored knowledge and leaves every source byte-identical.
- **Filesystem**: a successful export creates exactly one new file at the user-specified destination; an occupied destination or any other failure creates no file.
- **Code**: a new `src/core/knowledge-bundle/` containing the strict schema, validating non-writing reader, machine-path assertion, and export; plus the export subcommand under `src/commands/knowledge.ts` and the CLI completion registry.
- **Commands**: `rasen knowledge bundle export --project <projectId|root> --to <path> [--json]`.
- **Docs and locales**: relevant export documentation, examples, migration guidance, and the `en` / `zh-cn` / `ja` CLI locale bundles.
- **Compatibility**: purely additive. No existing file changes shape, and a machine that never exports behaves exactly as before.
- **Depends on** the project knowledge location and record identity introduced by the learned-knowledge resolution work.
