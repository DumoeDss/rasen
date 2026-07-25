## Why

Typed project, store, and global catalogs are not useful to future agents until
Rasen can derive one safe effective skill set for each project. A many-to-many
store graph also makes “take the first store” unacceptable: precedence,
equivalent copies, conflicts, and ownership must be deterministic before any
tool directory is changed.

## What Changes

- Discover every healthy registered store that explicitly contains the resolved
  project, without treating the planning store or config-inheritance pointer as
  an exclusive knowledge parent.
- Resolve active applicable skills with deterministic
  `project > store > global` precedence.
- Deduplicate store copies only when their stable knowledge identity and
  canonical content are exactly equivalent; refuse byte/content-divergent store
  copies with a complete typed conflict diagnostic instead of selecting a store
  by registry, path, or iteration order.
- Represent effective winners and all contributing canonical identities in a
  typed materialization plan and ledger, including multiple equivalent store
  sources.
- Reconcile project-local tool homes from the effective project set while
  preserving exact ownership, local modifications, context budgets, and
  failure-safe cleanup behavior.
- Restrict global-only tool homes such as Hermes to active global knowledge
  through the machine-global ledger, independent of project/store
  applicability and membership.
- Migrate existing learned-skill ledger entries conservatively without
  weakening workflow-artifact ownership or deleting unverified files.
- Surface effective-set additions, updates, removals, deduplication, conflicts,
  unavailable stores, and global-only skips through `rasen init` and
  `rasen update`.
- Consume the predecessor context and scope APIs as-is; this slice does not
  reimplement owner resolution, store persistence, membership eligibility, or
  promotion policy.

## Capabilities

### New Capabilities

- `learned-skill-effective-materialization`: Effective store discovery,
  applicability, precedence, equivalent-copy handling, conflict refusal, typed
  materialization ownership, and project-local/global-only reconciliation.

### Modified Capabilities

- `cli-init`: Initial tool setup materializes the resolved project/store/global
  effective set and reports deterministic store conflicts and restrictions.
- `cli-update`: Reconciliation refreshes and prunes typed effective-set copies,
  migrates legacy learned entries conservatively, and reports deferred cleanup
  when a source cannot be safely evaluated.

## Impact

- Code: learned-skill read resolution, store membership reverse discovery,
  applicability/budget planning, materialization rendering/reconciliation,
  project and global learned ledgers, init/update orchestration and messages.
- Data: a versioned typed project-local learned-materialization ledger capable
  of recording multiple source identities; existing workflow ledger and
  machine-global global-only ledger remain compatibility inputs.
- Behavior: project-local homes may now receive store-shared guidance; any
  effective store conflict blocks reconciliation before filesystem writes.
- Safety: deletions remain exact ledger-and-digest operations; unavailable
  previously contributing stores defer destructive cleanup rather than making a
  transient outage look like retirement.
- Tests/docs: many-to-many discovery, precedence matrix, applicability fallback,
  equivalent store copies, order-independent conflicts, ledger migration,
  degraded stores, Hermes/global-only behavior, locale parity, and Windows
  paths.
