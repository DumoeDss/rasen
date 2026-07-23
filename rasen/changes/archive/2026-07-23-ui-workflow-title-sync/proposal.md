## Why

The management API and CLI now let a workflow author declare a display title (and
optional category/tags) through the manifest's `skill:` presentation block, and the
CLI's own profile picker already shows that title in place of the raw skill name.
The web UI's Workflows page was not part of that change: its hand-maintained wire-type
mirror, its card, and its detail view are all still one release behind, so a titled
workflow shows its skill name in the browser while the CLI shows the author's title —
the two surfaces disagree about the same workflow.

## What Changes

- **Wire-type mirror gains the new fields.** `packages/ui/src/api/types.ts` adds
  `title: string | null` to `WorkflowListEntry`, and `title: string | null`,
  `category: string | null`, `tags: string[] | null` to `WorkflowDefinitionWire` —
  copied field order and doc comments verbatim from
  `src/core/management-api/wire-types.ts`.
- **The workflow card shows the declared title.** `WorkflowsPage`'s card renders
  `entry.title ?? entry.skillName`, matching the CLI profile picker's own fallback
  rule, so a titled workflow reads the same title everywhere.
- **The detail view surfaces the presentation metadata.** The detail panel's facts
  list gains a Title row (only when the workflow declares one) and Category/Tags rows
  (only when the workflow declares them) — the detail view already lists every other
  declared field of the definition, so these are shown for parity rather than
  designing a new layout.
- **Fixtures and component tests catch up.** `test/fixtures/workflows.ts` gains the
  new fields on its list and detail fixtures (the `satisfies WorkflowListResponse` /
  `satisfies WorkflowDetailResponse` tripwire forces this once the mirror is
  non-optional), and `workflows-page.test.tsx` gains an assertion that a titled entry's
  card shows the title instead of the skill name.

## Capabilities

### New Capabilities

(None.)

### Modified Capabilities

- `workflows-ui`: the card requirement gains the author-declared-title-with-fallback
  display rule; the detail-view requirement gains the title/category/tags fields.

## Impact

- **Code**: `packages/ui/src/api/types.ts`, `packages/ui/src/components/WorkflowsPage.tsx`,
  `packages/ui/test/fixtures/workflows.ts`, `packages/ui/test/components/workflows-page.test.tsx`.
- **Specs**: `workflows-ui` (card display rule, detail view fields).
- **Compatibility**: additive, non-breaking — `title`/`category`/`tags` are already
  sent by the (already-shipped) management API; older UI builds simply ignored the
  extra JSON fields. No API or CLI change; `packages/ui` only.
- **Out of scope**: `packages/ui/src/components/TelemetryDisclosure.tsx` (unrelated
  `command` telemetry-payload strings) is not touched. The `workflow-http-api` spec's
  endpoint-field prose is also stale (it does not mention `title`/`category`/`tags`
  either) but that is a core/API-side spec gap predating this change, not introduced
  or fixed here.
