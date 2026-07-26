## Why

Rasen can reliably deliver a single Change, but long-lived workstreams still
depend on manually maintained North Star, stage-goal, Roadmap, slice, and
evidence documents. That manual layer has already produced valuable dogfood,
but it also drifts, duplicates research, and lets parallel Changes reinterpret
direction because there is no reusable workflow for maintaining the authority
chain and reconciling results.

## What Changes

- Add an opt-in built-in `rasen-direction` skill for governing durable
  direction above Change through five explicit actions: Establish, Calibrate,
  Select, Project, and Reconcile.
- Define the Git-native experimental workstream contract under
  `rasen/work/<work-id>/`: a thin `work.yaml`, required `target-state.md` and
  `roadmap.md`, optional `north-star.md`, and slice
  `spec.md`/`plan.md`/`result.md` artifacts.
- Keep Direction absent by default and neutral to every ordinary Rasen path:
  init/update do not create Direction artifacts, and propose/auto/goal/change
  workflows neither require nor implicitly enter Direction.
- Reserve `target-state.md` for Direction's cross-Change desired state, keeping
  it distinct from the bounded `rasen-goal` loop and its
  `goal-plan.md`/`goal-run.json`; read legacy experimental `goal.md` only as a
  compatibility input and never rewrite it automatically.
- Register the skill through the built-in workflow catalog and full/custom
  profile machinery, with localized profile-picker metadata and generated-skill
  parity coverage. Keep it out of the streamlined core profile.
- Teach the help and navigator routers when long-lived work benefits from
  Direction while preserving the direct path for ordinary bugs and features.
- Add focused cross-platform tests for skill generation, action contracts,
  artifact naming, catalog/profile/localization integration, downstream
  handoff behavior, and the non-blocking absence contract.
- Add the approved Direction development guide to `rasen/work/` as the durable
  product and implementation reference for this experimental phase.

No CLI domain model, stable `work.yaml` schema, database, daemon behavior,
dashboard, or mandatory lifecycle stage is introduced.

## Capabilities

### New Capabilities

- `direction-workflow`: Defines the opt-in Direction lifecycle, authority and
  artifact contracts, five workflow actions, compatibility behavior, downstream
  Change projection, reconciliation rules, and non-blocking adoption.

### Modified Capabilities

- `profiles`: Adds `direction` as a localized, selectable built-in workflow in
  the full profile while leaving the core profile unchanged.
- `workflow-help-command`: Routes explicit long-lived direction/Roadmap needs
  to `rasen-direction` without inserting it into ordinary work.
- `navigator-router-skill`: Maps `rasen-direction` as an optional long-horizon
  on-ramp above the normal Change flow.
- `workflow-template-parity`: Pins the new built-in workflow template and
  generated skill content in the parity golden master.

## Impact

- New canonical workflow template under `src/core/templates/workflows/`.
- Built-in workflow registry, template export facade, full-profile catalog,
  localized picker metadata (`en`, `ja`, `zh-cn`), help, and navigator maps.
- Workflow catalog/profile/generation/parity tests and focused Direction
  contract tests.
- Experimental documentation under `rasen/work/direction-workflow/`.
- No changes to existing CLI commands, pipeline definitions, main workflow
  chain, runtime state, schemas, or default core-profile behavior.
