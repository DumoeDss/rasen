## Context

g-001 shipped the publication channel and froze the plan-node schema by
decision: nodes carry identity and edges, nothing else, and the channel
writes only the revision file (`issue-plan-publication` design D3/D6). Phase
2's roadmap demands the four lifecycle states — `required`, `optional`,
`cancelled`, `superseded` — respected through projection, gate, and health,
with re-publication preserving history. Today every Change node counts toward
progress, holds the gate, and is launchable; there is no way to say "this
child was dropped" or "this work is nice-to-have".

Current shapes this change builds on:

- Node schema (`src/core/store/issues/plans.ts`): strict Zod objects, two
  kinds, `dependsOn` canonicalized at publication, digest body enumerating
  fields explicitly with `changeAlias` included only when present — the
  pattern a new optional field must follow for digest stability.
- Projection (`src/core/issue-status/projection.ts`): `derivePhase` /
  `deriveHealth` over per-node observations; progress = terminal observations
  over all change nodes; the spec's axes requirement already speaks of
  "required nodes" — Phase 1 wrote the vocabulary forward-compatibly.
- Gate (`src/core/issue-acceptance/gate.ts`): iterates the projection's node
  statuses; `assertCoherentGateSnapshot` already permits total 0
  (`completed === total` holds at `0/0`).
- Binding (`src/core/issue-execution/binding.ts`): frontier resolution and a
  closed refusal taxonomy.
- M-1 pin (g-001 fix round 1): active+archived copies of ONE instance resolve
  by name at the channel layer, then the under-lock instance verification
  refuses `issue_reference_ambiguous` — pinned "never make it work".

## Goals / Non-Goals

**Goals:**

- The four-state lifecycle, expressed once on the node, respected everywhere:
  progress counts required only; optional/cancelled/superseded named but not
  counted; review follows required nodes; failures of wanted work land in
  health, never phase; the gate blocks on required nodes only and shows
  cancelled/superseded exclusions with their recorded reasons; `start` refuses
  cancelled/superseded nodes and never offers them as frontier candidates.
- History preserved: a lifecycle change is the next revision; earlier
  revisions' bytes never change.
- Full compatibility: g-001's revisions (no lifecycle field) read back
  all-required with digests verifying byte-identically.
- No new mutation, no new CLI command or option.

**Non-Goals:**

- A sibling lifecycle record — rejected (D1), not merely deferred.
- A targeted node-edit subcommand (`rasen store issue node <id> cancel ...`);
  lifecycle changes go through the two existing publication sources. The
  operator who wants one node cancelled copies the latest revision's node
  list (from `show --json`), edits, and publishes `--from-file`; reference
  verification refuses a mistyped instance loudly.
- Any portfolio-status → lifecycle mapping. g-001's synced truth ("no child
  status ... SHALL be written into a node") stands: portfolio statuses are
  progress facts, and progress is derived, never declared. `--from-portfolio`
  keeps publishing required-only nodes.
- A structural `supersededBy` pointer. The reason TEXT names the successor;
  a pointer would need successor-exists and no-cycle graph rules for a need
  nobody has stated (the gate scenario only requires the successor be
  findable from the reason).
- Lifecycle on intent nodes — intents are placeholders that neither run nor
  gate; they keep their existing role (permanent review/gate occupants until
  re-published away).
- Touching `src/core/pipeline-registry/` (frozen), `packages/ui/**`,
  `issue-plan-publication` behavior, or any version number.

## Decisions

### D1 — Schema extension on the node, not a sibling record

One optional `lifecycle` field on Change nodes plus a conditional `reason`.
A sibling record (a lifecycle overlay with its own revisions) was the
alternative and is rejected on four counts:

1. **It would be a second mutable truth** beside the revision — the exact
   shape this spec family refuses everywhere ("never a second mutable truth",
   projection and binding both). The overlay would need its own ordinal
   discipline, its own digest, its own coherence rules against node ids that
   revisions may drop, and a SIXTH mutation — breaking the closed
   five-mutation vocabulary `store-issue-resources` specifies.
2. **History is free on the schema path**: revision N says required, revision
   N+1 says cancelled; both readable forever, tamper-evident by the existing
   digest. An overlay's history would be a second ordinal sequence to
   reconcile against the first.
3. **One file to read**: projection and gate read the revision alone — no
   join, no divergence between revision and overlay.
4. **The authoring flow already exists**: publication IS the mutation, from
   both sources, under the existing lock.

### D2 — One closed enum, default-as-absent, canonical omission

`lifecycle: required | optional | cancelled | superseded`, optional in the
schema, CHANGE nodes only. Reading: absent ≡ `required` — this is what makes
g-001's `0001`/`0002` readable unchanged, which the compatibility mandate
requires. Publication canonicalization (in `normalizePlanNodes`' seam, beside
`dependsOn` ordering): an explicit `required` normalizes to ABSENT and the
stored form omits the field when required — mirroring `changeAlias` — so the
digest body gains bytes only when a non-required lifecycle (or a reason) is
actually carried, and a plan published before this change re-derives its
exact published digest. `reason` (string, min 1) is REQUIRED for `cancelled`
and `superseded` — the setState dropped-requires-reason precedent — and MUST
satisfy `assertPortableIssueText` (refused, never trimmed). An out-of-vocab
value is refused naming the four. Validation lives in `validateNode`, so
`findPlanNodeSchemaProblems` inherits it for the untrusted-input boundary.

Forward compatibility is the designed asymmetry: new code reads old revisions
(absent field) fine; OLD code reading a NEW revision reports the unrecognized
field per the strict-read requirement — visible refusal, never silent drop —
which is the discipline that requirement exists for.

### D3 — What each state means, everywhere, from one table

| lifecycle | progress | phase graph | health signals | gate | start |
|---|---|---|---|---|---|
| `required` (default) | counted both parts | in graph; must complete for `review` | failure/wait counted | un-terminal blocks | frontier candidate |
| `optional` | counted neither | in graph; running/advanced ⇒ `active`; incomplete does NOT hold `review` | failure/wait counted | never an un-terminal blocker | frontier candidate |
| `cancelled` / `superseded` | counted neither | OUTSIDE the graph; recorded activity drives no phase | escalations are history | excluded from total; exclusion shown with reason | refused (lifecycle + reason named); never a candidate |

Concretely: `derivePhase` filters to wanted nodes (`required` + `optional`)
for the active/ready signals and to required nodes for the review condition;
`deriveHealth` reads escalations from wanted nodes only; progress filters
both numerator and denominator to required; the gate's un-terminal loop skips
non-required and appends exclusion entries (node, lifecycle, reason) to the
report beside the blockers; the binding's frontier filters to wanted nodes
and `--node` on a cancelled/superseded node is a new refusal kind
(`node-cancelled` / `node-superseded` in the start-refusal taxonomy) naming
the lifecycle and the recorded reason.

An optional node that never runs costs nothing; one that runs and completes
is visible on its line and counted nowhere — "named but not counted" is the
honest reading of the roadmap line.

### D4 — Failures of wanted work hold the gate; the resolution path is recorded

An optional node's failure drives health `failed` and therefore holds the
gate. This looks like "optional blocks", and the seed's "optional nodes never
block" deserves its precise reading: an optional node never blocks on
COMPLETION — no required work is being demanded of it. A FAILED optional node
is not incompleteness, it is a recorded failure of work the plan still wants,
and the roadmap's own rule ("失败和阻塞进 health") routes it to health, which
the gate already respects. The operator's exits are real ones: re-run the
work, or cancel the node with a recorded reason — after which its escalation
is history (D3) and the gate clears. Cancelled/superseded escalations drive
nothing from day one, so the rule stays one rule: wanted-work failures are
failed health.

### D5 — No new surface: authoring rides the existing sources

`--from-file` authors lifecycle fields directly (schema-validated). The
portfolio channel is untouched — its "exactly what the run-state says"
requirement is g-001's synced truth and stays. No new options or subcommands,
so the three-way-sync trio (cli-presentation / command-registry / locales
catalog) must verify UNCHANGED — the child-level gate still runs it
(portfolio lesson 9), now expecting zero diff.

### D6 — Zero required nodes is a stated answer, not a missing one

A readable revision with no required nodes: progress `0/0` (distinct from
`-/-`, which means no value could be derived), phase can reach `review`
(nothing demanded is unfinished), gate eligible with zero required nodes
while NAMING the exclusions and optional nodes beside it — so "accept an
Issue whose demanded work is empty" is an explicit operator act over stated
facts, not a quiet vacuous pass. `assertCoherentGateSnapshot` already admits
`0/0`; the accept path's snapshot uses required-scoped counts.

### D7 — Fences checked, not weakened

- **M-1**: lifecycle adds no reference-resolution or verification path; the
  under-lock instance verification is untouched, and the pin test must stay
  green byte-for-byte. Any change that makes active+archived publish would
  fail it — this change does not go near that seam.
- **One projection seam**: all derivation changes land in
  `src/core/issue-status/` (plus the gate rule in `issue-acceptance`, which
  consumes the projection one-directionally) — no second seam opens.
- **Five mutations**: unchanged; lifecycle rides `publishPlan`.

## Risks / Trade-offs

- [Old rasen reading a new revision reports an unrecognized field] → The
  strict-read discipline working as specified: visible, not silent. Store
  content is read by the checkout family that writes it; the projection
  reports the problem rather than fabricating status.
- [A required node depending on a cancelled node is blocked forever] →
  Honest: the plan is defective and the blockedBy reporting names the
  cancelled dependency; the operator supersedes/re-publishes. A silent
  treat-cancelled-as-complete rule would fabricate evidence.
- [Digest body grows] → Only when fields are carried; absent-field revisions
  re-derive identical digests (the `changeAlias` pattern); a test pins a
  g-001-shaped revision's digest across the schema change.
- [Copy-edit-publish authoring is clunky for one cancellation] → Accepted
  for Phase 2 (D5 non-goal); rare, loud on mistakes, and a targeted edit
  command can come later without migration.
- [Windows/locale] → No paths in new fields beyond the portable-text refusal;
  no new locale keys; renders are English-literal per `store-issue.ts`
  convention.

## Migration Plan

Additive schema with default-as-absent: no data migration, no version bump,
no CLI flag changes. Rollback is reverting the commit; revisions published
with lifecycle fields then read to old code as unrecognized-field refusals —
acceptable and visible, and prevented in practice by the ship order (this
change and its dogfood land together).

## Open Questions

- None blocking. (Whether `superseded` should ever grow a structural
  successor pointer is a future capability's call; the reason text carries
  the fact today.)
