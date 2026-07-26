## Why

Learned knowledge today has two homes: a project's own, and machine-wide. There is nothing in between. A team that has worked out how something should be done in their shared context has no way to say "this belongs to our Store" — they either keep it in one project where nobody else sees it, or push it machine-wide where it applies to work it was never meant for.

Work exists that fills that gap: a Store catalog with real publication rules, reviewed and merged onto a stacked branch. It never reached the development line, and it cannot be brought over as it stands. It was written when a Store was identified by its display name and membership was inferred from whichever pointer happened to be nearby. Landing it unchanged would publish ownership records and content identity keyed on the one field this release makes explicitly renameable, and would decide who may publish from a pointer that answers a different question.

This change brings the catalog over on the identity and membership contracts the release now has.

## What Changes

- **A Store can own a catalog of learned knowledge.** Its member projects draw on it. The catalog lives in the Store's own repository alongside its planning content.
- **Everything durable names the Store permanently.** Records, ownership, and provenance identify the Store by its permanent identity; the display name travels alongside for readability and is never what anything is keyed on. Renaming a Store changes nothing already recorded, and ordering never depends on a name that can be renamed.
- **Records are versioned, and older ones keep working.** A record written by an earlier version stays readable; a newer shape is written only by an explicit migration or by a mutation the user performed. Reading a catalog never rewrites it.
- **Publishing into a Store requires independent evidence from its members.** The same project cannot satisfy the requirement twice, and evidence from a project the Store has no membership record for does not count. Who counts as a member comes from the Store's own records — not from which Store a project happens to plan in.
- **Promoting beyond a Store requires more than one project.** Machine-wide promotion needs independent evidence from at least two distinct projects, and the sources must be evidence for the same knowledge — sharing an identifier is not proof of that.
- **Approval is explicit and bound to its scope.** An approval for one Store never authorizes a wider scope, and is never inferred from a previous approval, from silence, or from the knowledge already existing somewhere narrower.
- **Catalog changes are exact and atomic.** A mutation touches only records the catalog declares it owns, never a file the user authored, writes atomically so an interruption leaves nothing half-written, and never stages or commits anything in the Store's repository.

Out of scope for this change: what a project actually receives from its own knowledge, its Stores, and machine-wide knowledge — that resolution, its conflict handling, and the files it generates are the sibling change that consumes this catalog.

## Capabilities

### New Capabilities
- `store-scoped-learned-skills`: a Store's own knowledge catalog — its permanent identity, versioned records, the evidence and approval required to publish into it or promote beyond it, and how its contents are mutated safely.

### Modified Capabilities

None. Every requirement is added against a new capability, which is what makes this change order-independent with respect to the learned-knowledge archive debt still outstanding elsewhere.

## Impact

- **Store repository**: gains a versioned knowledge catalog with managed records.
- **Code**: `src/core/learned-skills/{types,schema,stores,authority,mutate}.ts`, and the `rasen knowledge` command surface where publication and approval are performed.
- **Docs and locales**: `docs/retention-and-learned-skills.md`, `docs/cli.md`, JSON examples, and the `en` / `zh-cn` / `ja` CLI locale bundles.
- **Compatibility**: nothing previously written becomes unreadable. No behavior break — this change adds a scope that did not exist.
- **Depends on** the Store identity work (permanent identity, the single Store resolver) and the Store membership work (who counts as a member comes from the Store's records).
- **Adapts** source commit `5fa32300`, which is not on this development line. Its algorithm and test intent are preserved; its identity and membership plumbing is replaced.
