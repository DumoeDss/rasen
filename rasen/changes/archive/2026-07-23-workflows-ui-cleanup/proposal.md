## Why

PR #26 retired the command delivery surface — skills are the only delivery format now — and the backend already stopped emitting command data (`workflow list`/`show` and their HTTP mirrors carry no `commandId`/`command`). The web UI was never swept: the workflow detail panel still shows a permanent "Command: none" row, the UI's wire-type mirror still declares the dead fields, and the config labels map still titles a retired key "Command delivery". Separately, the Workflows page still groups the library by provenance (Built-in / User) with the category as a small per-card chip, which hides the taxonomy the user actually navigates by (driver / task / expert, with internal units as driver plumbing).

## What Changes

- Remove every retired-command remnant from the web UI:
  - Workflow detail panel: drop the always-"none" "Command" row.
  - Workflow card: drop the never-rendered `commandId` badge and its stylesheet rule.
  - UI wire-type mirror (`packages/ui/src/api/types.ts`): drop `commandId` from `WorkflowListEntry` and `command` from `WorkflowDefinitionWire`, restoring field-for-field parity with the server's wire types.
  - Server wire type (`src/core/management-api/wire-types.ts`): drop the dead `command` field from `WorkflowDefinitionWire` — `workflowDefinitionForJson` never emits it.
  - Config labels map: drop the `delivery: 'Command delivery'` entry for the retired config key the registry no longer serves.
  - (Kept: the telemetry disclosure's "command" field — that is the live CLI command-name telemetry key, not the retired slash-command surface.)
- Workflows page: replace provenance grouping with category sections — section **driver** (with an expandable subsection revealing **internal** workflows, collapsed by default), section **task**, section **expert**. Provenance (built-in / user) stays visible per card via the existing source badge and lock marker; the per-card kind chip disappears because the section conveys it. The invalid-entries section is unchanged.
- Spec sync: the workflow-http-api spec still names `commandId`/`command` fields the server stopped emitting — align it with reality; the workflows-ui spec's listing requirement is rewritten from provenance grouping to category sections.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflows-ui`: the listing requirement changes from provenance-grouped cards with a per-card kind chip to category-sectioned display (driver with expandable internal subsection, task, expert), and the detail-view requirement drops "command" from the presented definition fields.
- `workflow-http-api`: the listing-endpoint requirement drops `commandId` from the entry fields and the detail-endpoint requirement drops `command` from the definition fields, matching what the server (and the CLI it mirrors) actually emit since the command surface retired.

## Impact

- **UI package** (`packages/ui`): `src/components/WorkflowsPage.tsx` (listing regrouped, detail row removed), `src/api/types.ts` (mirror types), `src/config/labels.ts` (dead label), `src/style.css` (dead selector), plus tests `test/components/workflows-page.test.tsx` and fixtures `test/fixtures/workflows.ts`.
- **Core** (`src/core/management-api/wire-types.ts`): one dead field removed from `WorkflowDefinitionWire`; no handler or CLI behavior changes (the emitters already omit it).
- **No API behavior change**: payloads on the wire are identical before and after; only dead type declarations and dead UI presentation are removed.
- **No collision** with the sibling `worktree-aware-spaces` change: SpacesPage, space registry, and `handleSpaces` are untouched.
