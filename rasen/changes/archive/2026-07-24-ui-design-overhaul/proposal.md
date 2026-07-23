# ui-design-overhaul

## Why

The management web UI (`packages/ui`) has accumulated real functionality (Board, Task detail, Config, Pipelines, Workflows, canvas editor) but its composition layer is ad-hoc: buttons are dropped wherever a handler exists, cards stretch to their content, raw JSON is shown as user-facing text, and the pipeline list floods the page with every per-stage control. The user has approved the existing design tokens (warm-editorial identity, two theme variants) but enumerated 9 concrete layout/interaction defects and asked for a site-wide visual consistency pass to make the app "美观大方实用" — a modern, restrained management surface.

## What Changes

- **Shared component system** (CSS + small Preact components, consuming existing tokens only): a button hierarchy (one primary action per view; secondary; ghost/quiet; danger), a uniform card contract (equal heights in grids, fixed slot order), a proper switch control for on/off state, and a page-header/toolbar pattern applied to every page. Also fixes latent token bugs (`--radius-md` and `--warning-fg` are referenced but never defined).
- **Board**: the worktree chips become a structured, aligned strip with a consistent chip anatomy (name / branch / badges / counts in fixed order, uniform height) instead of ragged free-floating pills.
- **Task detail**: a change's task checklist renders as a structured checklist card — progress summary on top, completed items collapsed by default, inline `code` spans rendered as code — instead of a full raw dump; the sessions toolbar buttons get hierarchy and spacing.
- **Config**: list- and object-valued keys render readably (arrays as chip/tag lists with counts, objects as labeled fields) instead of raw `JSON.stringify` walls; "Inherited from …" annotations summarize list values instead of repeating the same JSON.
- **Pipelines list**: per-pipeline configuration (runtimes + per-stage GATE/MODEL/HANDOFF rows) collapses behind an explicit expand ("Configure") so the list page reads as a scannable library; the stage lane, description, and badges stay visible.
- **Pipeline creation entry merge**: "New pipeline" and "Assemble in canvas" merge into a single "New pipeline" entry that opens the canvas assembly flow; Import stays a separate entry. The scaffold-to-disk init dialog is removed from the UI (the CLI/API op is untouched).
- **Workflows**: uniform card sizes; per-space enablement becomes a switch in the card's top-right corner (disabled with an explanatory hint when required-by-closure); card actions align to a consistent footer.
- **Canvas editor viewport**: the canvas route becomes a single-viewport page — the page itself never scrolls; the skills palette and stage panel scroll internally; the flow area fills the remainder.
- **Canvas validate/save feedback**: Validate always shows a visible result (a "no issues" confirmation or an error/warning count) near the toolbar; a blocked save surfaces the blocking issues in the visible issues panel with click-to-locate the offending stage.
- **Canvas controls**: React Flow control buttons are themed with the app tokens so icons are visible in both themes; the React Flow attribution is hidden via `proOptions={{ hideAttribution: true }}`.
- **Site-wide consistency pass**: every page adopts the shared header/toolbar, card, and button-hierarchy patterns; dialogs get a consistent action order; empty/loading/error states get a consistent presentation.

Non-goals: no changes to design tokens or the two theme variants (user-approved); no information-architecture changes (routes, nav structure, page inventory stay); no CLI/HTTP API changes (the validate/save error payloads the UI needs already exist).

## Capabilities

### New Capabilities

- `ui-component-system`: the shared visual component contract of the management UI — button hierarchy, uniform card, switch control, page header/toolbar pattern, and consistent state presentation — applied across all pages.

### Modified Capabilities

- `board-ui`: the project-space worktree strip becomes a structured control group with a fixed chip anatomy (requirement "Project space board shows worktrees and switches its data source" gains presentation contract).
- `task-detail-ui`: the single-change checklist renders as a structured, progressively disclosed checklist instead of a full flat dump (children-column requirement).
- `config-ui-package`: list/object config values render readably; inherited-value annotations summarize instead of duplicating raw JSON.
- `pipelines-ui`: list page collapses per-pipeline configuration behind expand; single canvas-first creation entry; single-viewport canvas editor; always-visible validate feedback and surfaced blocking issues on save; themed canvas controls without attribution.
- `workflows-ui`: uniform workflow cards with a top-right enablement switch.

## Impact

- **Code**: `packages/ui/src/**` (style.css, page components, canvas components, new `components/ui/` primitives); `packages/ui/test/**` updated where DOM contracts change (enablement toggle → switch role, pipelines expand, canvas feedback). No `src/` (CLI) changes.
- **Build**: `packages/ui` is NOT a pnpm workspace member — install/build/test run inside `packages/ui` (`pnpm install && pnpm run typecheck && pnpm test && pnpm run build`). Root CLI tests must not regress (no root code touched).
- **APIs**: none. Validate/save already return structured issues (`PipelineValidationIssue[]`); the UI presentation changes only.
- **Dependencies**: none added. React Flow attribution removal uses the supported `proOptions` (MIT license permits it).
