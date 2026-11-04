# Open question: the API and CLI resolve a Store with different strictness

## What was found

Two code paths resolve "the same Store" through different helpers with
different health requirements:

- **API path** (`src/core/management-api/stores.ts:87`, `resolveStoreSpace`)
  calls `resolveStoreBinding` (`src/core/store/identity.ts:525`), which
  internally runs `inspectRegisteredStore` (`identity.ts:414/429/502`). That
  inspection requires a healthy `rasen/config.yaml` at the Store's own
  registered root — a Store missing that file is reported as unhealthy/absent
  rather than resolved.
- **CLI path** (`StoreIssuesModuleInstance` / `StoreAggregateQuery`, this
  child's `src/core/store/query/refs.ts` and `src/core/store/issues/`) goes
  through `resolveRegisteredStore` (`src/core/store/registry.ts`), which does
  **not** require that file.

## How this surfaced

It was not found by design review — it surfaced as a real test failure.
Child 2's shared `store-workspace-fixture.ts` never writes
`rasen/config.yaml` at the Store root (only real `rasen store setup` does,
via `ensureOpenSpecRoot`, `operations.ts:826`), and none of its other ~16
consumers ever took the API alias-resolution path, so nobody had noticed.
This child's `stores.test.ts` was the first consumer to exercise
`resolveStoreSpace` against that fixture, and it failed there.

## Disposition

**Fixed locally** in `stores.test.ts`'s own `beforeEach` (writes the missing
`config.yaml` for that suite's fixtures only) rather than in the shared
fixture, to avoid regression risk to the fixture's other ~16 landed
consumers in an already-shipped child.

**The underlying asymmetry itself is left as an open question, not fixed**
— out of scope for this child and possibly for this portfolio. It is
recorded here rather than left implicit in a test's `beforeEach`, where a
future reader would reasonably conclude the fixture was merely incomplete
rather than that two production code paths genuinely disagree about what a
healthy Store requires.

## Why it matters

A Store that works from `rasen store issue ...` on the command line can
refuse the equivalent call over the management API's aggregate endpoints,
purely because of which resolver each surface happens to call — not because
of any deliberate product decision recorded anywhere. Two readings are both
defensible and neither is currently the recorded truth:

- **Intentional**: the API surface deliberately demands a healthier root
  than the CLI does (a real product behavior worth documenting).
- **Unintentional**: a latent inconsistency between two resolution paths
  that happen to reach the same Store by different routes.

Whoever picks this up next should decide which it is and either document it
as a contract or converge the two paths — not leave the CLI and the API
quietly disagreeing about what "the Store is resolvable" means.

## The same shape as this portfolio's other expensive findings

This belongs to the same family as `assertStoreLockOrderAgreesWithWorkspace`
(task 7.5) and the wire-type mirror-absence gap (`evidence/wire-type-mirror-absence-mutation-proof.md`):
something that looks fine locally, passes everything it is asked, and is
only visible once you ask what it is actually enforcing versus what it
merely happens to agree with today.
