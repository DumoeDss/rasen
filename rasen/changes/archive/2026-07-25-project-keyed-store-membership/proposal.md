## Why

A Store knows which projects belong to it only by accident. Membership is inferred from three unrelated things: a `project:<alias>` entry in the Store's `references:` list (really a documentation-index feature), an `adoptions.yaml` map (really an ownership record for undoing a migration), and each repo's own `store:` pointer (really the project's default planning binding). None of them is keyed by the project's actual identity, so two projects that happen to share a display name collide, two machines adding two different projects edit the same YAML map and conflict, and a project cannot say "I also draw knowledge from that other Store" at all.

Worse, `adoptions.yaml` records an absolute path from whichever machine ran the adoption — inside a file that lives in the Store's Git repository. On any other machine that path is wrong, and `store eject` follows it, which means eject can restore a project into a directory that has nothing to do with the current machine.

This change gives a Store one authoritative membership record per project, keyed by the project's permanent identity, in its own file; lets a project carry portable locator hints so a fresh clone can find the Stores it belongs to; and removes the machine-specific path from Git entirely, replacing eject's path guess with explicit resolution.

## What Changes

- **A Store records each member project in its own file.** `<store>/.rasen-store/projects/<projectId>.yaml` is the single authority for "does this project belong to this Store". The file is named and keyed by the project's permanent identity; the display id is for reading, and a credential-free remote lets another machine find the project. One file per project means two people adding two different projects never touch the same file.
- **Membership states what it is FOR.** A record declares planning membership and knowledge membership separately, so "this project plans in the Store" and "this project shares knowledge with the Store" stop being the same claim. Membership expresses roster and eligibility only — it never decides where a change gets implemented.
- **A project carries portable hints about the Stores it belongs to.** A new `storeMemberships` list in the project's config names each Store by permanent identity, alias, and remote, so a fresh clone of the project can discover its Stores. These hints are locators, never authority: the Store's own record decides membership, and a hint that disagrees is reported as drift.
- **Membership has one reader.** Every surface that asks "who belongs to this Store" or "which Stores does this project belong to" gets the same answer from one provider, including for Stores that still carry only legacy data. Legacy `references: project:<alias>` entries, `adoptions.yaml` entries, and the project namespace registry are normalized into the same answer, each labelled with where it came from.
- **Binding where a project plans stays a separate, explicit choice.** `store add-project` adds a project to a Store's roster without changing where that project plans. A dedicated opt-in, off by default and never inferred, additionally records the target Store as the project's planning Store — and refuses rather than overwrites when the project already plans somewhere else, naming what is bound and how to rebind deliberately.
- **`store add-project` and `store adopt` write membership in a defined order across two repositories.** The Store's authority record is written and verified first, then the project's locator hint. The two repositories cannot be changed atomically, so the result reports exactly what was written to each and what still needs repair — and a failure after the Store record is written never rolls that record back.
- **The machine-specific path leaves the Git-shared schema. BREAKING** `adoptions.yaml`'s `sourcePath` is no longer written, and no command reads it. Existing files stay readable and are reported as containing a machine path until migrated.
- **`store eject` resolves its destination explicitly.** In order: an explicit `--into`, else the current checkout when its project identity matches, else the machine registry's single live checkout for that project. Several candidates, or none, is an error naming `--into` — never a guess from a path recorded on another machine, an alias, a remote, or "the first one".
- **A migration converts legacy membership into records.** `rasen store migrate-membership <store>` previews and then applies the conversion, keeping the legacy data until the new records are written and verified.
- **`rasen doctor` diagnoses membership.** Missing Store record for the project's planning Store, missing project-side locator, an unverifiable locator, and any machine path still present in Git-shared data — each read-only, each with a copy-pasteable repair.

Out of scope for this change (later work in this series): session runtime context and ActionContext; learned-knowledge scope, precedence, and ledgers; the bootstrap clone/register flow; portable knowledge bundles.

## Capabilities

### New Capabilities
- `store-project-membership`: the per-project membership record inside a Store, the roles it expresses, the project-side locator hints, the single provider that answers membership for current and legacy data alike, the ordered two-repository mutation with its repair reporting, the legacy migration, and the membership diagnostics.

### Modified Capabilities
- `store-add-project`: also writes the Store's authority record and the project's locator hint, in a defined order, and reports what each repository still needs.
- `store-adopt`: records ownership in the project's membership record instead of a shared map, and stops recording the source repo path.
- `store-eject`: takes ownership from the membership record, and resolves its destination explicitly instead of following a path recorded on another machine.
- `planning-space-addressing`: a Store's member list is derived from the membership provider, so a member recorded in the Store appears even when its repo does not point at that Store.

## Impact

- **Store repository**: gains `<store>/.rasen-store/projects/<projectId>.yaml`. `adoptions.yaml` becomes read-only legacy and is removed by the migration once its records are written and verified.
- **Project repository**: `rasen/config.yaml` gains an optional `storeMemberships` list. Nothing machine-specific is written there.
- **Code**: new `src/core/store/project-records.ts` and `src/core/store/membership.ts`; `src/core/store/migration.ts`, `src/core/store/migration-ops.ts`, `src/core/store/operations.ts`, `src/core/references.ts`, `src/core/project-config.ts`, `src/core/relationship-health.ts`, `src/core/management-api/spaces.ts`, `src/commands/store.ts`, `src/commands/doctor.ts`.
- **Commands**: `rasen store add-project`, `rasen store adopt`, `rasen store eject`, `rasen store doctor`, the new `rasen store migrate-membership`, `rasen doctor`, and the spaces listing behind `rasen ui`.
- **Docs and locales**: `docs/cli.md`, Store troubleshooting, the migration guide, the agent contract, JSON examples, the CLI completion registry, and the `en` / `zh-cn` / `ja` locale bundles.
- **Compatibility**: every legacy file stays readable. The intentional breaks are that `sourcePath` is no longer written or read, and that eject asks for `--into` where it previously guessed — both documented in the migration guide with the exact repair.
- **Depends on** the Store identity work: Stores are resolved through the single identity resolver, and membership records name Stores by permanent identity.
