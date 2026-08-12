## Why

The flat Store layout can contain cross-project coordinator Changes that are not honestly owned by any one member project, but the current layout migration can only place every Change and Archive entry into a project partition. Rasen 0.1.7 now has Store-level Issues and Execution Plans, so the migration needs an explicit, auditable way to preserve coordinator intent without inventing project ownership, completion, acceptance, or execution history.

## What Changes

- Add a strict version 2 migration mapping whose work-item declarations distinguish `project-change` from `store-issue`, while preserving version 1 parsing, evidence resolution, immutable plan schema, canonical bytes, and plan ids unchanged for every existing path. Plan schema version 2 is emitted only when a version 2 mapping actually requires explicit materialization that schema version 1 cannot represent.
- Continue to honor recorded project identity and trustworthy single-project evidence as `project-change`; require an explicit version 2 declaration for every unresolved or conflicting work item, without inferring coordinator status from names, paths, branches, session cwd, or member ordering.
- Materialize explicitly classified coordinators as standard Store Issue records and, when a clean digest-bound plan input is supplied, one standard immutable Execution Plan v1 revision. An active source always imports open; an archived source requires an explicit valid state, and any terminal import requires a rationale, with no inferred acceptance.
- Keep the legacy coordinator tree intact until whole-ref publication succeeds, never copy that tree into the Issue, and make retirement recoverable from committed Store Git provenance recorded in the migration receipt. Untracked or ignored source bytes block conversion because they cannot be recovered from Git.
- Include generated Issue content in the existing all-or-nothing migration plan, no-clobber publication, layout-version flip, recovery, rollback, and separate retirement flow. Before generated-destination revalidation, apply derives every canonical Issue key from the frozen plan, deduplicates and byte-sorts the batch, acquires those keys through the existing Issue lock abstraction, and only then acquires the Store/ref migration-run lock. It holds both through generated publication, receipt, layout flip, and the final durable manifest update, so ordinary Issue create/state/plan writes cannot change planned bytes inside the publication window. Every destination rename also has a durable prepared operation recorded before rename and a completion mark after rename, so process-restart reconciliation can prove run ownership by run identity and digest without deleting unknown content. No force, subset migration, manual move, dual write, second Issue-lock implementation, separate IssueStore, or standalone legacy-import command is introduced.
- For ordinary direct-selector archive planning only, when `rasen archive <legacy-alias>` can no longer find a real v2 Change but a receipt proves that alias became an Issue, return a stable actionable diagnostic pointing to the existing Issue commands. Token-owned `--apply-plan` and `--abort-plan` routes keep their existing early dispatch and option-conflict precedence; archive outcome, reason, token, commit, and other finalization options are never forwarded to an Issue.
- Preserve human/JSON diagnostic parity, v1 receipt readability, ref isolation, and cross-platform path behavior throughout the compatibility bridge.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `store-layout-v2-migration`: Add explicit coordinator classification, generated Issue outputs, Store-source provenance, safe retirement, and recovery behavior to the whole-ref layout migration.
- `store-issue-resources`: Define the constrained migration import that produces only the existing Issue record and optional Execution Plan v1 contracts without expanding live Issue semantics.
- `cli-archive`: Report that a proven legacy coordinator became an Issue without redirecting or translating Change finalization into Issue state or acceptance.

## Impact

- Affects layout-migration mapping, version-dispatched plan and output types, Issue validation/serialization reuse, the existing Issue-lock abstraction's batch acquisition seam, staging and verification, durable recovery operations, receipts and diagnostics, and the ordinary direct-selector archive lookup failure seam.
- Extends committed migration receipts while retaining readers for existing receipt schema versions.
- Adds migration, Issue, archive-compatibility, fault-injection, cross-platform path, encoding, multi-ref, and real Store fixture coverage.
- Does not change the public Store Issues interface, the runtime Issue or Execution Plan schemas, member-project repositories, Change finalization contracts, Pipeline ownership, or future Planning Kernel, Dispatch, Reconciler, Acceptance, or Board behavior.
