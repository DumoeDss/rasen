## Why

Once a project can draw knowledge from its own record, from the Stores it belongs to, and from machine-wide knowledge, something has to decide which one it actually gets — and that decision is where the damage happens if it is done casually. Picking whichever Store the registry listed first, or whichever name sorts earliest, produces a winner chosen by accident. Treating a Store that is merely unreachable as a Store with nothing in it deletes generated files the user is still relying on.

Work exists that gets this right: applicability first, then the project's own record, then every eligible Store considered together — byte-identical copies collapsing into one answer that records all its sources, genuinely different ones reported rather than resolved. It was reviewed and merged onto a stacked branch and never reached the development line.

It cannot be brought over as it stands. It records ownership and content identity keyed on a Store's display name, which this release makes renameable. It asks the current directory what project it is in, which is wrong the moment there are two clones or a worktree. And it stores a project's knowledge under whichever clone the command ran in, so one project ends up with two catalogs on one machine depending on where you were standing.

## What Changes

- **What a project receives is resolved in one stated order.** Knowledge that does not apply is filtered out first. Then the project's own record wins. Failing that, every Store the project is eligible for is considered together. Machine-wide knowledge fills only what is left.
- **Eligibility comes from the Stores themselves.** A project is eligible for the Stores it declares and the locally available Stores whose records include it — never for a Store merely because that is where the project plans.
- **Nothing wins by accident.** Registry order, planning-Store priority, and alphabetical order of display names are explicitly not tie-breakers. Two copies count as the same only when their identifier, key, exact bytes, and content digest all match and both are validly managed.
- **Genuinely different copies are reported, not resolved.** A conflict names every participant and reads the same regardless of the order they were considered in. With the project's own record winning it is recorded and resolution continues; without one it stops learned-knowledge reconciliation and writes nothing partial — no half-written files, no half-written records. Ordinary workflow generation is unaffected either way.
- **A Store that cannot be reached is not an empty Store. BREAKING** Its knowledge is reported as temporarily unavailable and any cleanup that would remove what it previously provided is deferred. Previously an unreachable Store could read as one with nothing in it, which silently deleted generated files.
- **A project's knowledge lives in one place per project, not one per clone. BREAKING** Canonical project knowledge moves to a location keyed by the project's identity, so two clones and any number of worktrees share one catalog. Where knowledge applies is still decided in the checkout being worked on, and generated files still land in that checkout — three different things that were previously one.
- **Moving existing catalogs is explicit, previewable, and never destructive.** The migration moves a single catalog, deduplicates identical ones, and reports genuinely different ones as a conflict without choosing a winner or deleting anything. Nothing old is removed until the new location is written and read back.
- **Generated files are tracked by exact ownership, keyed permanently. BREAKING** Ownership records name their sources by permanent identity and record what was written. A file is only touched when the record claims that exact path, the file still matches, and the source is still verifiable. Existing records naming a display name are detected, previewed, and upgraded when the mapping is unambiguous — and block when it is not, rather than dropping provenance.
- **Content identity excludes the display name. BREAKING** A rename can no longer look like a content change, and the change of identity scheme is reported as a migration rather than presented as edited content.

Out of scope for this change: the Store catalog itself and what may be published into it — that is the sibling change this one consumes. Also out: the fresh-machine bootstrap flow and cross-machine knowledge bundles.

## Capabilities

### New Capabilities
- `learned-skill-effective-materialization`: what a project actually receives — applicability filtering, the project/Store/global order, equivalence and conflict between Stores, unavailable Stores, ownership records for generated files, content identity, and when the resolved set is written into a checkout.
- `project-knowledge-home`: one canonical knowledge location per project identity, its separation from where applicability is decided and where files are generated, and the conflict-safe migration of existing per-clone catalogs.

### Modified Capabilities

None. Every requirement is added against a new capability, which is what makes this change order-independent with respect to the learned-knowledge archive debt still outstanding elsewhere.

## Impact

- **Machine-local state**: canonical project knowledge moves to a per-project-identity location; ownership records gain a version and permanent-identity sources.
- **Code**: `src/core/learned-skills/{context,effective}.ts`, `src/core/learned-skill-materialization.ts`, `src/core/project-learned-skill-ledger.ts`, `src/core/global-learned-skill-ledger.ts`, a new `src/core/project-knowledge-home.ts`, `src/core/init.ts`, `src/core/update.ts`, `src/commands/knowledge.ts`.
- **Commands**: `rasen knowledge`, `rasen init`, `rasen update`.
- **Docs and locales**: `docs/retention-and-learned-skills.md`, `docs/cli.md`, the migration guide, JSON examples, and the `en` / `zh-cn` / `ja` CLI locale bundles.
- **Compatibility**: existing records stay readable; every upgrade is detected, previewable, and blocks rather than guesses when ambiguous. The four intentional breaks above are each documented with their migration.
- **Depends on** the Store identity work, the Store membership work, the session runtime context work (applicability is decided in the recorded checkout), and the sibling Store-catalog change whose catalog this resolves against.
- **Adapts** source commit `48142395`, which is not on this development line. Its algorithm and test intent are preserved; its identity, membership, and root plumbing is replaced.
