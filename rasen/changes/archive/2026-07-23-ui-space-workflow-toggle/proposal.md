## Why

The Workflows page in the management web UI is read-only with respect to spaces: a user can browse and manage the user-wide workflow library, but cannot enable or disable a workflow for a specific space. Today the only path is the CLI (`rasen profile` to change the selection, then `rasen update` inside the project) — and even that path is machine-global: the workflow selection lives only in the global config, so it is impossible to give one space a different workflow set from another. Users working across several spaces need a per-space toggle in the UI that behaves like installing/uninstalling via `rasen profile`, without affecting their other spaces.

## What Changes

- The workflow selection gains a per-space (project-scope) override: a space can carry its own workflow selection in its project config, which takes precedence over the user-wide profile for that space only. Spaces without an override continue to follow the user-wide profile exactly as before.
- `rasen update` and profile drift detection resolve the effective selection per project (project override when present, otherwise the user-wide profile), so applying, syncing, and drift warnings all honor the per-space selection.
- The management HTTP API gains a per-space workflow enablement surface: a read endpoint reporting, for a given space, each selectable workflow's enabled and installed state and whether the space follows the user-wide profile or its own override; and mutation operations to enable a workflow, disable a workflow, or reset the space back to following the user-wide profile. Selection writes go through the unified config layer in-process (the same comment-preserving project-config write path `rasen config set` uses); applying the new selection to the space's files runs through the existing bounded-CLI bridge by spawning the CLI's own `update` in the space's root.
- The Workflows page gains per-space enablement controls: the user picks a space, each workflow card shows its enabled state in that space with a toggle, and a space carrying its own override visibly says so and offers a reset back to the user-wide profile. Toggling affects only the chosen space.
- Core wire types and the UI's mirrored API types/client are extended together for the new endpoint and operations (core-wire-types + UI-mirror discipline).

## Capabilities

### New Capabilities

- `space-workflow-enablement`: Per-space workflow enablement — a project-scope workflow selection override, its resolution precedence against the user-wide profile, and how update/drift honor it.

### Modified Capabilities

- `profiles`: Selection resolution is no longer machine-global-only — the desired workflow set for a project resolves from the project's own override when one exists, otherwise from the user-wide profile; drift detection evaluates against that per-project effective selection.
- `config-key-registry`: The `workflows` selection key becomes settable at project scope (today global-only), so a space can carry its own selection in `rasen/config.yaml`.
- `workflow-http-api`: New per-space enablement read endpoint and enablement mutation operations (enable / disable / reset), guarded like existing mutations and applying changes via the bounded CLI bridge.
- `workflows-ui`: The Workflows page adds per-space enablement controls (space picker, per-card toggle, override indicator, reset-to-profile), while remaining the user-wide library manager it is today.

## Impact

- Core: `src/core/config-keys.ts` (key scopes), `src/core/profiles.ts` / `src/core/update.ts` / `src/core/profile-sync-drift.ts` (per-project effective selection), `src/core/management-api/` (new enablement handlers, `wire-types.ts`, whitelist entry for the bounded `update` spawn, router).
- UI: `packages/ui/src/api/types.ts` + `client.ts` (mirrored wire types and calls), `packages/ui/src/components/WorkflowsPage.tsx` (enablement controls), plus UI tests.
- Behavior: no change for spaces without an override — they keep following the user-wide profile. No version bump (user owns versioning). Cross-platform paths throughout (space roots are absolute paths in native form on Windows/macOS/Linux).
