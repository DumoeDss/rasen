## Why

The admin telemetry panel currently exposes its controls as four native `<select>` dropdowns (time range, command, version, os) plus a checkbox for hiding test traffic. With only a handful of values per dimension, the dropdowns hide the available choices behind a click, read as unpolished, and are awkward to operate — the maintainer called them "neither practical nor attractive." This change reworks the control surface into a direct, glanceable UI while leaving every metric, endpoint, and behavior it already produces untouched.

## What Changes

- Replace the time-range `<select>` with a **segmented button group**: four mutually-exclusive buttons (7 days / 30 days / 90 days / All history), the active one filled with the accent color.
- Replace the command / version / os `<select>` dropdowns with **clickable pill (chip) rows** populated from the same breakdown data: an "All" pill as the default, click a value to select it, click the selected pill again to deselect back to "All".
- Replace the hide-test-traffic checkbox with a **sliding toggle switch** (still defaulting to hide `0.0.0` smoke traffic; a real checkbox stays under the hood for accessibility).
- Apply **visual polish** consistent with the reference dashboard, hand-written in pure inline CSS: rounded cards, hover transitions, small uppercase group labels, accent-highlighted selected states, and an optional light glass effect.
- Preserve all existing behavior: filter changes re-fetch, the current selection survives a data refresh (including a selected value that dropped out of the filtered list), the hot/cold source badge, the approximate-users footnote, and the 40-character pill-label truncation with a `title` tooltip for the full value.

Non-goals: no backend change. The stats API v2 parameter contract (`range`, `command`, `version`, `os`, `hideTest`) is unchanged, and ideally only `telemetry-backend/admin/index.html` is touched. The panel stays a single self-contained no-build file with zero external dependencies (no CDN, fonts, or icon libraries).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `telemetry-admin-console`: the **Dashboard Filtering and Time Range** requirement is refined so the control affordances become a segmented time-range control, clickable dimension pills, and a toggle switch, while keeping the same time-range set, dimension filters, hide-test default, no-build single-file constraint, and source indication.

## Impact

- **Code**: `telemetry-backend/admin/index.html` only (inline `<style>` and inline `<script>` — the `.controls` block, `currentParams`, `populateFilter`, and the control event wiring).
- **APIs**: none. `/api/admin/*` request/response contract is unchanged.
- **Dependencies**: none added; strict CSP and offline behavior preserved (no external assets).
- **Deployment**: `npx wrangler deploy` from `telemetry-backend/`; the live Worker `openspec-telemetry` (workers.dev ingest + `telemetry.rasen.io` Access-gated `/admin`).
- **Tests**: `telemetry-backend` vitest suite (29 tests) must stay green; this is a pure front-end HTML change and should add no test burden.
