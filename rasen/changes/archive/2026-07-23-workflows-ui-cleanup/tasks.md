## 1. Remove dead command declarations from the wire types (bottom-up, tsc as tripwire)

- [x] 1.1 Remove the `command` field from `WorkflowDefinitionWire` in `src/core/management-api/wire-types.ts` (line ~421) — `workflowDefinitionForJson` (src/core/workflow-library.ts:593) never emits it; confirm no other reference in `src/` breaks (`pnpm exec tsc --noEmit` at the repo root)
- [x] 1.2 In `packages/ui/src/api/types.ts`, remove `commandId: string | null` from `WorkflowListEntry` (~line 603) and `command: {...} | null` from `WorkflowDefinitionWire` (~line 632), restoring field-for-field parity with `src/core/management-api/wire-types.ts`
- [x] 1.3 In `packages/ui/test/fixtures/workflows.ts`, drop `commandId` from both listing entries and `command` from the detail fixture — the `satisfies WorkflowListResponse`/`satisfies WorkflowDetailResponse` pins must still typecheck, proving mirror and fixtures agree

## 2. Sweep command remnants out of the UI components

- [x] 2.1 In `packages/ui/src/components/WorkflowsPage.tsx`, remove the card's `commandId` badge (`workflow-card__command` span, ~line 214) and the detail panel's `Command` `<dt>/<dd>` row (~line 310)
- [x] 2.2 In `packages/ui/src/style.css` (~line 807), drop `.workflow-card__command` from the shared rule, keeping `.workflow-card__digest` styling intact
- [x] 2.3 In `packages/ui/src/config/labels.ts`, delete the `delivery: 'Command delivery'` entry (retired key, never served by the registry — design D5); leave `TelemetryDisclosure.tsx`'s "command" payload key untouched (live CLI telemetry field, design Context)
- [x] 2.4 Grep `packages/ui/src` for remaining `command`/`Command` occurrences and confirm the only survivors are the telemetry-disclosure ones (documenting `trackCommand`'s payload)

## 3. Rebuild the Workflows listing as category sections (specs: workflows-ui "category sections" requirement; design D1–D3)

- [x] 3.1 In `WorkflowsPage.tsx`, replace the `builtIns`/`userWorkflows` provenance split with kind partitions (`driver`, `internal`, `task`, `expert`) and render sections in the order driver, task, expert; an empty category renders no section (keep the existing `workflows-group` markup idiom; give sections stable testids, e.g. `workflows-section-driver`/`-task`/`-expert`)
- [x] 3.2 Move export/delete gating onto the card: derive the affordances from `entry.source === 'user'` inside `WorkflowCard` (or pass per-entry flags), since one section now mixes provenance; built-in cards keep the lock marker and source badge, and the per-card kind chip (`workflow-card__kind`, testid `workflow-kind`) is removed
- [x] 3.3 Add the driver section's internal disclosure: a "Show internal (N)" toggle (plain `useState`, collapsed by default, omitted when no internal workflows exist) revealing internal-kind cards inside the driver section; give the toggle and revealed group testids (`workflows-internal-toggle`, `workflows-section-internal`)
- [x] 3.4 Keep the Invalid section exactly as is, after the three category sections

## 4. Update component tests to the new contract

- [x] 4.1 Rewrite the grouping test in `packages/ui/test/components/workflows-page.test.tsx` ("groups by provenance…") to assert category sections in driver/task/expert order, absence of empty sections, absence of the per-card kind chip, and the per-card source badge + built-in lock inside a mixed section (extend `test/fixtures/workflows.ts` with an expert entry and an internal entry so all four kinds have coverage)
- [x] 4.2 Add an internal-disclosure test: internal cards hidden on render, revealed after clicking the toggle; toggle absent when the fixture has no internal entries
- [x] 4.3 Update the built-in-lock and mutation-flow tests to locate cards via the new section testids where they previously used `workflows-group-built-in`/`workflows-group-user`
- [x] 4.4 Add a detail-panel assertion that the facts list shows kind/source/skill/digest and no "Command" row (guards the remnant from returning)

## 5. Verify

- [x] 5.1 `pnpm exec tsc --noEmit` (root) and the UI package typecheck/build pass — proves the mirror, fixtures, and server wire types agree with no `command` fields anywhere
- [x] 5.2 Run the UI package test suite (`pnpm --filter ui test` or the repo's equivalent) green; run the root suite for `management-api` tests touching wire types
- [x] 5.3 `rasen validate workflows-ui-cleanup --type change` passes; on Windows (this machine) confirm no path-form assumptions were introduced (the change touches no filesystem paths, so this is a review check, not new code)
