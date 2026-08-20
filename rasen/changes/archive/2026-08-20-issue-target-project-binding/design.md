## Context

Phase 1 gave plan nodes their shape; every node — change and intent — has
carried a REQUIRED `projectId` since then, verified at publication against the
Store's project catalogs (`reference-verification.ts`:
`issue_reference_scope_conflict` for a project with no catalog), and for change
nodes against the committed instance's identity. Phase 2's portfolio channel
derives that project from committed evidence per child. `issue-execution/`
already launches a node from ITS member project's checkout, and membership has
a first-class vocabulary since store-v2: in a layout-2 Store the project
catalog (`.rasen-store/projects/<projectId>.yaml`) IS the membership record,
carrying `roles.planning` / `roles.knowledge` as separate facts and a
`planningBinding` that is deliberately NOT a membership fact.

Two gaps stand between that state and Phase 3's single-Issue / multi-member-
project plans:

1. The catalog check accepts ANY member — a knowledge-only member
   (`roles.planning: false`) is as acceptable a plan target as a planning
   member. Nothing anywhere asks "does this project plan in this Store?",
   which is the one fact a target project must have now that targets span
   projects.
2. The target is invisible on the read surface: `IssueNodeStatus` carries no
   project, and `show`'s node lines name identifier/kind/alias/observation —
   an operator cannot see which project a node targets without opening the
   revision YAML.

Ground truth worth naming: the persistent dogfood store `issue-registry`
records the rasen project as `roles.planning: false, knowledge: true` —
knowledge-only — while Issue #1's plan legitimately targets it (published
under the lax gate). Role drift is not hypothetical; it is the first store
this capability will meet.

Constraints inherited from the portfolio plan: manual target selection only,
no auto-routing (roadmap §5); `src/core/pipeline-registry/` and
`packages/ui/**` frozen; no version bumps; one projection seam; CLI three-way
sync only where a CLI surface actually changes.

## Goals / Non-Goals

**Goals:**

- The target project is an authoritative fact: publication (BOTH sources,
  through the one shared verifier inside `publishPlan`) refuses a target that
  is not a planning member, naming the project, its roles, and the repair.
- One-Change-one-primary-project stated and enforced by construction: one
  project per node, one node per Change instance per revision, retargeting is
  a new revision.
- The portfolio channel's derivation named as the design it already is
  (committed claimant's project) and covered by the same gate.
- The read surface shows the per-node target project (human + `--json`)
  through one widening of the projection seam, deriving nothing from it.
- Honest degradation: no schema field, no serialization change, no digest
  change; Phase-2-era revisions (including knowledge-only targets) read back
  identically; membership is a publication-time authority no read re-litigates.
- Dogfood receipts: temp-store multi-project publication on both sources plus
  refusals; read-only receipts on the persistent `issue-registry` store.

**Non-Goals:**

- Cross-project dependency gating — g-002 `issue-cross-project-gating` owns
  the start-time gate and its projection visibility.
- Grouped/swimlane views, per-project progress, project chips, Issue #2
  authoring and the real second-member dogfood — g-003
  `issue-project-grouped-views` owns them.
- Automatic routing of work to projects — deferred beyond Phase 3 by the
  roadmap; the gate validates the author's choice, it never makes one.
- Any change to the plan revision schema, the five-mutation vocabulary's
  existing codes' semantics, `start`'s launch composition (already binds the
  node's member project), or the migration engine's own requirements.

## Decisions

### D1 — No new schema field: `projectId` IS the target project

The roadmap says "plan nodes gain a stable `target project`". The node already
carries it — required, single-valued, digest-covered. Adding a parallel
`targetProject` field would create two project facts on one node with no rule
for their disagreement, the exact second-truth disease this module refuses
everywhere else. g-001 therefore makes the EXISTING field authoritative
(membership-validated) and visible (read surface), and changes zero revision
bytes.

Consequence (the degradation guarantee, mirroring g-002's D2 precedent in
spirit): because nothing is added, "absent ≡ previous behavior" holds
trivially — there is no absent case; every revision ever published satisfies
the new display and the unchanged digest formula. A golden test pins that
publication of the same node inputs produces byte-identical revision YAML
before and after this change (uniform-change blindness lesson: assert the
bytes, not just round-trip equality).

### D2 — The gate is `roles.planning: true`, at the one shared verifier

A node's target must be a member project whose catalog declares
`roles.planning: true`. Why the role and not the alternatives:

- *Catalog presence (status quo)* — accepts knowledge-only members; vacuous
  once targets span projects. This is the gap.
- *`planningBinding: bound`* — binding is adoption/ownership truth
  ("membership alone never binds", membership spec D10) and is deliberately
  NOT a membership fact; requiring it would conflate roster with adoption and
  would refuse legitimate multi-store planning members. Rejected.
- *`roles.planning`* — the roster's own statement of "this project plans in
  this Store", exactly the eligibility a plan target needs. Chosen.

Placement: inside `verifyExecutionPlanReferences` — the one verifier both
publication sources already pass through (`--from-file` via
`StoreIssuesModule.publishPlan`; `--from-portfolio` by handing compiled node
inputs to the same mutation, Phase 2 D3). One gate, both channels, no
parallel implementation in `issue-publication`. The roster is read from the
Store checkout's membership records — the same authority the existing
project-catalog and target-line checks read; making it committed-evidence-
based would change the catalog checks' own contract and is not this change.

Fence honored in wording and behavior: the gate confers ELIGIBILITY to be
targeted; it never chooses a target (membership spec: "membership SHALL
express roster and eligibility only"). The refusal says the author's chosen
project does not plan here and how to change that fact — it does not say
where the work should go.

### D3 — One new refusal code, because it says a different true thing

`issue_reference_target_not_planning_member` joins the closed
`StoreIssueErrorCode` taxonomy. Reusing `issue_reference_scope_conflict` would
blur two conditions with different repairs ("no such member" vs "member does
not plan here") — the same reasoning that split `issue_reference_uncommitted`
from `issue_reference_unresolved`: a refusal that names the wrong one lies
about what was checked. Message shape mirrors the catalog refusal: the node,
the project, its recorded roles, the Store's planning members, and the
membership repair (`rasen store add-project`, which OR-widens roles per the
membership mutation's compose semantics). Both absence (no record) and
role-failure refusals fire for intent nodes identically — for an intent node
the roster is the only scope fact there is.

### D4 — The verifier's catalog input carries role facts; the migration replay states its own eligibility set

`IssueReferenceCatalogs` grows from `projectIds: string[]` to carry each
project's planning-role fact (e.g. `projects: { projectId, planningRole }[]`;
`projectIds` derives from it). The two production callers:

- `module.ts` `verifyReferences` — already parses every catalog
  (`listProjectEntries`); it passes the role through. Both CLI sources get the
  gate through this one call.
- `layout-migration/plan.ts` — passes its frozen member set as planning-
  eligible. Rationale: the migration replays plans grandfathered under the
  rules of their authoring day; retroactively tightening a REPLAY would block
  v1→v2 migrations on exactly the role drift the persistent store exhibits,
  and the migration's member set is by construction "projects whose planning
  content is migrating into this Store's planning layout" — a honest
  eligibility declaration, not a bypass. The gate stays one code path; each
  caller supplies its eligibility set from its own authority.

The duplicate-instance graph rule (two nodes naming one Change instance →
`execution_plan_node_duplicate`) already exists in `checkExecutionPlanGraph`;
this change gives it spec backing (the one-Change-one-primary-project
requirement) and a pinned test, not new logic.

### D5 — Portfolio derivation: committed claimant's project, already the design; the gate covers what it derives

`resolution.ts` resolves each child NAME against one gathered evidence
snapshot and the node carries the claimant's `projectId` — never a run-state
fact, never a guess (Phase 2 D2). g-001 changes none of that code for the
gate: the derived inputs flow through `publishPlan` and meet D2's gate there.
What is new is naming it as the target-project derivation and its multi-
project consequences in the spec: one publication may carry nodes in several
planning members, and a child resolving into a knowledge-only member's Change
is refused by name with the role fact. Cross-project name ambiguity keeps
Phase 2's posture — ambiguous, every claimant listed with its project and
line, none chosen — which is now load-bearing rather than theoretical.

### D6 — Read surface: one projection-seam widening, no CLI surface change

`IssueNodeStatus` gains `projectId` and `targetLineId` (copied from the
revision node the projection already holds; every node has them — no absent
case, no defaulting). `renderStatusNode` in `store-issue.ts` adds the project
segment beside kind/alias (renderers are English-literal by file convention);
`--json` carries the new fields structurally. `list` is untouched — grouping
and per-project progress are g-003's delivery, and the fence says one
projection seam. No new command, option, locale key, or completion entry, so
the commander/locale/completions three-way sync does not apply (stated here so
the child gate's trio check has its answer). `start`'s binding is untouched:
its launch contract already composes the node's member project through the
session-launch seam; g-002 layers gating on top.

### D7 — Dogfood and the persistent store

Byte-level and refusal dogfood runs on TEMP stores (trap list: no throwaway
writes on the persistent store): a layout-2 temp store with two planning
members carrying committed Changes, one knowledge-only member, and a portfolio
run-state naming children in both planning members. Receipts: multi-project
publication on both sources; knowledge-only and unknown-project refusals on
both; a hand-crafted Phase-2-era revision (bytes as Phase 2 wrote them, digest
recomputed by the unchanged formula) reading back with digest verified and
identical derivation; show rendering per-node projects.

The persistent `issue-registry` store gets READ-ONLY receipts: `store issue
show issue-multi-change-execution` before/after (same axes; node lines now
name the project; revision bytes untouched). Issue #2 authoring is g-003's.

Prerequisite flagged for g-003 (not delivered here): before Issue #2's plan
publishes on `issue-registry`, the rasen member record must widen to
`roles.planning: true` (membership mutation; the D2/D3 refusal names the
command when it bites) and the second member must be added. Planner decision
recorded for g-003: the second member project is `rasen-site`
(`Reference\rasen-site`) — real, small, active, already carries a `rasen/`
workspace, and site+core is the realistic cross-project Issue shape.
Alternative considered and declined: `rasen-telemetry-backend` (larger,
ops-heavy, heavier to commit against).

## Risks / Trade-offs

- [Persistent store's knowledge-only record blocks Issue #2's publication at
  g-003] → Intended friction, surfaced now: the refusal names the project,
  its roles, and the membership repair; the widening is one operator-visible
  mutation recorded in g-003's plan. Old revisions on that store read
  unchanged (D1/D2: gate is publication-time only).
- [A knowledge-only member that nonetheless has committed planning content
  (drift) can no longer be re-published against] → Intended: new publications
  state the roster truth or fix it; grandfathered revisions are untouched and
  the refusal names the repair. Escaping hatch: the membership mutation.
- [Tightening the shared verifier accidentally tightens the migration replay]
  → D4 pins the replay's eligibility set and a regression test migrates a
  store whose member roles are knowledge-only with an existing plan.
- [Display change misread as derivation change] → The projection delta's
  scenarios pin axes-equality for the same evidence, and the degradation
  suite asserts digest verification and unchanged derivation on a Phase-2-era
  revision.
- [Fixture drift makes the gate silently untested] → The knowledge-only
  refusal gets its own fixture member (`planning: false`), and the golden
  serialization test pins that no fixture-wide role edit can re-shape
  revision bytes (mutation-proof anchored at the serialization landing site,
  per the lesson chain).
- [Windows path/locale pitfalls in new render text] → Node-line segments use
  plain ids only; no new locale keys exist to miss.

## Migration Plan

Purely additive behavior: one gate, one refusal code, two read-surface
fields, one renderer segment. No data migration (no stored bytes change), no
schema version movement, rollback is reverting the commit. The store-side
prerequisite for the g-003 dogfood (widen `issue-registry`'s rasen member to
planning; add `rasen-site`) is operator work g-003 schedules, not a migration
this change ships.

## Open Questions

- None blocking. g-003 may revisit whether `list` should carry a project
  column once grouping exists; g-002 decides how cross-project dependency
  edges surface beside the per-node project line this change adds.
