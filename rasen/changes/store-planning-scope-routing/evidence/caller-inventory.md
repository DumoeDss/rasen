# Planning scope caller inventory

Inventory date: 2026-08-06

Scope: production TypeScript under `src/`. Tests and generated `dist/` output are excluded. The inventory was produced with bounded `rg -l --glob '*.ts'` searches for the public compatibility types and directory fields, plus the executable source guard in `test/core/store-planning/planning-path-source-guard.test.ts`.

## Direct planning layout joins

These are the complete matches pinned by the source guard. A new match, a removed adapter, or another match in an already allowed file changes the exact map and fails the test.

| File | Count | Classification | Disposition |
| --- | ---: | --- | --- |
| `src/core/store/planning-layout-v2.ts` | 7 v2 segment arrays | scope seam | Foundation is the only Store v2 segment constructor. |
| `src/core/store-planning/internal/resolver.ts` | 10 | scope seam | Store v2 delegates to Foundation; remaining joins classify standalone/legacy layouts and routing evidence. |
| `src/core/root-selection.ts` | 3 | scope seam | Legacy fallback constructor only; scoped roots project typed locations. |
| `src/core/planning-home.ts` | 1 | scope seam | Standalone fallback; scoped callers use the read-only projection. |
| `src/core/management-api/project-space.ts` | 2 | scope seam | String-only legacy adapter; resolved spaces carry typed collections. |
| `src/commands/change.ts` | 1 | standalone-only adapter | Used only when no scoped `changesDir` is supplied. |
| `src/commands/spec.ts` | 1 | standalone-only adapter | Used only when no scoped `specsDir` is supplied. |
| `src/commands/workflow/shared.ts` | 2 | standalone-only adapter | Default parameters for legacy direct callers; CLI passes scoped collections. |
| `src/core/artifact-graph/instruction-loader.ts` | 1 | standalone-only adapter | `changeDir` option overrides it for scoped calls. |
| `src/core/change-status-policy.ts` | 2 | standalone-only adapter | Compatibility action-context construction only. |
| `src/core/change-work.ts` | 1 | standalone-only adapter | Existing standalone Archive projection. |
| `src/core/file-placement.ts` | 1 | standalone-only adapter | Existing standalone Archive fallback. |
| `src/core/list.ts` | 2 | standalone-only adapter | CLI passes scoped Change/spec collections. |
| `src/core/specs-apply.ts` | 2 | standalone-only adapter | Store v2 spec-sync write ownership is deferred; templates consume reported paths. |
| `src/utils/change-utils.ts` | 1 | standalone-only adapter | Optional `changesDir` wins for scoped callers. |
| `src/utils/item-discovery.ts` | 3 | standalone-only adapter | Optional scoped collections win; management/CLI callers supply them. |
| `src/core/store/migration-ops.ts` | 2 | later-slice owner | Migration intentionally inspects legacy source layout. |

The former `src/core/references.ts` flat `rasen/specs` join is removed. Reference content now opens a project-read scope; a Store v2 aggregate yields `reference_project_scope_required` instead of fabricating project content.

## Public compatibility type consumers

### `ResolvedOpenSpecRoot`

- Scope/adapters: `src/core/root-selection.ts`, `src/core/archive.ts`, `src/core/references.ts`, `src/core/working-set.ts`, `src/core/relationship-health.ts`.
- CLI boundaries: `src/commands/context.ts`, `doctor.ts`, `pipeline.ts`, `pipeline-library.ts`, `retain.ts`, `shared-gather.ts`, `show.ts`, `validate.ts`, `work.ts`, `workflow/instructions.ts`, `workflow/new-change.ts`, `workflow/shared.ts`.

All Store-capable callers consume `changesDir`, `specsDir`, `archiveDir`, `schemasDir`, `planningScope.paths`, or the non-serializable `scope`; none derives a Store project partition from `root.path`.

### `PlanningHome`

- Projection owner: `src/core/planning-home.ts`, `src/core/root-selection.ts`.
- Read consumers: `src/core/artifact-graph/instruction-loader.ts`, `src/core/change-status-policy.ts`, `src/commands/workflow/instructions.ts`.

`PlanningHome` remains a locator-only compatibility view. It is not accepted by Store mutation APIs.

## Directory-field consumers

### `changesDir`

- CLI/read surfaces: `src/cli/index.ts`, `src/commands/change.ts`, `doctor.ts`, `pipeline.ts`, `retain.ts`, `show.ts`, `validate.ts`, `work.ts`, `workflow/instructions.ts`, `workflow/shared.ts`, `workflow/status.ts`.
- Core scoped readers/adapters: `src/core/archive.ts`, `artifact-graph/instruction-loader.ts`, `change-status-policy.ts`, `config-api/project-addressing.ts`, `list.ts`, `planning-home.ts`, `root-selection.ts`, `store-planning/internal/resolver.ts`, `store-planning/types.ts`.
- Management: `src/core/management-api/archive.ts`, `changes.ts`, `project-space.ts`, `runs.ts`, `spaces.ts`, `task-detail.ts`.
- Standalone/later owners: `src/core/store/migration.ts`, `store/migration-ops.ts`, `view.ts`, `work-migration.ts`, `src/utils/change-utils.ts`, `item-discovery.ts`, `task-progress.ts`.
- Guidance-only mentions: `src/core/templates/workflows/archive-change.ts`, `sync-specs.ts` (both consume CLI-reported values).

### `specsDir`

- CLI/read surfaces: `src/cli/index.ts`, `src/commands/show.ts`, `spec.ts`, `validate.ts`, `workflow/shared.ts`.
- Core scoped readers/adapters: `src/core/archive.ts`, `config-api/project-addressing.ts`, `list.ts`, `references.ts`, `root-selection.ts`, `store-planning/internal/resolver.ts`, `store-planning/types.ts`.
- Collection consumers: `src/core/parsers/change-parser.ts`, `validation/validator.ts`, `view.ts`, `src/utils/item-discovery.ts`.
- Later migration owners: `src/core/store/migration.ts`, `store/migration-ops.ts`.

### `archiveDir`

- CLI/workflow: `src/commands/workflow/instructions.ts`, `workflow/status.ts`.
- Scope/core: `src/core/archive.ts`, `change-work.ts`, `config-api/project-addressing.ts`, `root-selection.ts`, `store-planning/internal/resolver.ts`, `store-planning/types.ts`, `project-home.ts`.
- Management: `src/core/management-api/archive.ts`, `project-space.ts`, `task-detail.ts`.
- Later/legacy: `src/core/store/migration-ops.ts`, `work-migration.ts`, `src/utils/item-discovery.ts`.
- Guidance-only: `src/core/templates/workflows/archive-change.ts`, `bulk-archive-change.ts`, `onboard.ts`, `ship.ts`; all use status-reported Archive locations.

## Design-document resolution

- Typed layout and routing: `src/core/store/planning-layout-v2.ts`, `src/core/store-planning/internal/resolver.ts`, `src/core/store-planning/types.ts`.
- Placement boundary: `src/core/file-placement.ts`, `src/commands/work.ts`.
- Generated guidance: `src/core/templates/experts/_shared.ts`, `experts/office-hours.ts`, `experts/qa.ts`, `experts/qa-only.ts`, `workflows/office-hours.ts`, `workflows/propose.ts`.
- Later migration owner: `src/core/work-migration.ts`.

Project guidance consumes `scope.paths["project-design-docs"]`; Store-wide guidance must explicitly request `store-design-docs`. The only root-relative fallback is the documented unbound-standalone adapter in `_shared.ts`.

## Resolved defects and follow-up ownership

- Resolved here: project-local schema lookup now consumes typed `project-schemas`; status, instructions, task progress, list, and management threads the resolved collection.
- Resolved here: references no longer read `<registeredRoot>/rasen/specs` for Store v2 aggregate roots.
- Deferred by portfolio design: `src/core/store/migration-ops.ts` retains legacy joins; Store v2 finalization/spec-sync writes remain owned by later lifecycle slices.
