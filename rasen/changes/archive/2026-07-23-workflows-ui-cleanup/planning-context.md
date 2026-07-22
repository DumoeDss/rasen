# Planning context: workflows-ui-cleanup

## User intent (verbatim, 2026-07-23)

> 1. 首先我们已经把commands完全移除了（pr#26），因此ui中关于Command的内容都需要更新移除（比如workflow卡片点开后会显示Command none）。
> 2. Workflows页面应该把这些workflow进行分区展示，而不是在每个卡片上写着分类：第一分区driver（可展开显示internal），第二分区task。第三分区expert

Two deliverables, one change (both live in the Workflows UI surface):

1. **Remove all Command remnants from the UI.** PR #26 (skills-only delivery) removed slash commands entirely from the product — delivery is skills-only now. The UI still surfaces command concepts, e.g. opening a workflow card shows "Command: none". Sweep the whole UI (not just the Workflows page) for command-related labels/fields/copy and remove or update them. This is dead-concept cleanup, not a rename.
2. **Workflows page: sectioned display by category.** Replace the per-card category label with three page sections: section 1 **driver** (expandable to reveal **internal** workflows), section 2 **task**, section 3 **expert**. The category taxonomy already exists in the data; the change is presentation — grouping instead of per-card badges.

## Known constraints & decisions (LEAD-provided)

- Base branch: `feat/workflows-ui-cleanup` off `dev/0.1.5` (main checkout OpenSpec-code). PR #26 and #27 are already merged into dev/0.1.5, so the workflows/pipelines page layout is the post-#27 restructured one — read the CURRENT code, not memory of older layouts.
- Workflow category vocabulary: driver / internal / task / expert (internal nests under driver in the new sectioned view).
- UI lives in `packages/ui` (React). Relevant docs that may carry context: `docs/pr-13-workflow-library-overview.md`, `rasen/office-hours/ui-config-and-library-redesign.md` (both untracked working files in the repo root — treat as background, not authority; the code is authority).
- Management HTTP API serves the workflow metadata — if the API payload still carries command fields, decide whether the cleanup is UI-only or extends to the API response shape; prefer removing dead fields at the source if they exist only for the retired command concept, but do NOT expand scope into the CLI delivery machinery (that was PR #26's job and it is done).
- Spec-merge guard: scenario-set changes to an existing requirement need REMOVED+ADDED with DISTINCT requirement names (the validator rejects same-name pairs).
- Small-feature scope: keep tasks tight. UI grouping + command-remnant sweep + any minimal API/type cleanup + tests.

## Sibling work (do not collide)

A parallel change `worktree-aware-spaces` is being proposed in the dev015 worktree (branch `feat/worktree-aware-spaces`) touching SpacesPage / space registry / management-api handleSpaces. This change should avoid restructuring those files; overlap is expected to be zero. If you find unavoidable overlap, record it in the proposal as a risk.

## Planner findings (appended 2026-07-23, propose stage)

- The backend is ALREADY clean: `handleWorkflowsList` (src/core/management-api/workflows.ts:41) emits no `commandId`, and `workflowDefinitionForJson` (src/core/workflow-library.ts:593) emits no `command`. The dead weight is declaration-only: `src/core/management-api/wire-types.ts:421` (`WorkflowDefinitionWire.command`), the UI mirror `packages/ui/src/api/types.ts:603/632`, fixtures `packages/ui/test/fixtures/workflows.ts`, and two render sites in `WorkflowsPage.tsx` (:214 badge, :310 "Command: none" row). No wire payload changes at all in this change.
- The UI mirror discipline (hand-maintained copy of wire-types.ts, pinned by `satisfies` fixtures) was violated by PR #26's server-side removal — this change restores parity. Future spec/API sweeps should treat `packages/ui/src/api/types.ts` as a mandatory stop.
- `delivery: 'Command delivery'` in `packages/ui/src/config/labels.ts:11` is unreachable dead code: `delivery` is in `RETIRED_CONFIG_KEYS` (src/core/config-keys.ts:85) and the config-key-registry spec guarantees the registry never serves it in any scope.
- NOT a remnant: `TelemetryDisclosure.tsx`'s "command" payload key documents the live `trackCommand` CLI telemetry field (src/telemetry/index.ts) — keep.
- Decided section order: driver, task, expert (user's verbatim order), even though the CLI human table orders task first (src/commands/workflow-library.ts:107). Internal nests in the driver section behind a collapsed-by-default disclosure, mirroring the CLI's `--all` gating. Provenance moves entirely onto the card (source badge + lock); export/delete gating must now derive from `entry.source` per card, not per group.
- Spec deltas written: `workflows-ui` listing requirement needed REMOVED+ADDED under a DISTINCT name ("…in category sections") because its scenario set changed; the detail-view requirement and both `workflow-http-api` endpoint requirements were prose-only field-list edits with scenarios intact → MODIFIED. `rasen validate workflows-ui-cleanup --type change` passes.
