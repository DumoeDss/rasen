## 1. Implementation (admin/index.html only)

- [x] 1.1 In the inline `<style>`, add polished control CSS: rounded cards, hover transitions, small uppercase group labels, accent-highlighted selected states, and an optional light glass effect — all inline, no fonts/icons/CDN.
- [x] 1.2 Add segmented-control CSS (`.segment` group + `.segment button`, active/`aria-pressed` filled with `--accent`) and pill CSS (`.pill` chip, selected state, `flex-wrap: wrap` rows, 40-char-safe truncation with ellipsis).
- [x] 1.3 Add sliding toggle-switch CSS driven by a visually-hidden `<input type=checkbox>` `:checked` state (track + knob).
- [x] 1.4 Replace the `#range` `<select>` with a segmented `<button>` group (7d/30d/90d/all) using real focusable `<button>` elements with `aria-pressed`; carry the current range on the group (e.g. `data-range`, default `7d`).
- [x] 1.5 Replace the `#fCommand`/`#fVersion`/`#fOs` `<select>` elements with pill rows: a leading "All" pill (`data-value=""`) plus one `<button class="pill" aria-pressed>` per value; hold the current value on the container (`data-value`).
- [x] 1.6 Replace the `#hideTest` checkbox markup with a toggle switch that keeps a real `<input type=checkbox id="hideTest" checked>` under the hood for a11y (default ON = hide test traffic).
- [x] 1.7 Rewrite `currentParams()` to read `data-range` and each container's `data-value` (and `$('hideTest').checked`) instead of `<select>.value`; keep the emitted query string identical (`range`/`command`/`version`/`os`/`hideTest`).
- [x] 1.8 Add `renderPills(containerId, key, data)` replacing `populateFilter`: reproduce the preserve-current-selection logic exactly (union of breakdown values, re-inject a selected value that fell out of the list, sort, dedupe), emit escaped pills, and truncate labels >40 chars with a `title` holding the full value (do NOT regress fix 73c3642); point `load()` at it for command/version/os.
- [x] 1.9 Wire events: click delegation on the segment group (set active range + `aria-pressed`, then `load()`); click delegation on each pill row (select value, or deselect the already-selected pill back to "All", update `aria-pressed`, then `load()`); keep `#hideTest` `change` and `#refresh` click wired to `load()`; remove the obsolete select-based `change` listeners.
- [x] 1.10 Verify no other rendering path changed: `renderDau`, `renderBreakdown`, `renderOverview`, source badge, and the users-approximate footnote remain untouched; empty breakdowns render just the "All" pill and existing "No data." paths still fire.
- [x] 1.11 Confirm the file is still a single self-contained no-build document with zero external assets, and that pill rows wrap without horizontal overflow down to the existing 720px breakpoint.

## 2. Regression and deploy verification

- [x] 2.1 Run `npm test` inside `telemetry-backend/` (npm, NOT pnpm); expect 29/29 green (pure front-end change, no test delta).
- [x] 2.2 Deploy with `npx wrangler deploy` from `telemetry-backend/`.
- [x] 2.3 Live regression — valid ingest returns `202` through the proxy to the workers.dev endpoint (curl WITHOUT `--noproxy`).
- [x] 2.4 Live regression — invalid ingest returns `400`.
- [x] 2.5 Live regression — unauthenticated `GET /admin` returns `302`/`403` on `telemetry.rasen.io` (curl WITH `--noproxy '*'`).

## 3. User hands-on acceptance (live panel)

- [ ] 3.1 Segmented time range switches window (7d/30d/90d/all) with the active button visibly filled.
- [ ] 3.2 Pill filters select on click and deselect back to "All" on second click, for command, version, and os.
- [ ] 3.3 Toggle switch hides/shows test traffic and defaults to ON (hidden).
- [ ] 3.4 A selected dimension value survives a data refresh, including when it drops out of the refreshed breakdown.
- [ ] 3.5 The known long command renders as a truncated pill with the full value on `title` hover.
- [ ] 3.6 Empty/no-data windows keep the layout intact with no horizontal scroll at any viewport width.
- [ ] 3.7 Controls are keyboard-focusable and activatable, with selected state exposed via `aria-pressed`.

## 4. Ship

- [x] 4.1 Commit locally with explicit pathspec only (`git commit -- telemetry-backend/admin/index.html`, multi-line message via `git commit -F <file>`); do NOT push; verify with `git show --stat` that only the intended file is in the commit (shared index — see memory shared-index-commit-pathspec).
