# Design — ui-design-overhaul

## Context

`packages/ui` is a standalone Preact + Vite app (NOT a pnpm workspace member — install/build/test run inside `packages/ui`). It uses `preact-iso` routing, `@xyflow/react` (via `@preact/preset-vite` compat aliasing) for the canvas, and a single `src/style.css` holding the entire warm-editorial token system (light + dark via `prefers-color-scheme` + `data-theme`, plus an opt-in CRT variant under `data-theme-variant="crt"`). Tokens are user-approved and untouchable; the defects are all in the composition layer.

Verified root causes per user problem:

1. **Board worktree badges** — `WorktreePanel` renders variable-content pills (`.worktree-chip`) that wrap raggedly; segments have no fixed anatomy or alignment (style.css §10).
2. **Archived change detail** — `TaskDetailPage`'s `ChildChecklist` dumps every task item into one flat `<ul>`; backtick code spans render literally. The sessions toolbar (`.task-detail__sessions-toolbar`) has no gap and no button hierarchy.
3. **Config raw JSON** — `ConfigEntryRow.formatDisplayValue()` does `JSON.stringify` for any object/array; the `profile.workflows`-style array prints as a JSON wall, and `renderAnnotations()` repeats the identical JSON in the "Inherited from global" line.
4. **Pipelines overload** — `PipelineSection` renders Runtimes + every `StageOverrideRow` (GATE select, MODEL input, HANDOFF radios + number) inline for every pipeline on the list page.
5. **Two creation entries** — toolbar has "New pipeline" (`InitDialog`, CLI scaffold-to-disk) AND "Assemble in canvas" (`AssembleDialog`, name-first canvas draft).
6. **Workflows cards** — `.workflow-card` height is content-driven; enablement is a text line + "Disable here" button crammed beside it.
7. **Canvas page scrolls** — the canvas route renders inside the normal scrolling `.app-content`; `.palette-panel` grows with the skill list, pushing the page height, and `.pipeline-canvas__flow` is `70vh` inside it.
8. **Validate/save feedback invisible** — `handleValidate` stores issues, but a clean result renders NOTHING (`IssuesDrawer` returns null on zero issues), and the drawer renders at the very bottom of the (scrolling) page, off-viewport. Blocked save shows only "Fix the blocking issues before saving." at the top. The API already returns structured `PipelineValidationIssue[]` — this is purely presentation. No CLI/API change needed.
9. **Canvas controls** — React Flow's stock `Controls` ship their own white-background CSS, so icons are illegible against it in dark theme; no `proOptions={{ hideAttribution: true }}` is set, so the attribution logo shows.

Latent CSS bugs found (fix in this change): `var(--radius-md)` and `var(--warning-fg, #b45309)` are referenced in the canvas-editor rules but `--radius-md`/`--warning-fg` are never defined tokens — the intended tokens are `--radius`/`--radius-lg` and `--warn-fg`. Also `.board-page__toolbar button:first-of-type` is a fragile structural selector standing in for a real primary-button class.

## Goals / Non-Goals

**Goals**: fix all 9 enumerated problems; establish and apply a small component system (button hierarchy, uniform card, switch, page header/toolbar, state presentation) across every page; keep both themes + CRT variant working purely through tokens; `packages/ui` typecheck/test/build pass.

**Non-Goals**: no token or theme changes; no information-architecture changes (routes, nav, page inventory); no CLI/HTTP API changes; no new runtime dependencies; no redesign of the canvas graph rendering itself (nodes/edges/layout stay).

## Decisions

### D1 — Component system: CSS-first contract + three tiny primitives

The system is a **CSS contract in `style.css`** consuming existing tokens, plus minimal shared Preact components in `src/components/ui/`. No component library, no new deps.

- **Buttons** (style.css §4 extension): base `button` stays the *secondary* (warm sand) style. Add explicit classes:
  - `.btn--primary` (exists — terracotta): exactly ONE per view — the single highest-signal action (Board "New change", canvas "Save", dialog submit).
  - `.btn--ghost`: no fill, no ring; muted text, accent on hover (for Refresh, Close, per-card actions).
  - `.btn--danger`: `--danger` palette, reserved for destructive confirms.
  - Delete the `.board-page__toolbar button:first-of-type` structural selector; put `.btn--primary` on the actual element.
- **`Switch` component** (`src/components/ui/Switch.tsx`): a `<button role="switch" aria-checked>` with a CSS track/thumb built from tokens (`--accent` on, `--surface-warm` off, `--motion-fast` transition; respects `prefers-reduced-motion`). Props: `checked`, `disabled`, `onToggle`, `label` (aria-label), optional `data-testid` passthrough. Used by Workflows enablement (and available for future binary state).
- **`PageHeader` component** (`src/components/ui/PageHeader.tsx`): the standard page top row — serif `h2` title left, actions right (`.page-header` flex, baseline-aligned, `--space-5` bottom margin). Every page adopts it (Board, Archive, Config, Pipelines, Workflows, Task detail keeps its back-link header but aligns actions with the same toolbar class).
- **Card contract** (CSS only, no shared component — pages keep their BEM classes): surface + `--ring`/`--border` + `--radius-lg|xl` + `--space-4` padding; in any card grid, cards stretch to equal height per row (`grid` + `.card` as flex column, actions row pinned with `margin-top: auto`).
- **Dialog convention**: title, body, one actions row — primary action first-of-row styled `.btn--primary`, dismiss/cancel `.btn--ghost`; a single dialog never shows two filled buttons.
- **Token bug fixes**: replace `var(--radius-md)` → `var(--radius)`, `var(--warning-fg, #b45309)` → `var(--warn-fg)` throughout style.css.

**Alternative rejected**: introducing a utility-class framework or restyling every BEM block onto one `.ui-card` class — too much churn for zero user-visible gain; the contract + spot fixes achieve uniformity with reviewable diffs.

### D2 — Board: structured worktree strip

`WorktreePanel` keeps its logic (selection, `?wt=` query, live-session attribution) and gets a layout contract: an eyebrow label ("Worktrees"), one row of uniform-height chips (flex, `--space-2` gap, wrap allowed), each chip a fixed grid of segments in order: **name · branch (mono) · MAIN badge · N changes · ⦿ live**. Absent segments collapse without changing chip height. Selected chip keeps the accent fill. The Board toolbar becomes `PageHeader` ("Board" title; "New change" `.btn--primary`, "Refresh" `.btn--ghost`).

### D3 — Task detail: checklist card with progressive disclosure

`ChildChecklist` becomes a structured card:
- Header: "Tasks" + `completed/total` count + a thin progress bar (accent fill on `--surface-muted` track, tokens only).
- Open (unchecked) items always listed.
- Completed items collapsed behind a disclosure ("Show N completed") whenever there is at least one completed item; a fully-done change therefore reads as a one-line summary until expanded.
- Task text renders backtick spans as `<code>` (a tiny `renderInlineCode(text)` helper splitting on `` `…` `` — no markdown library).
- Sessions toolbar: "Launch run" `.btn--primary`, "Refresh" `.btn--ghost`, proper `--space-3` gap.

### D4 — Config: readable value rendering

New `ValueDisplay` (`src/components/ui/ValueDisplay.tsx`) replaces raw `formatDisplayValue` in *display* positions (readonly control, annotations). Rendering rules:
- `string[]` (or array of primitives): a wrapping chip list (each item a small `--surface-muted` pill, mono for ids); above ~8 items the list collapses to the first row + "N items · Show all" disclosure.
- plain object (e.g. `{ remainingTokens: 50000 }`): `key: value` pairs on one line, mono.
- primitives / null: current text behavior ("not set" for null/undefined).

Annotation lines ("Inherited from global/store: …", "shadowed by …") summarize arrays as "N items" with the chip list available behind the same disclosure — never a second JSON dump. Edit controls (toggle/select/number/text) are unchanged; only display formatting changes. `StoreInheritedCell` (Pipelines defaults) reuses `ValueDisplay`.

### D5 — Pipelines list: progressive disclosure + single creation entry

- `PipelineSection` always shows: name, provenance/source badges, lock/actions, description, the read-only stage lane, "View graph" link — and a **"Configure" disclosure button** (`aria-expanded`, chevron) that expands the Runtimes block + per-stage override rows in place. Collapsed by default; one pipeline expanded at a time is NOT enforced (independent disclosures). All controls inside are unchanged (same config-family writes).
- Toolbar merge: **"New pipeline"** (`.btn--primary`) opens the existing name-first dialog (`AssembleDialog`, retitled "New pipeline") and routes into the canvas editor with an empty draft — the current assemble flow verbatim. **"Import…"** stays. The `InitDialog` (CLI scaffold-to-disk) is removed from the UI; the API/CLI `init` op is untouched (CLI users keep `rasen pipeline init`). "Refresh" becomes `.btn--ghost`.

### D6 — Canvas: single-viewport layout

`Layout` detects a canvas route (space-prefixed `pipelines/<name>` — extend `use-space.ts` with `isPipelineCanvasPath(path)`) and adds `app-content--canvas` to `<main>`:

```css
.app-content--canvas { display: flex; flex-direction: column; height: calc(100vh - 60px); overflow: hidden; padding-bottom: var(--space-4); }
```

`.pipeline-canvas` becomes `flex: 1; min-height: 0` (already a column flex); `.pipeline-canvas__flow` drops its `70vh`/`min-height: 480px` in favor of `flex: 1; min-height: 0`; `.palette-panel` and `.stage-panel` keep `overflow-y: auto` and now actually scroll because the body row is height-bounded (`min-height: 0` on `.pipeline-canvas__body`). The page never scrolls; header/toolbar/save-message rows stay pinned above the canvas body. Non-canvas routes are untouched.

### D7 — Canvas: always-visible validation feedback

State: keep `issues`, add `lastValidation: { errorCount, warningCount, clean: boolean } | null`, reset on any draft edit (cheap: reset in `patchStage`/`onConnect`/`onEdgesChange`/`onDropStage`/rename — one helper `markDraftChanged()`).

- **Validate result chip** rendered immediately beside the Validate/Save buttons: "✓ No issues" (success tint) or "✕ 2 errors · 1 warning" (danger/warn tint). Always appears after a validate or a save attempt — never silent.
- **IssuesDrawer relocation**: renders inside `.pipeline-canvas__body` as a bottom panel of the flow column (fixed max-height ~30% of the body, own scroll, dismiss button). Because the page is viewport-locked (D6), the drawer is always on-screen when present. Click-to-select a stage (existing `onSelectStage`) also opens the StagePanel via existing selection flow; add `fitView`-style centering later only if trivial (non-goal otherwise).
- **Blocked save**: keeps `status: 'blocked'` message, and the chip + drawer make the concrete issues visible; the message text references the drawer ("N blocking issues below").

No API changes: `validatePipeline` already returns `issues[]` with `path`/`severity`/`message`, and `issuePathTarget` already maps paths to stages.

### D8 — Canvas controls: token theming + attribution removal

- Add `proOptions={{ hideAttribution: true }}` on `<ReactFlow>` (supported, MIT-licensed).
- Override React Flow control styles with tokens in style.css (after the RF stylesheet import, which lives in the canvas chunk):

```css
.react-flow__controls { box-shadow: var(--shadow); }
.react-flow__controls-button { background: var(--surface); border-bottom: 1px solid var(--border); fill: var(--fg-2); color: var(--fg-2); }
.react-flow__controls-button:hover { background: var(--surface-warm); }
.react-flow__controls-button svg { fill: currentColor; }
```

Both themes get legible icons because the values are tokens. Also theme `.react-flow__attribution` display:none as belt-and-braces (proOptions is the primary mechanism).

### D9 — Workflows: uniform cards with a top-right switch

`.workflow-card` becomes a fixed-anatomy flex column: header row (title + id left, **Switch top-right** when a space is picked and the unit is toggleable), meta row (source, digest, badges), footer actions (`.btn--ghost` Export/Delete) pinned with `margin-top: auto`; the grid stretches cards to equal height per row. Enablement text shrinks to a quiet status chip ("Installed" when applicable). `requiredByClosure` units render the switch disabled with the "required by an enabled workflow" hint (title + visible micro-text) — same no-op contract as today. `data-testid="workflow-enablement-toggle"` moves onto the switch so most tests keep working; tests asserting button text ("Disable here") are updated.

### D10 — Site-wide consistency pass

- Every page adopts `PageHeader` (title + actions); Refresh is always `.btn--ghost`; each view has at most one `.btn--primary`.
- All dialogs (workflow + pipeline + board/space dialogs) adopt the D1 dialog convention.
- Empty/loading/error states: consistent muted presentation with the retry button as secondary (existing patterns, aligned classes).
- CRT variant: verify the new components render acceptably (they consume tokens, so they inherit the variant automatically); add CRT-specific overrides only if a control is illegible (expected: switch needs `--radius-pill: 0` which it inherits — square switch is acceptable brutalism).

## Risks / Trade-offs

- **Test churn**: DOM contracts change on Workflows (toggle → switch), Pipelines (config rows behind disclosure), canvas (feedback elements). Mitigation: keep `data-testid`s stable wherever the element survives; tasks include updating the affected tests file-by-file, and the suite runs inside `packages/ui` only.
- **React Flow CSS override fragility**: RF class names are stable public API (`react-flow__controls-button`), and overrides ride after the import; a future RF major could rename them — acceptable, pinned dep.
- **Viewport lock regressions on small screens**: `app-content--canvas` uses `100vh - header`; on very short viewports panels get tight but each scrolls internally. The lock applies ONLY to the canvas route.
- **Preact compat**: new primitives are plain Preact (no compat needed); only canvas files touch compat-land.
- **Stale-validation honesty**: the validate chip resets on any draft edit so a stale "No issues" can never be shown against a newer draft.

## Migration Plan

Pure front-end change, shipped as one PR. No data, config, or API migration. UI package version stays (versioning is user-managed). Rollback = revert the PR. The removed UI init dialog has a CLI equivalent (`rasen pipeline init`) documented in the dialog's replacement hint if needed.

## Open Questions

- None blocking. (Nice-to-have deferred: centering the canvas viewport on an issue's stage when clicked from the drawer; markdown-grade rendering of task text beyond inline code.)
