## Why

Phase E was designed whole and then split. E1 (`store-bootstrap-diagnose`)
shipped the read-only half: `rasen bootstrap` reads what the project and its
Stores declare, works out everything missing on this machine, and reports it —
writing nothing. Diagnosis alone leaves the user with a complete list of gaps
and no way to close any of them from the same command.

This change is the **project-first acting half** of Phase E. It closes every
gap that can be closed from what is **already on this machine**: it registers
the current project checkout, registers a present-but-unregistered Store the
user names a location for, prepares the project's local knowledge location as
empty base directories, writes the durable Store declaration when the project
asks for one, and re-verifies a Store's record of this project once that Store
becomes available through registration. A rerun rewrites nothing and reports
what was already in place. Nothing is retrieved from a remote, no checkout is
created, and no version-control operation runs, on any path, in any mode.

## What Changes

- **The bare invocation from a project checkout becomes apply.** Running
  `rasen bootstrap` with no mode flag from a project checkout registers the
  current checkout, registers each present-but-unregistered Store the user
  names a location for (consent-gated), prepares the knowledge location, and
  re-verifies membership once a Store is available. `--check` and `--dry-run`
  keep the meanings E1 gave them and stay read-only.
- **A Store that becomes available has its membership re-verified.** E1 reports
  a Store's membership as `unverifiable-here` when the Store is not on this
  machine. Once bootstrap registers that Store, its records become readable, so
  the membership answer moves from unknown to confirmed or not-recorded rather
  than staying at the answer E1 had to give.
- **Every declaration bootstrap writes is durable.** A declaration goes through
  `writeDurablePointer` — the single writer every other command uses —
  recording the permanent identity and the display name together, so surfaces
  that still compare on the name keep working. A bare display name is never
  written. A Store with no display name reports the limitation rather than
  writing a declaration that silently fails elsewhere.
- **Running it twice is safe and says so.** A rerun rewrites no identity,
  creates no duplicate registration, changes no recorded path, and re-imports
  nothing. JSON marks `already_registered` and `already_hydrated` so a caller
  can tell "did nothing because it was already right" from "did nothing because
  it failed". Drifted display names and remotes are reported and never
  auto-corrected.
- **`--yes` covers the project-first half only.** A blanket confirmation MAY
  register the Stores the project itself declares and names a location for,
  because the expected set comes from the user's own committed configuration
  and a scripted setup that stops halfway is unusable. It does NOT obtain —
  retrieving from a remote is E3 (`store-bootstrap-obtain`) — and it does NOT
  cover the Store-first flow at all.
- **Mutation is declared where a repair is constructed.** E1's
  `BOOTSTRAP_MUTATING_COMMANDS` prefix list is replaced by a `mutates` field on
  every command-shaped repair, set at the point of construction. The field
  governs **both** command channels — `repair[]` and `diagnostic.fix` — so a
  state-changing command cannot slip back in through the channel E1 proved was
  uncovered one round after writing the rule down.

Out of scope for this change and belonging to E3 (`store-bootstrap-obtain`):
obtaining or cloning a repository from a remote, the Store-first acting flow
(registering a Store's own checkout and obtaining its projects), clone target
creation, and failed-retrieval cleanup. Out of scope and belonging to E4
(`store-bootstrap-repair-text`): rewriting the failure text of ordinary
commands to name bootstrap, and the doctor readiness integration. Out of scope
for this release: moving knowledge between machines as an explicit bundle, and
resuming an in-flight run on another machine.

## Capabilities

### New Capabilities

None. The `store-bootstrap` capability was created by E1
(`store-bootstrap-diagnose`); this change deepens it.

### Modified Capabilities

- `store-bootstrap`: the project-first flow now acts on what is already local —
  registering the current checkout, registering a present-but-unregistered
  Store the user names a location for, preparing the knowledge location, and
  re-verifying membership after a Store becomes available. Two requirements E1
  deferred as vacuous (idempotent rerun, durable declaration writing) are added
  now that this change performs the writes they govern.

## Impact

- **Machine-local state**: the project checkout is registered through the
  existing project registry, and a present-but-unregistered Store is registered
  through the existing `rasen store register` path. The project's knowledge
  location is prepared as empty base directories under the machine data dir.
- **Project repository**: bootstrap may write the project's durable Store
  declaration, through `writeDurablePointer` — the same single writer
  `rasen store upgrade-identity` already uses — recording identity and display
  name together. This is the one write that lands in a Git-tracked file, and it
  is where the review attention concentrates.
- **Code**: extends `src/core/store/bootstrap.ts` (the report shape E1 landed
  gains an apply path), extends `src/commands/bootstrap.ts` (the bare
  invocation and consent handling), and replaces the `BOOTSTRAP_MUTATING_COMMANDS`
  prefix list with a construction-time `mutates` field on command repairs. No
  new command is added.
- **Commands**: the bare `rasen bootstrap` invocation gains meaning (apply, from
  a project checkout); `--yes` is added for the project-first consent path.
- **Docs and locales**: `docs/cli.md` gains the apply mode, the consent model,
  and the `--yes` scope; the `en` / `zh-cn` / `ja` CLI locale bundles gain every
  new message and state name.
- **Compatibility**: purely additive. A machine that already resolves everything
  reports exactly that and writes nothing. Nothing previously written becomes
  unreadable.
- **Depends on** E1's shipped report shape and classification
  (`src/core/store/bootstrap.ts`, frozen at `f11daa1d`), the single
  durable-declaration writer (`writeDurablePointer` in `upgrade-identity.ts`),
  the project registry (`registerProject`), the Store registration path
  (`registerExistingStore`), and the canonical knowledge home
  (`resolveProjectKnowledgeHome`) — all verified present before this was
  written.
