## 1. Wire-type mirror

- [x] 1.1 In `packages/ui/src/api/types.ts`, add `title: string | null` to `WorkflowListEntry` (after `skillName`, before `unused`) with the doc comment copied verbatim from `src/core/management-api/wire-types.ts`
- [x] 1.2 In the same file, add `title: string | null`, `category: string | null`, `tags: string[] | null` to `WorkflowDefinitionWire` (after `kind`, before `digest`) with the doc comment copied verbatim from core

## 2. Workflow card

- [x] 2.1 In `packages/ui/src/components/WorkflowsPage.tsx`'s `WorkflowCard`, render `entry.title ?? entry.skillName` in place of `entry.skillName` inside `.workflow-card__name`

## 3. Detail panel

- [x] 3.1 In `WorkflowDetailPanel`'s facts `<dl>`, add a `Title` row rendered only when `detail.workflow.title` is non-null
- [x] 3.2 Add a `Category` row rendered only when `detail.workflow.category` is non-null
- [x] 3.3 Add a `Tags` row (comma-joined) rendered only when `detail.workflow.tags` is non-null and non-empty

## 4. Fixtures and tests

- [x] 4.1 In `packages/ui/test/fixtures/workflows.ts`, add `title` to each of the five `workflowsListFixture` entries (mix of a declared title and `null`, so both card paths are exercised) — the `satisfies WorkflowListResponse` tripwire will fail to compile until every entry has the field
- [x] 4.2 In the same file, add `title`, `category`, `tags` to `workflowDetailFixture.workflow`, using non-null values for at least one so the new detail rows have something to render
- [x] 4.3 In `packages/ui/test/components/workflows-page.test.tsx`, add an assertion that a fixture entry with a declared title renders that title (not its skill name) on the card, and one that a fixture entry with a null title still renders its skill name
- [x] 4.4 In the same file, extend the detail-panel test (around the existing `rasen-team-flow` facts assertion) to assert the Title/Category/Tags rows render for the detail fixture's declared values

## 5. Verify

- [x] 5.1 Run `pnpm --filter @rasen/ui test` (or the package's equivalent test command) and confirm the mirror, card, and detail tests pass with no `tsc` drift errors from the `satisfies` fixtures
- [x] 5.2 Confirm `packages/ui/src/components/TelemetryDisclosure.tsx` is untouched
- [x] 5.3 Validate the change (`rasen validate ui-workflow-title-sync --json`)
