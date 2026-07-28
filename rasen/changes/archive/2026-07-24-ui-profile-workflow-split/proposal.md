## Why

The management UI currently mixes two responsibilities on the Workflows page: browsing/managing the installable workflow library AND per-space enable/disable toggles (the user: "之前是我把 Profile 的职责和 workflow 的职责搞混在一起了"). Meanwhile the backend already has a complete named-profile system (`rasen profile new/use/update/list/delete`, saved definitions at the global config layer, and a per-project `profile` lock honored by `resolveProjectWorkflowSelection`) that the UI exposes nowhere. Separately, the pipeline canvas page STILL scrolls the whole document in real browsers — the previous viewport-lock fix passed jsdom class-presence tests but its CSS is ineffective under real layout, hiding the canvas bottom (validation errors) behind a full-page scrollbar.

## What Changes

- **New Profile page** (space-agnostic route, like Workflows): create / select / edit / delete named workflow profiles. The page body reuses the Workflows page's sectioned card + Switch presentation (Driver/Task/Expert), but the switches edit a profile's workflow membership list — no installing/uninstalling happens there.
- **Named profiles over HTTP**: new management-API endpoints exposing the existing `named-profiles` core (list, create, update, delete) so the browser can manage profile definitions the same way the CLI does.
- **Config page becomes where switching really happens**:
  - Opens on **Global** scope by default (currently Local).
  - The Local **General** tab (raw `profile`/`workflows` rows) is removed; those keys stay editable in Global scope.
  - A **Profile selector** appears at the top of the Local **Project** tab (project spaces): picking `full`, `core`, or a saved profile writes the space's profile lock and applies it immediately (install/uninstall via the same bounded `update` bridge the enablement toggles use); "Follow global profile" clears the lock. A space still carrying its own per-workflow override is surfaced with the existing reset affordance.
- **Workflows page returns to pure library management**: view/detail, New draft, Import, Validate, Export, Delete. The per-space picker and per-card enablement switches are removed (their job moves to the Profile page + Config selector). Shared card/section presentation is extracted so the Profile page reuses rather than copies it.
- **Canvas full-page-scroll fix (root-caused, empirically verified)**: the viewport lock now clamps the shell itself (`.app-shell--canvas { height: 100vh }` + `flex: 1; min-height: 0` content) instead of the dead-code `height: calc(100vh - 60px)` on a `flex: 1` item, whose flex base size resolves to content size because the shell's height is indefinite (`min-height: 100vh` only). Verified in real Chrome: current CSS → document scrolls to 2004px with an inert palette; fixed chain → shell exactly viewport-high, palette scrolls internally.

No breaking CLI or config-format changes. The existing per-space `workflows` override and the enablement HTTP ops keep working; the UI simply stops being the place that edits per-workflow space overrides.

## Capabilities

### New Capabilities
- `profile-http-api`: management-API surface for named profile definitions — list built-in + saved profiles, create/update/delete saved ones, with the CLI's validation and reserved-name rules.
- `profiles-ui`: the Profile page — browse built-in and saved profiles, create/duplicate/delete, edit a saved profile's workflow membership with the sectioned card + Switch presentation.

### Modified Capabilities
- `space-workflow-enablement`: the enablement read reports which profile lock governs a space; new mutation ops set or clear a space's profile lock (write config + bounded `update` apply), joining the existing enable/disable/reset ops.
- `workflows-ui`: the per-space enablement picker/switches requirements are removed; the page's contract narrows to library management (list, detail, init, import, validate, export, delete).
- `config-ui-package`: default scope becomes Global; Local mode no longer renders the raw Profile-group rows (General tab disappears when empty); the Local Project tab hosts the space Profile selector at the top.
- `pipelines-ui`: the viewport-locked canvas requirement is strengthened to an observable contract — on the canvas route the document itself never scrolls in a real browser; panels scroll within their own bounds.

## Impact

- **Core / management API**: new `src/core/management-api/profiles.ts` (+ router wiring, wire-types); `workflow-enablement.ts` gains `set-profile` / `clear-profile` ops and `lockedProfile` in the read. Reuses `named-profiles.ts` and `resolveProfileDefinition` as-is; no changes to profile storage or resolution semantics.
- **packages/ui**: new ProfilePage + route + nav entry; WorkflowsPage slimmed; shared workflow card/section components extracted; ConfigPage default-mode/tab-filter/ProfileSelector changes; Layout + style.css canvas height-chain fix; wire-type mirrors in `src/api/types.ts` updated alongside core (mirror discipline).
- **Tests**: root-repo tests for the new/changed management-API handlers; packages/ui jsdom tests for page structure/behavior; a CSS-level pin plus a documented real-browser measurement for the canvas lock (jsdom cannot do layout — that is how the previous fix slipped through).
- **Docs/locales**: management-API messages follow the existing English-only pattern of `workflow-enablement.ts`; no CLI locale changes required.
