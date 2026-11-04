## Why

A Store's knowledge is shared the moment someone clones the Store — it lives in Git. A project's own learned knowledge is not: it lives on the machine that learned it, under the project's identity, and a second machine that clones the same project starts empty. That is the correct default. `~/.rasen` is not a directory anyone should synchronize wholesale, and a project's knowledge is entangled with what a specific machine generated, owns, and can verify.

But the default leaves no answer at all for the person who wants to carry their project's knowledge to a new laptop, or hand it to a colleague working on the same project. Today they either copy an internal directory by hand — which brings machine paths, ownership records for files that do not exist on the other side, and generated output along with it — or they lose the knowledge.

This change adds the deliberate route: export the project's own knowledge to one portable file, carry it however you like, import it on the other machine. It is explicit at both ends, it carries only what is portable, and when the receiving machine already knows something different it stops rather than choosing.

## What Changes

- **Export produces one portable file.** `rasen knowledge bundle export` reads the project's own stored knowledge and writes a single versioned bundle naming the project by its identity. It changes nothing it read, and it refuses to replace a file that is already at the destination.
- **A bundle contains a stated list of things and nothing else.** The schema version, the bundle's own identity, the project's identity, when it was created, the project commit it was captured against, and per record the identifier, the knowledge key, the content digest, the managed record, and its canonical content. **Not** machine paths, **not** the ownership records describing generated files on the exporting machine, **not** the generated files themselves, **not** tokens or sessions or run state. A record that cannot be represented without one of those fails the export by name instead of being written.
- **Only the project's own knowledge is exported.** Knowledge owned by a Store travels by cloning the Store; machine-wide knowledge is not a project's to carry. Neither goes into a project bundle.
- **Import validates everything before it writes anything.** The bundle's version, its structure, whether the project identity is *this* project, and whether every record's content still matches its digest. A bundle for another project, a tampered record, or a version from the future is refused by name, and nothing is written.
- **Import never overwrites and never removes.** If the receiving machine already holds a record with the same identifier and different content, the whole import stops and names both sides — including the records that would have imported cleanly, because a half-applied bundle leaves a state the user cannot describe. Records already present and identical are reported as such and left byte-identical. Records the bundle does not carry are never removed or retired. A record retired on one side and active on the other is a conflict, not an overwrite.
- **`--dry-run` answers the whole question first.** It runs every check and every comparison, reports everything that would be added, everything already present, and *every* conflict rather than the first, and leaves no trace — so the user resolves conflicts once and then imports once.
- **A Store may carry the file without owning the knowledge.** `--to-store` places the bundle into a Store repository as a file, at a location reserved for transported bundles. The Store's catalog, its project records, and its metadata are untouched; nothing is staged, committed, or pushed, and the files to commit are printed. On the other side, importing a bundle that travelled through a Store produces the *project's* knowledge — no Store is recorded as a source, no scope is widened, nothing is published, and none of what publishing into a Store or promoting beyond one requires is satisfied by having arrived this way.
- **Preparing a machine never imports a bundle on its own.** Only when the project's own configuration or a Store's record for the project names a bundle does preparation list the import — as its own action, separate from obtaining and registering, and only on confirmation. A blanket confirmation covers a bundle the user's own committed configuration names; a bundle named only by a Store's record is listed and requires an explicit choice. A declared bundle that is missing degrades with its repair rather than stopping preparation.

Out of scope: where a project's knowledge lives on a machine and the migration of existing per-clone catalogs, which is the learned-knowledge change this one consumes; and carrying an in-flight run to another machine, which is not in this release.

## Capabilities

### New Capabilities

- `portable-project-knowledge`: moving a project's own learned knowledge between machines as an explicit bundle — what a bundle may and may not contain, how it is validated before anything is read from it, why a conflict stops the import instead of overwriting, why the route a bundle travelled grants no ownership or scope, and the one place preparing a machine may import one.

### Modified Capabilities

None. Every requirement is added against a new capability, so this change is order-independent with respect to the rest of the portfolio and to the archive debt still outstanding elsewhere.

## Impact

- **Project knowledge**: import only ever adds records to the project's own stored knowledge. It never rewrites, retires, or removes one.
- **Store repositories**: a Store may receive a bundle *file*. Nothing a Store owns is written, and nothing is staged, committed, or pushed.
- **Code**: a new `src/core/knowledge-bundle/` (bundle schema, export, import planning, validation) and new `bundle export` / `bundle import` subcommands under `src/commands/knowledge.ts`, plus the bundle step in the machine-preparation flow and the CLI completion registry.
- **Commands**: `rasen knowledge bundle export`, `rasen knowledge bundle import`, and one additional reported action in the machine-preparation command.
- **Docs and locales**: `docs/cli.md`, `docs/retention-and-learned-skills.md`, the migration guide, JSON examples, and the `en` / `zh-cn` / `ja` CLI locale bundles. The release notes must state the three-way distinction plainly: Store knowledge is shared by cloning the Store, a project's knowledge is machine-local by default, and it crosses machines only through an explicit export and import.
- **Compatibility**: purely additive. No existing file changes shape, and a machine that never exports or imports behaves exactly as before.
- **Depends on** the project knowledge location and record identity introduced by the learned-knowledge resolution change, the Store catalog and promotion rules of its sibling, the Store identity resolver, and the machine-preparation command for the declared-bundle step. Each dependency sits behind a single seam that reports rather than fails when it has not landed.
