# Proposal: ui-profile-polish

## Why

The just-shipped profile/workflow split (PR #55) left four rough edges the user hits daily: the top nav highlights Board while on the Profiles or Workflows pages; the Config Global profile dropdown cannot select user-created profiles (and the Local dropdown silently misrepresents an override state); switching a space's profile applies immediately with no draft/confirm step and flashes a console window on Windows; and building a custom profile requires hand-enabling every dependency because the membership editor knows nothing about workflow dependencies.

## What Changes

- **Nav active-state fix**: on space-agnostic routes (`/profiles`, `/workflows`), no space-scoped nav entry (Board/Archive/Config/Pipelines) shows as active; each page highlights only its own entry.
- **Profile dropdown domains unified and honest**:
  - The user-wide (Global) `profile` config key accepts saved profile names in addition to `full`/`core`/`custom`; core resolution (`update`, init, enablement reads) resolves a saved name's stored workflow list, with an unresolvable name falling back to the default profile with a warning (mirroring the existing project-lock fallback).
  - The config HTTP wire carries scope-accurate enum domains so the Global dropdown lists `full`/`core`/`custom` plus saved names, and broken saved profiles render annotated rather than disappearing.
  - The Local (per-space) selector keeps the lock domain (Follow global / `full` / `core` / saved names — `custom` is not lockable) but now honestly displays an active override as a non-selectable "custom (this space's own selection)" state instead of pretending to follow the global profile.
- **Explicit Update flow for the space profile selector**: picking a profile only stages a draft; a new Update button performs the real switch. Unapplied drafts show an inline reminder; switching Config tabs/modes or leaving the Config route with an unapplied draft asks for confirmation via the existing dialog convention. The override-replacement confirmation folds into the Update step.
- **Windows console-window hygiene**: every non-interactive child process the CLI/daemon spawns (the enablement apply `update` subprocess, management-API bridges, session supervisor, daemon/browser launches, git helpers, codex probe, etc.) passes `windowsHide: true` so no console window flashes; the interactive editor spawn is the documented exception. A source-guard test keeps future spawn sites compliant.
- **Dependency-aware profile editing**: core computes a workflow dependency graph from existing registry data (`requires.workflows`, `requires.skills`, `requires.pipelines` → pipeline stage skills → owning workflows), splitting strong requirements (unconditional) from weak enhancements (condition-gated expert stages). A new authenticated read serves it; the Profiles membership editor cascade-enables strong dependencies when a workflow is switched ON (never on OFF), shows "enhances …" hint chips on weakly associated experts, and gains Select all / Invert bulk actions.

## Capabilities

### New Capabilities

None — every change extends an existing capability.

### Modified Capabilities

- `config-ui-package`: nav active-state correctness on space-agnostic routes; scope-accurate Global profile dropdown; explicit-Update space profile selector with unsaved-draft reminder and leave-confirmation.
- `config-key-registry`: the `profile` key's value domain becomes scope-aware in both scopes (global gains saved names; the stale global-only scope note is corrected).
- `config-http-api`: constraint metadata carries per-scope enum domains so clients can render scope-accurate choices.
- `profiles`: the user-wide profile accepts a saved profile name with graceful fallback when unresolvable.
- `profiles-ui`: cascade-enable of strong dependencies, weak-enhancer hints, and Select all / Invert bulk membership actions.
- `workflow-http-api`: a workflow dependency-graph read (strong requirements + weak enhancements per workflow).
- `windows-process-launch`: background child processes never flash a console window on Windows.

## Impact

- **Core**: `src/core/profiles.ts` (user-wide saved-name resolution seam), `src/core/config-keys.ts` (scope-aware enum for global), `src/core/config-api/serialize.ts` + wire types (per-scope enums), new dependency-graph module in `src/core/workflow-registry/`, `src/core/management-api/` (graph endpoint, router, wire types), spawn call sites across `src/` (windowsHide sweep).
- **UI**: `packages/ui/src/components/Layout.tsx`, `ConfigPage.tsx` (SpaceProfileSelector rework + leave guard), `ConfigEntryRow.tsx`/`config/controls.ts` (scope-aware enums), `ProfilesPage.tsx` + `workflow-cards.tsx` (cascade, hints, bulk actions), `api/types.ts` mirror, tests under `packages/ui/test/`.
- **No version bump; no breaking wire changes** (all wire additions are optional fields or new endpoints; `packages/ui` mirror updated in lockstep per the wire-type mirror discipline).
- Delivery: worktree `OpenSpec-polish-wt`, branch `feat/ui-profile-polish`, PR against `dev/0.1.5`.
