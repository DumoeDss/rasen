## 1. Shared component system (foundation — everything else builds on this)

- [x] 1.1 In `packages/ui/src/style.css`, fix latent token bugs: replace every `var(--radius-md)` with `var(--radius)` and every `var(--warning-fg, #b45309)` with `var(--warn-fg)`; verify no other undefined `var(--*)` references remain (grep `var(--` against the token block)
- [x] 1.2 Extend the button hierarchy in style.css §4: keep base `button` as secondary, add `.btn--ghost` (no fill/ring, muted → accent hover) and `.btn--danger` (danger palette); remove the `.board-page__toolbar button:first-of-type` structural selector (the class moves onto the element in 2.1)
- [x] 1.3 Create `packages/ui/src/components/ui/Switch.tsx`: `<button role="switch" aria-checked>` with token-built track/thumb CSS (`.ui-switch` in style.css), props `checked/disabled/onToggle/label/testid`; keyboard operable, visible disabled state, `prefers-reduced-motion` respected; works in light/dark (and inherits CRT via tokens)
- [x] 1.4 Create `packages/ui/src/components/ui/PageHeader.tsx` (title + actions toolbar row, `.page-header` CSS) and adopt it on Board, Archive, Config, Pipelines, and Workflows pages (title left, actions right; exactly one `.btn--primary` per page: Board "New change", Workflows "New draft", Pipelines "New pipeline"; Refresh/Close become `.btn--ghost`)
- [x] 1.5 Create `packages/ui/src/components/ui/ValueDisplay.tsx`: arrays → chip list with count + "Show all" disclosure past ~8 items; plain objects → labeled `key: value` fields; primitives/null → text ("not set"); add its CSS (`.value-display*`) with tokens only
- [x] 1.6 Add component tests: `packages/ui/test/components/ui/switch.test.tsx` (toggle, aria-checked, disabled inert, keyboard) and `value-display.test.tsx` (array chips + disclosure, object fields, null); run `pnpm test` inside `packages/ui` — green
- [x] 1.7 Apply the dialog action convention across all existing dialogs (workflow dialogs, pipeline dialogs, NewChangeDialog, LaunchSessionDialog, CreateSpaceDialog): submit/confirm is the dialog's only `.btn--primary` (danger confirms use `.btn--danger`), Close/Cancel are `.btn--ghost`; verify `pnpm run typecheck && pnpm test` in `packages/ui` still pass

## 2. Board page (problem 1)

- [x] 2.1 BoardPage toolbar → PageHeader: "New change" gets explicit `.btn--primary`, "Refresh" `.btn--ghost` (both in the normal and empty states)
- [x] 2.2 Restructure `WorktreePanel` + `.worktree-*` CSS into the structured strip: eyebrow label ("Worktrees"), uniform-height chips in one aligned wrapping row, fixed segment order (name · branch mono · MAIN badge · N changes · ⦿ live), absent segments collapse without height change, selected chip keeps accent fill; keep all selection/`?wt=`/session-count logic untouched
- [x] 2.3 Update `packages/ui/test/components/board-page.test.tsx` if any DOM assertions touch the toolbar/panel markup; run the board tests — green

## 3. Task detail page (problem 2)

- [x] 3.1 Add `renderInlineCode(text)` helper (splits `` `…` `` spans into `<code>`) with a small unit test; apply it to checklist item text (and child names/errors are left as-is)
- [x] 3.2 Rebuild `ChildChecklist` as the checklist card: header "Tasks · completed/total" + token-built progress bar, open items always listed, completed items behind a "Show N completed" disclosure (collapsed by default when any item is completed); style with tokens (`.task-checklist*`)
- [x] 3.3 Sessions toolbar: "Launch run" `.btn--primary`, "Refresh" `.btn--ghost`, `--space-3` gap (fix `.task-detail__sessions-toolbar`)
- [x] 3.4 Update `packages/ui/test/components/task-detail-page.test.tsx` for the new checklist DOM (progress summary, disclosure reveals completed items, code spans); run — green

## 4. Config page (problem 3)

- [x] 4.1 Replace display-position `formatDisplayValue` usage in `ConfigEntryRow` with `ValueDisplay`: the readonly control (`.control--readonly`) renders arrays as chip lists and objects as labeled fields
- [x] 4.2 Rework `renderAnnotations()`: inherited-from / shadowed-by lines summarize array values as "N items" with the chip list behind a disclosure — never a second serialized dump; primitives keep current inline text; keep every annotation's layer-naming and store-edit link intact
- [x] 4.3 Reuse `ValueDisplay` in `StoreInheritedCell` on the Pipelines page (same JSON.stringify problem there)
- [x] 4.4 Update `packages/ui/test/components/config-entry-row.test.tsx` / `config-page.test.tsx` for the new value rendering (array value → items + count, no raw `["…"]` text); run — green

## 5. Pipelines list page (problems 4 + 5)

- [x] 5.1 Add the per-pipeline "Configure" disclosure to `PipelineSection` (`aria-expanded`, collapsed by default, independent per pipeline): summary always shows name/badges/lock/description/stage-lane/"View graph"; Runtimes block + `StageOverrideRow`s render only when expanded, controls and write plumbing unchanged
- [x] 5.2 Merge creation entries: retitle `AssembleDialog` to "New pipeline" and wire the toolbar's single "New pipeline" (`.btn--primary`) to it; delete `InitDialog` and its toolbar button (CLI `rasen pipeline init` is unaffected); keep "Import…" and ghost "Refresh"
- [x] 5.3 Update `packages/ui/test/components/pipelines-page.test.tsx`: config controls appear only after expanding (`pipeline-configure` toggle), init-dialog tests removed, single creation entry asserted (assemble flow testids preserved); run — green

## 6. Workflows page (problem 6)

- [x] 6.1 Rebuild `WorkflowCard` anatomy: flex-column card with header row (title/id left, enablement `Switch` top-right when a space is picked and the unit is toggleable), meta row (source/digest/unused/locked chips + quiet "Installed" state chip), footer actions (`.btn--ghost` Export/Delete) pinned via `margin-top: auto`; grid rows stretch cards to equal height
- [x] 6.2 Wire `Switch` to the existing `enablement.onToggle` (keep `data-testid="workflow-enablement-toggle"` on the switch); `requiredByClosure` units render the switch disabled with the "required by an enabled workflow" reason (visible micro-text + title)
- [x] 6.3 Update `packages/ui/test/components/workflows-page.test.tsx`: toggle assertions target the switch (`role="switch"`, `aria-checked`), closure-required asserts disabled switch + reason, no "Disable here" text; run — green

## 7. Canvas editor (problems 7 + 8 + 9)

- [x] 7.1 Add `isPipelineCanvasPath(path)` to `src/store/use-space.ts` (space-prefixed pipelines route WITH a name segment, cross-platform-safe pure string logic) with unit tests in `test/store/use-space.test.ts`
- [x] 7.2 Viewport lock: `Layout` adds `app-content--canvas` to `<main>` on canvas routes; CSS: `.app-content--canvas { display:flex; flex-direction:column; height: calc(100vh - 60px); overflow:hidden; }`, `.pipeline-canvas { flex:1; min-height:0; }`, `.pipeline-canvas__body { min-height:0; }`, `.pipeline-canvas__flow` drops `70vh`/`min-height:480px` for `flex:1; min-height:0`; palette + stage panel scroll internally; verify non-canvas routes scroll as before
- [x] 7.3 Validation feedback state: add `lastValidation` ({errorCount, warningCount, clean}) set by every validate/save-validate, cleared by any draft mutation (one `markDraftChanged()` helper called from patchStage/onConnect/onEdgesChange/onDropStage/rename/description edit); render the result chip beside Validate/Save ("✓ No issues" success tint / "✕ N errors · M warnings" danger tint)
- [x] 7.4 Relocate `IssuesDrawer` into the flow column as a bottom panel (max-height ≈30% of body, own scroll, dismiss button) so it is always on-screen in the locked viewport; blocked-save message references the visible issues ("N blocking issues below"); click-to-locate keeps selecting the stage (opens StagePanel)
- [x] 7.5 Controls + attribution: add `proOptions={{ hideAttribution: true }}` to `<ReactFlow>`; token-theme the controls in style.css (`.react-flow__controls-button` background `--surface`, icon `--fg-2` via `fill: currentColor`, hover `--surface-warm`, border `--border`) so icons are legible in both schemes; `.react-flow__attribution { display:none; }` as belt-and-braces
- [x] 7.6 Update `packages/ui/test/canvas/pipeline-canvas-page.test.tsx`: clean validate shows the no-issues chip, findings show counts, draft edit clears the chip, blocked save renders message + issues panel, ReactFlow receives `proOptions.hideAttribution`; run — green

## 8. Site-wide consistency + verification

- [x] 8.1 Consistency sweep with the component contract: every page uses PageHeader; one `.btn--primary` per view; Refresh/Close/Cancel ghost everywhere; loading/empty/error states use the shared muted presentation (Archive, Spaces, SessionRow kill-confirm → `.btn--danger`)
- [x] 8.2 Visual pass in both themes (light + dark; spot-check CRT variant renders legibly): Board strip, checklist card, config chips, pipelines disclosure, workflow switches, canvas viewport/controls — fix any token-derived contrast misses found
- [x] 8.3 Full gate inside `packages/ui`: `pnpm run typecheck && pnpm test && pnpm run build` all green (build output verifies the Vite production bundle; canvas chunk still lazy per existing build-split test)
- [x] 8.4 Root repo check: confirm no files outside `packages/ui/` changed (`git status`), so CLI tests cannot regress; run `rasen validate ui-design-overhaul --strict` on the change artifacts
