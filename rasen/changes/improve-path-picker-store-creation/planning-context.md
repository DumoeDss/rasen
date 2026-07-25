# Planning Context — improve-path-picker-store-creation

## User intent

The user reproduced three connected breaks in the local management UI:

1. Creating a Store required manually pasting an absolute path, clicking **Go**, then clicking **Create Store**. After changing the text from a parent directory to a child path without pressing **Go** again, Create silently submitted the previously browsed directory and the CLI refused it as a non-empty unhealthy Rasen root.
2. Workflow and Pipeline import/export paths have the same path-acquisition friction. The user wants a folder/file chooser style interaction that fills the path automatically instead of copy/paste plus a separate Go commit.
3. A newly created Store was present on **All spaces** but absent from the header switcher until a later refresh.

For a new Store, the selected directory should be the **parent folder**. Given Store id `rasen-store`, creation should initialize `<parent>/rasen-store`. Registering an existing Store should remain possible but should not be silently inferred from the same action.

The user explicitly requested a `rasen-auto small-feature` run in a fresh worktree/branch and delivery through a pull request.

## Grounded code findings

- `packages/ui/src/components/LocalPathPicker.tsx` keeps `pathInput` separate from the resolved `listing.path`; only a successful `browse()` calls `onDirChange`.
- `packages/ui/src/components/CreateSpaceDialog.tsx` submits its last `target` from `onDirChange`, not the visible path input. Visible text and submitted path can therefore diverge.
- Workflows already use `LocalPathPicker` for several flows but directory import still requires an extra "Use this folder" action. Pipelines still use raw absolute-path text fields for import/export.
- `src/core/management-api/create-space.ts` treats `path` as the exact Store root and infers setup vs register from whether `<path>/rasen` exists.
- `packages/ui/src/components/SpaceSwitcher.tsx` fetches spaces only on mount. SPA navigation after creation leaves its candidate map stale, while `/spaces` performs a fresh fetch.
- The creation response already contains the created `space`, so the client can make the new entry visible immediately and then revalidate.

## Design constraints

- The UI is a loopback management client, while filesystem authority remains server-side. A normal browser file input cannot supply a trustworthy server-local absolute path.
- Investigate a server-mediated native chooser only if it can degrade safely on macOS, Linux, Windows, headless, WSL, and remote/forwarded use. The existing server-local browser must remain a functional fallback.
- There must be no state where the displayed path differs silently from the submitted path. Enter/selection/primary submit must resolve or reject a dirty path explicitly.
- Store creation intent should be explicit: new Store = parent + id; existing Store registration = existing root. The server should join paths with Node's `path.join`, validate the id before joining, and never silently switch a create request into registration.
- Preserve the CLI as the only writer of Rasen roots and registry state.
- Keep all path behavior cross-platform and add Windows-aware tests.
- Creation success must update the header switcher and All Spaces coherently without a full reload.
- Do not bump package versions.

## Delivery context

- Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-ui-path-store-creation`
- Branch: `feat/ui-path-store-creation`
- Base: `origin/dev/0.1.5`
- Change: `improve-path-picker-store-creation`
- Pipeline: `small-feature`
- Gate policy: `off` from global config; gate stages auto-approve and are recorded.
