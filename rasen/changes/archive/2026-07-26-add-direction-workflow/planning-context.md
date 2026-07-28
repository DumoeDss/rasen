# Planning Context

## User intent

Implement the first and only currently justified development phase: a
`rasen-direction` skill/workflow. Work in a new worktree based on
`origin/dev/0.1.5`, then open a pull request targeting `dev/0.1.5`.

The workflow is a maintenance and alignment layer for long-lived direction
artifacts. It is not a mandatory pipeline stage and it must not block ordinary
Rasen work when the user has no North Star or Roadmap need.

## Locked product decisions

- Direction sits above Change:
  `North Star -> Target State -> Roadmap -> Selected Slice -> Change / auto-decompose -> Pipeline Run -> Evidence -> Reconcile`.
- North Star is an optional, durable authority artifact. A workflow may create,
  calibrate, select from, project from, and reconcile direction artifacts, but
  must not rewrite a North Star from ordinary implementation evidence.
- The direction-level state must not be called Rasen Goal. Use
  `target-state.md` for the desired domain/product state. `rasen-goal` remains
  the bounded measure/evaluate/research loop represented by `goal-plan.md` and
  `goal-run.json`.
- Direction adoption is optional. No existing workflow, command, bootstrap,
  install, update, ordinary bug fix, or small feature may fail merely because
  direction artifacts are absent.
- The first implementation is a Git-artifact-backed skill, not a first-class
  CLI domain model, schema migration, dashboard, or mandatory scaffold.
- The product entry should be `rasen-direction`, not `rasen-north-star`.
- Actions to support: Establish, Calibrate, Select, Project, and Reconcile.
- Legacy experimental `goal.md` may be read for compatibility, but new
  direction work writes `target-state.md`.
- Avoid a second execution truth beside specs, issues, changes, and pipeline
  run-state. Roadmaps are adaptive vertical slices, not date-filled backlogs.

## Source design

The approved development guide is currently available in the original working
tree at:

`E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\rasen\work\direction-workflow\development-guide.md`

Read it completely before proposing. Include the guide in this branch if it is
not already present on the base branch.

Use the existing dogfood evidence under
`rasen/work/issue-centered-automation-platform/`, especially its North Star and
Roadmap, and honor `rasen/work/AGENTS.md`.

## Delivery constraints

- Branch: `feat/rasen-direction-workflow`
- Base: `origin/dev/0.1.5`
- Pull-request base: `dev/0.1.5`
- Cross-platform behavior is required on Windows, macOS, and Linux.
- Follow existing built-in workflow template, localization, profile/catalog,
  installation/update, next-step, and test conventions rather than inventing a
  parallel registration mechanism.
- Add focused tests demonstrating both the Direction behavior and the
  non-blocking absence contract.

## LEAD setup findings

- Effective pipeline: `small-feature`.
- Effective gate mask: `off`, source `global`; all stages currently resolve to
  `effectiveGate: false`.
- Selection policy: `manual`, source `default`.
- Orchestration tier: `B`; planner, implementer, reviewer, fixer, and shipper
  run as isolated Codex workers in the current host.
- The original checkout is dirty with unrelated user work. All edits must stay
  inside the isolated worktree named above.

## Durable planner findings

- Built-in workflow identity, template generation, dependency closure, and the
  full-profile set all flow from
  `src/core/workflow-registry/builtins.ts`; Direction needs one normal `task`
  adapter and no parallel installer. `CORE_WORKFLOW_IDS` is the independent
  opt-in boundary and remains unchanged.
- `src/core/workflow-chain.ts` is a separate static table for ordinary Change
  lifecycle hints. Direction is deliberately not a chain node/edge, so
  installing the skill cannot make it an automatic predecessor of propose or a
  prerequisite of apply/auto/goal.
- Profile picker metadata is a typed `Record<WorkflowId, ...>` backed by the
  English, Japanese, and Simplified Chinese locale catalogs. Adding the
  built-in id therefore requires complete entries in all three catalogs and
  gives a compile/test guard against an untranslated workflow.
- Init/update skill output is registry-driven through `getSkillTemplates()`.
  Built-in workflow sidecars, if needed, already have a supported source path
  at `skills/workflows/<skill-dir>/`; the first implementation does not need a
  new file-copy or registration mechanism.
- Built-in catalog shape and generated template bytes are intentionally pinned
  by `test/fixtures/workflow-registry/builtins-v1.json` and
  `test/core/templates/skill-templates-parity.test.ts`. Direction must update
  those fixtures/hashes from canonical rendered source while leaving the core
  profile and ordinary workflow-chain tests unchanged.
