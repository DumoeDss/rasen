## Why

Path-based management flows can display one path while submitting an older browsed path, and they require copy/paste plus an extra commit action even when the local server could offer a chooser. Store creation also conflates creating a new root with registering an existing one, while the header switcher remains stale after a successful creation.

## What Changes

- Make server-local path acquisition a shared chooser-style interaction for Spaces, Workflows, and Pipelines, with the existing authenticated directory browser as a dependable fallback when a native chooser is unavailable, cancelled, or unsuitable for the runtime.
- Keep the visible path and the submitted path in one selection state: typing, pressing Enter, choosing an entry, or invoking the host dialog's primary action resolves that visible value or reports an error instead of silently using an older directory.
- Split Store actions explicitly: creating a Store selects a parent directory and an id and initializes `<parent>/<id>`; registering an existing Store selects its existing root and never happens as an inferred branch of creation.
- Keep all filesystem and registry mutations behind existing CLI commands, with server-side cross-platform path validation and joining.
- Publish a successful creation to shared UI space state immediately, then revalidate the listing, so both All Spaces and the header switcher show the new entry without a full reload.
- Add cross-platform and Windows-aware coverage for chooser fallback, path resolution, Store parent-plus-id semantics, and immediate space-list consistency.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `local-path-browsing`: Extend server-local path acquisition with a chooser-style request, safe fallback behavior, and a single authoritative visible/submitted selection contract.
- `space-creation`: Replace filesystem-state inference with explicit project creation, new-Store creation, and existing-Store registration operations; new Stores derive their root from parent plus validated id.
- `spaces-ui`: Expose distinct new-Store and register-existing-Store flows and keep all space-list consumers immediately consistent after success.
- `workflows-ui`: Use the shared chooser/fallback interaction for workflow path actions without an extra folder-commit step.
- `pipelines-ui`: Replace raw absolute-path fields in pipeline import/export with the shared chooser/fallback interaction.

## Impact

The change affects the management API's local-path and space-creation contracts, their wire types and router handling, the shared UI API client and path picker, the Spaces/Workflows/Pipelines dialogs, and shared space-list state used by the Spaces page and SpaceSwitcher. It adds platform-adapter logic for native chooser attempts but no filesystem-writing path outside the CLI, no package-version bump, and no change to workflow or pipeline mutation semantics beyond how their absolute paths are acquired.
