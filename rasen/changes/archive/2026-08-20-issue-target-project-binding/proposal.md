## Why

Phase 3 opens one Issue to MULTIPLE member projects, and the plan node's
`projectId` — the fact that decides which project's checkout a Change launches
from — is today a bare string that only has to match a catalog file: a
knowledge-only member (a project that shares knowledge but does not plan in
this Store) is accepted as a plan target as silently as a planning member, and
the Issue read surface never shows which project a node targets. Before
multi-project plans exist, the target must become an authoritative,
membership-validated, visible fact.

## What Changes

- **The target project becomes membership-validated at the one publication
  seam.** Publishing a plan — by manual `--from-file` authoring or by the
  `--from-portfolio` channel — refuses a node whose target project is not a
  member project of the Store whose `roles.planning` is true, naming the
  project, its recorded roles, the Store's planning members, and the repair.
  An unknown project (no membership record at all) keeps its existing named
  refusal. Both publication sources inherit the gate through the one shared
  verifier inside `publishPlan`.
- **No new schema field.** The node's target project IS the existing required
  `projectId`; a parallel `targetProject` field would create the two-sources
  disease this codebase refuses. Revisions, digests, and serialization are
  byte-for-byte unchanged — a Phase-2-era revision reads back exactly as
  before, because membership is a publication-time authority that no read
  re-litigates.
- **One Change, one primary project — stated and enforced by construction.** A
  node names exactly one project; a Change instance is claimed by at most one
  node in a revision (naming a second node for it is refused); and changing a
  node's target project is a new revision, never a rewrite — consistent with
  the existing ordinal-revision discipline.
- **The portfolio channel's derivation is named as the design it already
  implements.** Each child's target project is the committed claimant's
  project, derived from the member-project structure the Store records as
  committed evidence — never from the run-state, never inferred from a name —
  and the same membership gate covers what it derives.
- **The Issue read surface shows the target.** `store issue show` carries each
  node's target project on its node line, and the `--json` form carries
  `projectId` (with `targetLineId`) per node through one widening of the
  projection seam. Derived axes — phase, health, progress — are unchanged by
  the project fact; project grouping and swimlanes remain g-003's delivery.

Non-goals: cross-project dependency gating (g-002), grouped/swimlane views and
the Issue #2 dogfood (g-003), automatic target routing (roadmap §5 defers it
beyond Phase 3; target selection stays manual), any UI, any version bump, and
any change to `src/core/pipeline-registry/` or the plan revision schema.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `store-issue-resources`: a new requirement — plan nodes target planning
  members; the one-Change-one-primary-project constraint; the
  publication-time-only nature of the membership authority.
- `issue-plan-publication`: the portfolio publication requirement names the
  target-project derivation (committed claimant's project) and inherits the
  planning-member gate for what it derives; a publication may carry nodes
  across several planning members.
- `issue-status-projection`: the Issue read surface carries per-node target
  project (human and `--json`), and the projection derives nothing from it.

## Impact

- `src/core/store/issues/reference-verification.ts` — the planning-member gate
  at the shared verifier; `types.ts` — one new refusal code in the closed
  taxonomy; `module.ts` — supplies role facts from the parsed project
  catalogs.
- `src/core/store/layout-migration/plan.ts` — the migration replay caller
  states its own member-eligibility set (its frozen member set), keeping the
  replay exactly as permissive as today: grandfathered plans must not newly
  refuse on role drift.
- `src/core/issue-status/types.ts` + `projection.ts` — `IssueNodeStatus`
  gains `projectId`/`targetLineId` (the one projection-seam widening);
  `src/commands/store-issue.ts` — the show node line renders the project.
- Tests: verifier gate (knowledge-only refusal, unknown project regression),
  both publication sources, projection fields, CLI rendering (dist built
  first), and a degradation suite over a hand-crafted Phase-2-era revision
  (digest verifies, derivation identical). Dogfood receipts: temp-store
  multi-project publication on both sources; read-only receipts on the
  persistent `issue-registry` store (no throwaway writes — Issue #2 authoring
  is g-003's).
- Prerequisite surfaced for g-003 (flagged, not delivered here): the
  `issue-registry` member record for the rasen project currently declares
  `roles.planning: false` — before Issue #2's plan publishes there, the
  membership must be widened to a planning member, and the second member
  project added (planner decision: `rasen-site`).
- No CLI command or option changes (renderers are English-literal per file
  convention), so the commander/locale/completions three-way sync does not
  apply; `packages/ui/**`, `src/core/pipeline-registry/`, and
  `src/core/templates/` untouched.
