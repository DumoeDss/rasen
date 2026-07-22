## Why

The Config page renders all 25 registry keys as one scrolling column, repeats a per-row `Scope` select on every writable multi-scope key (~8 UI elements per row), and shows an "arrives with the Config redesign" stub for store spaces even though the backend (after the in-flight `ui-config-redesign-store-scope` change, W1) fully serves them. This is the W2 workstream of the ratified UI config & library redesign (`rasen/office-hours/ui-config-and-library-redesign.md`): scope becomes a page mode, keys get tabs and human labels, and store inheritance becomes visible and navigable.

## What Changes

- **Page-level Global / Local segmented control** replaces the per-row Scope select: it selects the write target AND filters visible keys by scope. `Local` always means the current space's root — `project` scope at a project space, `store` scope at a store space (consuming W1's `scope: 'store'` writes). Keys not settable in the active mode are simply absent; there is no third toggle state.
- **Store spaces get a working Config page** — the deferred-stub notice is removed; a store space edits its own values in Local mode through W1's space addressing.
- **Inherited-value line** in Local mode: a multi-scope key with no local value shows where its value comes from (global, or the inherited store with its id) with the value — the existing shadowed-value element inverted.
- **Store-inherited rows are read-only with an "edit in store" link** that switches space to that store's Config page (navigation, not a third mode). A project with no `store:` declaration shows no store affordance anywhere.
- **Tabs over the registry `group` field**: `General` (Profile + Appearance + Behavior) · `Project` (Project + Archive) · `Privacy` (Telemetry) · `Advanced` (featureFlags) — plus an **interim `Workflow` tab** holding the Workflow group (12 role-matrix keys) and the Autopilot group (2 keys + the read-only gates inventory, both unchanged) until W3 moves them to the Pipelines page. A tab with no visible keys in the active mode is not shown.
- **Human labels**: each row titles on a readable label with the dot-path key as secondary text.
- **UI consumes W1's API surface**: config calls move from `?project=` to space addressing, and the UI's wire-type mirrors gain `store` in scopes/sources/scopeValues plus the response-level store reference. No new API surface is added; the UI remains a pure API client.
- Unset actions follow the page mode: the active mode's value is the one offered for unset.

## Capabilities

### New Capabilities

(none — all behavior belongs to the existing `config-ui-package` capability)

### Modified Capabilities
- `config-ui-package`: three requirements are replaced — source-transparent rendering gains the store source, the inherited-value line, the store-edit link, and store-space support; scope-explicit per-row editing becomes the page-level mode (write target + filter); the "Autopilot and Workflow groups lead the page" ordering becomes the tabbed layout with the interim Workflow tab. The gates-inventory requirement and all shell/build/auth/theming requirements are untouched.

## Impact

- **UI only** (`packages/ui`): `ConfigPage.tsx` (mode control, tabs, store-space support, stub removal), `ConfigEntryRow.tsx` (scope select removed, labels, inherited line, store link, mode-driven write/unset), `config/controls.ts` (`writableScopes`/`defaultWriteScope` become mode-aware and store-aware), `config/grouping.ts` (tab mapping over groups), new label constant, `api/client.ts` (space addressing for config calls), `api/types.ts` (store in `ConfigScope`/`ConfigSource`/`scopeValues`, store reference on responses). No server, CLI, or registry changes — W1 already shipped the whole backend.
- **Dependency**: requires W1 (`ui-config-redesign-store-scope`) implemented and review-clean on the main tree; W2 consumes exactly W1's promised interface (space addressing beside `?project=`, `scopeValues { global?, store?, project? }`, response store ref, store-scope writes valid only at store spaces) and must not re-derive or duplicate any of it.
- **Tests**: `packages/ui/test` — config-entry-row, page/app tests, fixtures gain store scope values; no registry count assertions (portfolio rule).
- Not touched: visual design tokens/theme (frozen), `config-http-api` spec (W1 owns it), `GatesInventoryPanel` (dies in W3), CLI behavior, versions.
