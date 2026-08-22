# Design — issue-revision-history-preservation

## Context

The portfolio row promised "replanning preserves run history: new/superseding nodes never
change old observations; superseded semantics truly consumed". Verification against the synced
truth first, because two of the three promises are already landed:

- **Gate exclusion is already symmetric.** `lifecycleAccounting`
  (`src/core/issue-acceptance/gate.ts:56`) excludes `cancelled` AND `superseded` from the
  required total as named exclusions with reasons; the spec pinned both lifecycles
  (issue-acceptance-close, "A superseded node is excluded and named") and
  `test/core/issue-acceptance/issue-acceptance-gate-lifecycle.test.ts:220` tests it. The
  seed's premise ("cancelled already works; superseded must too") is stale — nothing to
  build there, only sharper pins.
- **Ready-set exit is g-001 truth** — the closed exit vocabulary names superseded with its
  recorded reason; nothing to build.
- **The durable carry is genuinely missing.** `IssueAcceptedRecordV1`
  (`src/core/store/issues/types.ts:307`) freezes `gate: AcceptanceGateSnapshot`
  (completed/total/health/problemsStanding) but NOT the exclusions — an accepted Issue whose
  total shrank by a superseded node records `1/1` with no durable explanation; the
  exclusions exist only in each later read's evaluation.
- **The invariants are structurally true and pinned nowhere.** Observations derive per node
  from that node's own instance resolution + alias-keyed run-state location
  (`observeNode`); nothing in `publishPlan` touches run-state or other nodes' resolutions —
  so continuity holds by construction, and the retarget rule is forced by
  `verifyExecutionPlanReferences`' scope-conflict refusal
  (`src/core/store/issues/reference-verification.ts:213`: a node declaring a project/line
  its instance is not committed under is refused with `issue_reference_scope_conflict`) —
  a publishable retarget NECESSARILY carries a new instance. Truth without a pin is the
  fixture-coincides trap: this change's core deliverable is the pins.

The g-001 chain established the read surfaces' shape: the delta (`deriveRevisionDelta`) keys
retargets on stable nodeIds; prior revisions are immutable, ordinal-addressed, digest-verified,
and composed over by `confirm --revision`.

## Goals / Non-Goals

**Goals:**

- Continuity and lineage invariants as spec truth, pinned by tests that fail if any future
  change makes publishing disturb observations or blurs a retarget's lineage.
- The superseded exit verified total across consumers (ready-set, gate, history
  queryability) with the pins to keep it total.
- The acceptance record carrying its own arithmetic (exclusions with reasons), with
  byte-level compatibility for pre-field records and empty-exclusion accepts.

**Non-Goals:**

- No new CLI surface; no projection code change (the invariants are its existing behavior
  stated and pinned).
- No gate-logic change — the evaluation is correct; only the durable record gains the carry.
- No revision-delta vocabulary change (`lifecycleChanges` already names superseded
  transitions; the reason rides the current node line, not the delta).
- No alias-collision work (see Risks — the keying ledger item owns it).
- No Needs-Attention (g-003), no Issue #4 dogfood, no UI, no pipeline-registry, no versions.

## Decisions

### D1 — Invariants land as ADDED requirements on issue-status-projection, not a new capability

The continuity and lineage requirements constrain the projection's behavior and cite no
surface it does not own; a new capability whose every requirement governs another
capability's surface would fragment truth. Both requirements are ADDED (new concerns, no
existing requirement text changes) — the delta-op the specs instruction prescribes for
exactly this shape. Rejected: a new `issue-revision-history-preservation` capability (each
requirement would still cross-reference the projection or acceptance specs it constrains).

### D2 — The retarget rule is stated through the publication refusal, not a projection check

"A retargeted node starts a new observation lineage" is not enforced by new code: the
scope-conflict refusal at publication makes a publishable retarget carry a new instance by
construction, and the projection's per-node derivation (instance → resolution → alias →
run-state) then yields the lineage rule for free — the new node observes only its own
instance's evidence. The requirement pins the COMPOSITION of the two existing truths plus
the readability of the prior lineage (prior revision + delta retarget entry). The pin test
covers both halves: the refusal (old instance, new project → `issue_reference_scope_conflict`)
and the fresh read (new instance → not-started while revision N keeps the terminal fact).

### D3 — The exclusions carry is the plan-node suggestion-field precedent, exactly

`IssueAcceptedRecordV1` gains an optional `exclusions` field: absent when no exclusion stood,
omitted from `acceptedRecordDigestBody` in that case (so an empty-exclusion accept writes
bytes identical to the pre-field shape), included in the digest body when present.
`AcceptedRecordSchema` (`.strict()`) admits the field as optional — pre-field records parse
unchanged, their digests verify against bytes the field never touched, and an unrecognized
field is still refused. This is the discipline `store-issue-resources` pinned for
`suggestedPipeline`/`rationale`/`uncertainty` (absent omitted, digest stable) applied one
record kind over. `acceptIssue` writes the gate evaluation's `exclusions` verbatim
(`{nodeId, lifecycle, reason}` — already the evaluation's shape, no translation layer);
read surfaces that present the record (`store issue acceptance`, `show`'s acceptance block)
present the exclusions it carries, both forms. Rejected: a V2 record (a version bump for an
additive optional field spends migration surface the omission discipline makes unnecessary);
persisting `optionalNodes` too (optional nodes never shrink the total — the exclusion is the
only arithmetic that needs explaining).

### D4 — Pins first, and the pins must be seen to bite

Several pins assert behavior that is structurally true today and will pass on landing — that
is the deliverable, not a smell, BUT per the guard-tests-must-guard lesson each pin group
gets at least one mutation check: continuity (perturb one node's run-state between the two
readings and assert the pin DETECTS the change, proving it observes real evidence, not
tautology), lineage (retarget with the old instance and assert the publication refusal
fires, proving the rule has a teeth-path), durable carry (strip the field from a new record's
bytes and assert the digest refuses — the tamper path already pinned for the record, now
covering the new field). A pin that cannot be made to fail guards nothing.

### D5 — History queryability is composed from existing surfaces, stated in design, pinned in tests

The superseded node's history is queryable through three existing truths: its observation
stays on its node line in the current revision (P2), the delta names the lifecycle change
with stable nodeIds (P4), and the prior revision remains composable (`confirm --revision`
resolves any named revision; the files are immutable and digest-verified). No new surface is
added and none is needed; the pin reads the prior revision's composition and asserts the
superseded node's terminal fact survives there. If a future slice wants a first-class
history read, that is its own change — this one proves the record is already there.

## Risks / Trade-offs

- [Pins that pass immediately can rot into theater] → D4's mutation checks: each pin group
  demonstrates one way it fails, so a future regression (or a pin silently weakened in
  review) is visible.
- [The alias-collision hazard is real but out of scope] → Two distinct instances in
  different projects sharing one alias would key the same run-state files. Continuity still
  holds (the collision corrupts the NEW node's attribution, never the old node's
  observation), so the invariant pins honestly; the hazard itself is the claimant-alias
  keying ledger item (Phase-4 handover #3, g-003/LEAD) — named here so nobody mistakes this
  change's green pins for its resolution.
- [Optional field on a strict digest-covered record] → The omission discipline is proven on
  plan nodes; the byte-identity test (empty-exclusion accept == pre-field bytes) and the
  pre-field read-back test pin both compatibility edges. The persistent store's existing
  accepted records (Issues #1/#3) must read back unchanged — covered by the pre-field test
  and by never touching their bytes (temp-store dogfood only).
- [Confirm `--revision` over an old revision is the only composition seam] → The pin uses
  it as-is; if confirm's shape ever narrows, the lineage pins fail loudly rather than
  silently losing the history read.

## Migration Plan

None beyond the field: no stored bytes change for existing records; new accepts with no
exclusions produce byte-identical records to the pre-field shape; rollback is revert. The
persistent store is untouched by this change's tests (temp stores only).

## Open Questions

None blocking. The alias-collision hazard and the confirmation anchor remain open ledger
items with their owners (g-003/LEAD), explicitly not this change's.
