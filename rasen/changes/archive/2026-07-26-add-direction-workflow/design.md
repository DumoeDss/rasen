## Context

Rasen's executable lifecycle is Change-centred: built-in workflow templates are
registered in `src/core/workflow-registry/builtins.ts`, selected through
profiles, generated for adapted agent tools by init/update, and pinned by
catalog and template-parity tests. The CLI's `workflow-chain.ts` separately
models automatic next-step hints for the ordinary Change lifecycle.

Long-lived planning already exists under experimental `rasen/work/`, notably
the issue-centred automation North Star and Roadmap. Those documents prove the
need for an authority chain above Change, but they predate a stable discovery
contract, call the workstream-level desired state `goal.md`, and rely on manual
reconciliation. The approved
`rasen/work/direction-workflow/development-guide.md` defines the product
contract for turning that discipline into a reusable skill.

This change is intentionally a prompt/workflow product, not a new CLI domain.
The skill must help an agent discover and maintain Git artifacts while using
existing Rasen commands for current specs, changes, pipelines, and evidence.
It must work in a local repo or an explicitly selected Store/project planning
root, and generated skills must remain portable across Windows, macOS, and
Linux.

## Goals / Non-Goals

**Goals:**

- Ship a selectable built-in `rasen-direction` skill whose explicit actions are
  Establish, Calibrate, Select, Project, and Reconcile.
- Make Direction discoverable to users who need multi-Change, multi-version,
  multi-project, or principle-governed work while adding no prerequisite or
  implicit transition to ordinary work.
- Establish a legible experimental artifact protocol based on `work.yaml`,
  `target-state.md`, `roadmap.md`, and slice artifacts.
- Preserve authority and evidence rules: at most one active slice, Change
  completion is not slice acceptance, Result records facts, and North Star
  edits require explicit human approval.
- Integrate through the existing workflow registry, profile picker,
  localization, help/navigator routing, init/update generation, and parity
  tests.
- Prove the generated skill and absence contract with focused, cross-platform
  tests and an honest dogfood record.

**Non-Goals:**

- A `rasen direction` or repurposed `rasen work` CLI namespace.
- A stable public schema or runtime parser for `work.yaml`.
- A pipeline/stage that runs for every Change, automatic large-task routing, or
  changes to `rasen-goal`.
- A database, event store, daemon scheduler, Issue model, dashboard, or Roadmap
  UI.
- Automatic North Star generation for every workstream, automatic North Star
  mutation from evidence, multi-North-Star inheritance, or cross-Store sync.
- Replacing specs, Change artifacts, pipeline run-state, Git, or delivery
  evidence with Direction documents.

## Decisions

### D1. Direction is a built-in task workflow in the full profile, not a core workflow or pipeline stage

Add canonical workflow id `direction`, skill directory/name
`rasen-direction`, and a template factory in the existing built-in registry.
It has `kind: task` and no required workflows, skills, pipelines, schemas, or
side effects. Because `ALL_WORKFLOWS` is derived from the built-in id list, the
full profile and custom picker discover it automatically; `CORE_WORKFLOW_IDS`
is unchanged.

The workflow chain remains unchanged. `rasen-direction` is an optional
governance entry above or beside the main flow, not a successor that
`rasen status`, propose, apply, or auto should suggest unconditionally. The
skill itself names downstream handoffs during Project, and help/navigator route
users who explicitly describe long-horizon needs.

Alternatives considered:

- **Core profile:** rejected because Direction is intentionally advanced and
  opt-in; installing it for streamlined daily work adds cognitive surface
  without daily value.
- **Pipeline stage:** rejected because a persistent workstream outlives any one
  Change or Session.
- **Expert skill:** rejected because Direction owns a concrete artifact
  lifecycle rather than supplying a reusable methodology to another worker.

### D2. The skill is the behavior; no first-class Direction parser is introduced

Create `src/core/templates/workflows/direction.ts` using the same
`SkillTemplate` and `STORE_SELECTION_GUIDANCE` conventions as other built-in
workflows. Its instructions define:

1. when Direction applies and when to leave the current flow alone;
2. planning-root and workstream discovery;
3. the artifact authority order and source-of-truth boundaries;
4. action selection and action-specific read/write rules;
5. confirmation boundaries and downstream handoffs;
6. a final report containing paths, decisions, evidence, unresolved conflicts,
   and exactly one next action.

The prompt may use a colocated reference sidecar only if the final skill body
would otherwise duplicate a large artifact contract. If used, it must live
under `skills/workflows/rasen-direction/`, be copied by the existing built-in
sidecar mechanism, and be explicitly read by the skill before writes. No new
sidecar installer is justified.

Alternative considered: implement a typed YAML/Markdown library now. Rejected
until repeated dogfood proves which fields and validations are stable.

### D3. Planning-root discovery uses existing CLI-resolved paths and missing Direction is a successful state

The skill first honors explicit Store/project selection through the shared
store guidance. It obtains the planning root from current Rasen CLI JSON
(`planningHome.root` / `planningHome.changesDir`) rather than assuming the
current working directory or hardcoding `rasen/changes`. From the resolved
planning root it discovers the sibling experimental `work` area using
platform-native path operations.

If no `work` directory or no matching workstream exists:

- Establish may create one only because the user explicitly requested it.
- Calibrate, Select, Project, and Reconcile report the missing prerequisite and
  offer Establish; they do not modify ordinary Change state.
- No other Rasen workflow is changed to probe or warn about the absence.

All authored references use relative paths within the planning root when
practical. Tests construct expected paths with Node's `path` utilities and use
temporary directories so Windows separators and case behavior are not assumed.

### D4. The experimental workstream manifest is a thin index, not execution state

New workstreams use:

```text
rasen/work/<work-id>/
  work.yaml
  north-star.md            optional
  target-state.md
  roadmap.md
  slices/<slice-id>/
    spec.md
    plan.md
    result.md
    log.md                  optional
```

`work.yaml` is an experimental, versioned discovery index with:

- `version: 1`;
- portable `id`;
- lifecycle `status` in
  `draft | active | paused | completed | superseded`;
- optional `authority.northStar`;
- `targetState` and `roadmap` references;
- zero or one `activeSlice`;
- optional `lastReconciled.at` and `lastReconciled.revision`.

It must not duplicate roadmap prose, Change/task status, Run/Session state, or
evidence. Workstream and slice IDs are portable slugs; paths are relative,
resolved against their containing file, and checked to remain inside the
selected planning root before writes.

The structure remains explicitly experimental in the guide and skill. Tests
pin the prompt contract rather than presenting the YAML as a new public CLI
schema.

### D5. `target-state.md` is the only new Direction desired-state artifact

The authority order is:

```text
North Star (optional)
  > Target State
    > Roadmap
      > Selected Slice Spec
        > Slice Plan
          > Change planning artifacts
```

`target-state.md` describes the state a long-lived workstream must make true.
It is distinct from `rasen-goal`, which remains a bounded iterative loop with
`goal-plan.md` and `goal-run.json`.

For compatibility, discovery may read a legacy `goal.md` when
`target-state.md` is absent and must label it as legacy input. Any newly
created or explicitly migrated desired-state artifact is
`target-state.md`; ordinary reads, calibration, and reconciliation never
rename, overwrite, or delete `goal.md`. Migration requires explicit user
approval and preserves the legacy file unless the user separately authorizes
removal.

### D6. Each action has a narrow mutation and approval boundary

**Establish**

- inspect existing Direction first to avoid duplicates;
- ground the baseline in current specs, changes, Git, and available evidence;
- create a draft `work.yaml`, `target-state.md`, concise `roadmap.md`, and
  proposed first slice;
- default to no North Star;
- show the human the Target State, optional North Star decision, and first
  slice before marking the workstream active.

It does not create or implement a Change.

**Calibrate**

- load the authority chain and last reconciled revision;
- compare documents with current specs, changes, Git, runs, PRs, and dogfood
  evidence that can actually be observed;
- update factual capability baseline and stale references;
- propose, but do not silently apply, material Target State scope changes.

It never treats a roadmap assertion or file/module existence as proof of a
working capability.

**Select**

- compare candidate slices by user value, uncertainty, dependency, and
  observable exit evidence;
- select one vertical slice that raises only the necessary complexity
  dimension;
- write its spec and plan;
- set the sole `activeSlice` only after user confirmation.

Parallel Changes are represented inside that slice's plan/portfolio; multiple
active slices are not.

**Project**

- requires a confirmed active slice;
- passes only the selected slice's objective, boundary, acceptance, target
  project(s), and source references to one `rasen-propose` Change or an
  `auto-decompose` portfolio;
- records a lightweight Direction source reference in Change planning context;
- leaves technical design/tasks to each Change and leaves execution to its
  existing pipeline.

The skill reports the chosen downstream workflow and asks/acts according to the
user's request; it does not implement code itself and never sends the whole
Roadmap to auto-decompose to choose product direction.

**Reconcile**

- reads immutable historical Result plus observed Change/Run/Git/PR/release and
  dogfood evidence;
- records `passed | partial | failed | superseded | cancelled` without deriving
  passed solely from all Changes being complete;
- updates Roadmap position/order, active slice, lifecycle status, and
  reconciliation baseline;
- detects stale/broken references, contradictory status, no-next-slice active
  drift, and historical detail that belongs in Result/Log/Git;
- may draft a material Target State change for confirmation;
- never edits North Star unless the user explicitly approves a separately
  presented North Star revision.

### D7. Router integration is explicit and non-coercive

`rasen-help` and `rasen-navigator` gain a short route for requests such as
"establish a long-term direction", "choose the next Roadmap slice", or
"reconcile this workstream". They also state that normal bugs, small features,
and bounded measurable optimization continue directly through the Change or
`rasen-goal` paths.

No change is made to office-hours, explore, propose, auto, goal, init, update,
or the runtime next-step chain to automatically enter Direction. Installation
through `rasen update` generates the skill file because it is selected; it
does not generate `rasen/work/` or any workstream artifact.

### D8. Catalog, localization, parity, and behavior tests form the acceptance surface

Implementation updates the template export facade, built-in adapter and id
lists, the catalog fixture, and English/Japanese/Simplified-Chinese profile
metadata. Direction is included in full/custom selection and absent from core.

Tests cover:

- template identity, five actions, source-of-truth and approval guardrails;
- generated `rasen-direction/SKILL.md` through registry-driven generation;
- full/core/custom profile selection and init/update behavior;
- no creation of `rasen/work`, `work.yaml`, North Star, Target State, or
  Roadmap during ordinary init/update and ordinary workflow generation;
- legacy `goal.md` read-only compatibility wording and the distinct
  `rasen-goal` artifacts;
- Project handoff to propose/auto-decompose without implementation or whole
  Roadmap delegation;
- Reconcile evidence rules, stale-state checks, terminal statuses, and North
  Star protection;
- localized picker entries and catalog parity;
- function-payload/generated-content hashes and the colon-reference guard;
- path examples/tests that use platform-native utilities.

The approved development guide is committed under
`rasen/work/direction-workflow/`. Dogfood records only evidence that was
actually produced during implementation/verification and remains `partial`
until any later delivery evidence exists.

## Risks / Trade-offs

- **[Risk] Prompt-only invariants are not deterministically enforced.**
  → Pin critical wording with focused tests, keep the manifest explicitly
  experimental, and defer a parser until repeated dogfood identifies stable
  invariants.
- **[Risk] A long skill becomes hard for agents to follow.**
  → Organize it as a small common preflight plus five action sections, require
  reading only the selected action and any artifact reference, and keep raw
  research out of committed artifacts.
- **[Risk] Users confuse Direction Target State with `rasen-goal`.**
  → Use `target-state.md` exclusively for new Direction work and repeat the
  artifact/lifecycle distinction in the skill, help, navigator, and tests.
- **[Risk] Full-profile installation is mistaken for automatic adoption.**
  → Keep Direction out of core and workflow-chain edges; test that init/update
  only install the skill and never create Direction artifacts.
- **[Risk] A self-dogfood record overstates completion before PR/merge.**
  → Record test/review evidence only when observed, use `partial` where
  delivery is pending, and never backfill expected evidence as fact.
- **[Risk] Legacy workstreams lack `work.yaml` and use `goal.md`.**
  → Discovery tolerates and labels them; writes do not migrate them without
  approval.
- **[Trade-off] No structural validator catches malformed references.**
  → Direction operations stop on broken or escaping references and explain
  repair; a CLI validator remains a future evidence-triggered proposal.

## Migration Plan

1. Add the template and register `direction` through existing catalog/profile
   surfaces.
2. Add all locale entries and update router text and parity fixtures.
3. Commit the approved development guide and an honest dogfood slice/result
   record produced during implementation.
4. Build and run focused tests, then the relevant init/update/profile suites.
5. Generate the installed skill through the built CLI and inspect it on the
   current platform; CI remains the macOS/Linux cross-platform gate.

Rollback removes the new catalog entry/template/locale metadata/router text and
generated skill through the existing profile/update drift mechanism. Existing
experimental `rasen/work/` artifacts remain ordinary Git documents and do not
affect any CLI path.

## Open Questions

None block Phase 1. A stable manifest schema, first-class CLI, stronger
reference validation, multi-North-Star inheritance, and read-only projections
require separate proposals triggered by real dogfood evidence.
