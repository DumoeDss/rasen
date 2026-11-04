## Why

Everything this release built is declarative: a project records which Store it plans in, which Stores it belongs to, and how to reach each one. On the machine where that was set up it all resolves. On a fresh machine it resolves to nothing — the declarations are correct, but no Store has been cloned, nothing is registered, and no local binding exists.

Right now the user is told what is broken one failure at a time. Run a command, get told a Store is not available. Register it. Run again, get told a second Store is missing. Register that. Run again, get told the current checkout is not registered. There is no way to ask "what does this machine need before this project works?" and get the whole answer at once, and no single command that does it.

This change adds that command. It reads what the project and the Stores declare, works out everything missing on this machine, and either reports the complete repair plan or — only when asked — carries it out.

## What Changes

- **One command answers "what does this machine still need?"** `rasen bootstrap` reads the project's identity, its planning Store, and its Store membership hints, works out which Stores are expected, and reports the state of each: already available, cloned but not registered, reachable and clonable, or unreachable because nothing says where it lives.
- **Asking is completely separate from acting.** `--check` reads and reports and does nothing else — no clone, no registration, no identity minted, nothing written. `--dry-run` goes further and resolves remotes and the exact target paths it would use, but still creates no directory, runs no git, and writes nothing. Two different promises, each stated on its own.
- **Starting from a project clone works.** From a freshly cloned project, bootstrap verifies the project's identity, resolves every Store it declares, registers this checkout, confirms each Store actually records this project as a member, prepares the project's local knowledge location, and reports whether the result is complete, degraded, or blocked.
- **Starting from a Store clone works too, without dragging everything else down.** From a Store, bootstrap verifies the Store, registers it, and lists the projects it holds — which are already on this machine and which could be obtained. It clones a project only when the user explicitly picks one or names a path. **It never clones every project a Store contains.**
- **Where a clone lands is decided by explicit rules.** An explicitly given path wins; otherwise a given parent directory plus a safe name derived from the source; otherwise the user is asked. Bootstrap never clones into a directory that already has contents, never overwrites an existing checkout, never takes a path recorded by another machine, and never builds a command line by pasting a remote into a shell.
- **A failed clone is not cleaned up on a guess.** Bootstrap removes a partial clone only when it can show the directory was created by this run and is safe to remove. Anything else is left in place and reported.
- **Running it twice is safe and says so.** A rerun against the same identity and the same checkout rewrites no identity, adds no duplicate registration, moves nothing, and re-imports nothing; it reports what was already in place. A display name or remote that has drifted is reported, never quietly corrected.
- **Ordinary commands point at bootstrap instead of leaving the user stuck.** A project whose Store is declared but not available on this machine fails with the reason and names bootstrap as the repair. A Store declared without any way to locate it fails asking for a path or a remote. A checkout that turns out to be a different Store fails without writing anything.
- **Diagnosis stays read-only.** `rasen doctor` reports bootstrap readiness across the full check list with copy-pasteable repairs, and changes nothing.

Out of scope for this change: moving knowledge between machines as an explicit bundle, which is the following change; and resuming an in-flight run on another machine, which is not in this release.

## Capabilities

### New Capabilities
- `store-bootstrap`: preparing a machine to work on a project — what bootstrap reads, what it reports, the separation between checking and acting, the project-first and Store-first flows, how a clone target is chosen and what is forbidden, idempotence on rerun, and the bootstrap-readiness diagnostics.

### Modified Capabilities

None. Every requirement is added against a new capability, so this change is order-independent with respect to the rest of the portfolio and the archive debt still outstanding elsewhere.

## Impact

- **Machine-local state**: registrations and local bindings are created by explicit action only; the project's knowledge location is prepared as empty base directories.
- **Project repository**: bootstrap may write the project's durable Store declaration when the user asks it to, through the same single writer every other command uses.
- **Code**: a new `src/core/store/bootstrap.ts` and `src/commands/bootstrap.ts`, plus `src/core/store/operations.ts`, `src/core/project-home.ts`, `src/core/project-registry.ts`, `src/core/root-selection.ts`, `src/core/relationship-health.ts`, `src/commands/doctor.ts`, and the CLI completion registry.
- **Commands**: the new `rasen bootstrap`, `rasen doctor`, and the failure messages of every command that resolves a Store.
- **Docs and locales**: `docs/cli.md`, a bootstrap troubleshooting section, the migration guide, JSON examples, and the `en` / `zh-cn` / `ja` CLI locale bundles.
- **Compatibility**: nothing previously written becomes unreadable, and bootstrap is additive — a machine that already resolves everything reports exactly that and changes nothing.
- **Depends on** the Store identity work (the single resolver, the durable declaration writer), the Store membership work (a Store's own record of which projects belong to it), and the project knowledge location introduced by the learned-knowledge work.
