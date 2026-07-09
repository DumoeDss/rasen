## Context

`telemetry-backend/admin/index.html` is a single self-contained page (~300 lines: inline `<style>` with a `:root` dark-theme variable set, and inline `<script>` with `load()`, `currentParams()`, `populateFilter()`, `renderBreakdown()`, `renderOverview()`, `renderDau()`). Its control surface today is a `.controls` flex row holding four native `<select>` elements (`#range`, `#fCommand`, `#fVersion`, `#fOs`) and one `#hideTest` checkbox, plus a hot/cold `#sourceBadge`. Every control fires `load()` on `change`, which builds the query string via `currentParams()` and re-fetches all five endpoints.

The reference `claude-relay-service` dashboard (Vue3 + element-plus + tailwind + Chart.js) is READ-ONLY inspiration for the visual vocabulary only — segmented radio-button time ranges, chip-style filters, toggle switches, rounded glass cards. Its stack must NOT be imported; the look is reproduced in hand-written inline CSS because a strict CSP and offline delivery forbid CDN, fonts, and icon libraries.

This change is UI-only. The backend stats API v2 contract (`range`, `command`, `version`, `os`, `hideTest`) and every rendering path (`renderDau`, `renderBreakdown`, `renderOverview`, source badge, users footnote) stay exactly as they are. The `populateFilter` selection-preservation logic (including keeping a selected value that fell out of the filtered list, and 40-char truncation with `title` — fix 73c3642) must be carried over faithfully to the pill implementation, not regressed.

## Goals / Non-Goals

**Goals:**
- Replace `#range` `<select>` with a segmented `<button>` group (7d / 30d / 90d / all), active button accent-filled.
- Replace `#fCommand` / `#fVersion` / `#fOs` `<select>` with pill rows of `<button>` chips: an "All" pill default, click to select, click selected again to deselect to All.
- Replace `#hideTest` checkbox with a sliding toggle switch that stays a real `<input type=checkbox>` under the hood, default checked (hide test traffic).
- Rounded-card polish, hover transitions, uppercase group labels, accent selected states, optional light glass effect — all in inline CSS.
- Real `<button>` elements with `aria-pressed` for a11y; keyboard-focusable; no horizontal overflow down to the existing 720px breakpoint.
- Keep filter re-fetch, selection persistence across refresh, 40-char truncation + `title`, source badge, footnote unchanged.

**Non-Goals:**
- No backend change; no `/api/admin/*` contract change; no new endpoint or parameter.
- No new files, dependencies, CDN assets, fonts, or icons.
- No change to the chart, overview cards, breakdown tables, or the users-approximate messaging.
- No change to Access/JWT, ingest, `wrangler.toml`, or the three assets flags.

## Decisions

**State model: keep filter state in the DOM, read by `currentParams()`.** Rather than introduce a JS state object, hold each dimension's current value on the pill container as a `data-value` attribute (empty string = "All"), and the range on the segment group as `data-range`. `currentParams()` is rewritten to read these attributes instead of `.value` of selects; every other call site is unchanged. Rationale: minimal blast radius, mirrors the existing "controls are the source of truth" design, and the change stays confined to the control block plus `currentParams`/`populateFilter`.

Alternative considered: a central `filters = {}` object. Rejected — larger diff, more places to keep in sync, no functional benefit for five controls.

**Segmented control: static buttons, no repopulation.** The four range buttons are hand-written in HTML (the set is fixed). Clicking one sets `data-range` on the group, updates `aria-pressed`/active class on all four, and calls `load()`. Rationale: the range set never changes, so it needs none of the dynamic-repopulation machinery the dimension pills need.

**Dimension pills: a `renderPills(containerId, key, data)` that replaces `populateFilter`.** It reproduces `populateFilter`'s logic exactly — read current value, union of breakdown values, re-inject a selected value that dropped out of the list, sort, dedupe — but emits `<button class="pill" data-value="…" aria-pressed>` nodes plus a leading "All" pill (`data-value=""`). Label truncation stays `v.length > 40 ? v.slice(0,40)+'…' : v` with `title` set to the full escaped value (preserves 73c3642). Click handler: if the clicked pill is already selected, reset to All; otherwise select it; then set the container `data-value`, update `aria-pressed` across the row, and call `load()`. Rationale: pills are dynamic (values come from breakdown data) so they need the same preserve-current-selection behavior selects had.

**Toggle switch: CSS-only, checkbox under the hood.** Keep `<input type=checkbox id=hideTest checked>` for a11y and keyboard, visually hidden, with a `<label class="switch">` styled track + knob driven by `:checked`. `currentParams()` still reads `$('hideTest').checked`. Rationale: preserves native checkbox semantics and the existing event wiring while delivering the switch look; no ARIA switch role needed because the underlying control is a genuine checkbox.

**Event wiring:** the range group and pill rows attach click handlers to their buttons (delegated per container); `#hideTest` keeps its `change` listener; `#refresh` unchanged. The old `['range','fCommand','fVersion','fOs','hideTest'].forEach(... 'change' ...)` array is reduced to `hideTest` only, with range/pills handled by their own click delegation.

**Escaping:** pill `data-value`, `aria-label`/`title`, and text all pass through the existing `escapeHtml`; `data-value` selection comparison uses the raw (unescaped) value held in a `dataset` read, avoiding double-escaping mismatches.

## Risks / Trade-offs

- **Regressing 73c3642 (40-char truncation + title)** → Port the exact truncation expression and set `title` to the full value on every pill; include a hands-on acceptance item exercising the known 256x long command.
- **Selection lost or duplicated after refresh** → `renderPills` re-injects the current `data-value` when absent from the new list and de-dupes, mirroring `populateFilter`; acceptance item selects a value, refreshes, confirms it stays.
- **Horizontal overflow from long pill rows** → pill rows use `flex-wrap: wrap`; verify no overflow at the existing 720px breakpoint and narrower.
- **Empty/no-data windows** (cold layer may have no backfill yet) → pill rows render just the "All" pill when a breakdown is empty; existing "No data." / "No data in window." paths are untouched.
- **CSP / offline** → everything inline; no fonts or icons added, so the glass effect uses only `backdrop-filter`/gradients that degrade gracefully.
- **Accidental scope creep into backend or shared files** → confine edits to `admin/index.html`; parallel phase-2 session owns `bin/`, `src/`, `scripts/`, tests — commit with explicit pathspec only.

## Migration Plan

1. Edit `telemetry-backend/admin/index.html` (inline CSS + control DOM + `currentParams`/`renderPills`/event wiring).
2. `npm test` inside `telemetry-backend/` — expect 29/29 (pure front-end change, no test delta).
3. `npx wrangler deploy` from `telemetry-backend/`.
4. Live regression: valid ingest `202` through the proxy to workers.dev; invalid ingest `400`; unauth `/admin` `302`/`403` via `--noproxy '*'` on `telemetry.rasen.io`.
5. User hands-on acceptance on the live panel (segmented switch, pill select/deselect, toggle, selection survives refresh, long-command pill truncation+title, empty data intact, no horizontal scroll).
6. Rollback: revert the single-file edit and redeploy; no data or schema migration involved.

## Open Questions

- None blocking. Glass effect intensity is a cosmetic call left to implementation within the "light, no external assets" constraint.
