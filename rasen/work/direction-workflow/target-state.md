# Direction Workflow Target State

## Outcome

Rasen users with genuinely long-lived work can explicitly invoke an installed
`rasen-direction` skill to establish or calibrate durable direction, select
one evidence-bearing Roadmap Slice, project it into the existing Change
lifecycle, and reconcile observable results afterward.

Users who do not want Direction continue to use init, update, Change,
`rasen-auto`, and `rasen-goal` without creating or depending on Direction
artifacts.

## Observed Baseline

At revision `3e8d1d389cc6612c2bbd8c051cbf8b256189fe03`, Rasen has an experimental
`rasen/work/` area and real North Star/Roadmap examples, but no registered
`direction` workflow or generated `rasen-direction` skill. Long-horizon
authority and reconciliation therefore depend on manually interpreted
documents.

## Success Evidence

- The full profile and an explicit custom selection generate
  `rasen-direction/SKILL.md`; the core profile does not.
- The generated skill exposes Establish, Calibrate, Select, Project, and
  Reconcile with the approved authority, evidence, compatibility, and approval
  boundaries.
- Ordinary init/update and ordinary Change/auto/goal routing create no
  Direction artifacts and acquire no Direction prerequisite.
- Focused and repository-wide automated checks pass on Windows; CI supplies
  macOS/Linux coverage.
- Independent review accepts the implementation, and delivery evidence records
  the PR and merge outcome without being manufactured in advance.

## Boundaries

- No `rasen direction` or repurposed `rasen work` CLI domain.
- No stable public `work.yaml` schema or runtime parser.
- No database, event store, daemon behavior, dashboard, or Roadmap UI.
- No automatic North Star creation or mutation.
- No mandatory pipeline stage or automatic transition from ordinary work.

## Locked Decisions

- Direction is opt-in and lives above Change.
- North Star is optional and requires explicit approval to change.
- New workstreams use `target-state.md`; `rasen-goal` continues to own
  `goal-plan.md` and `goal-run.json`.
- Legacy `goal.md` is read-only compatibility input unless migration is
  separately approved.
- One workstream has at most one active Slice, and Result acceptance comes from
  observable evidence rather than Change completion alone.

## Open Choices

First-class parsing, stronger structural validation, read-only projections,
inheritance, or UI are separate future proposals only if repeated use shows
that the prompt-and-Git contract is insufficient.
