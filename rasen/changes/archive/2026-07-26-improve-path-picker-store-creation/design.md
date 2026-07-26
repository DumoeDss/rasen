## Context

`LocalPathPicker` currently owns both a visible `pathInput` and a resolved `listing.path`. It reports only the latter to its host, so editing the visible input without pressing **Go** leaves the host holding an older submission value. Workflows reuse this picker but still need an extra **Use this folder** action for directory import, while Pipelines uses raw absolute-path fields. A normal browser file input cannot reveal a trustworthy absolute path on the management server, so chooser behavior must remain server-mediated.

`POST /api/v1/spaces` currently receives `{ kind, path, id? }` and decides whether a Store request means setup or registration by probing `<path>/rasen`. That inference conflicts with the desired new-Store contract: the selected path is a parent and the Store root is its validated id joined beneath it. `SpaceSwitcher` and `SpacesPage` also fetch their own space arrays independently; the switcher fetch runs only at mount, so SPA navigation after creation cannot update it.

The management server is loopback-only, bearer-authenticated, and no-CORS. Rasen must remain cross-platform on Node.js 20.19+ and the existing CLI must remain the only writer of Rasen roots and registry state.

## Goals / Non-Goals

**Goals:**

- Give Spaces, Workflows, and Pipelines one reusable server-local path selection model with a chooser-first affordance and the existing path browser as a functional fallback.
- Guarantee that a host action submits the visible path only after that value has resolved successfully for the required selection kind.
- Make new-Store setup and existing-Store registration explicit API and UI operations.
- Compute a new Store root as `path.join(parent, validatedId)` on the server and pass that exact root to the existing CLI.
- Make a successful creation visible to the header switcher and All Spaces immediately, followed by an authoritative revalidation.
- Preserve loopback/token security, CLI-only filesystem writes, native separators, Windows drive behavior, and existing workflow/pipeline mutation contracts.

**Non-Goals:**

- Replacing the server-local browser with browser filesystem APIs or exposing client-machine paths to a remote management server.
- Adding a desktop runtime, a third-party chooser dependency, or guaranteed native-dialog support in headless, container, WSL, SSH, or remote-forwarded sessions.
- Changing CLI Store commands, workflow/pipeline package formats, overwrite semantics, or package versions.
- Adding Store adoption, Store migration, or project registration behavior.

## Decisions

### D1. Add read-only path resolution and best-effort native choice beside the existing browser

The local-path API gains two sibling operations:

- `GET /api/v1/local-paths/resolve?path=<absolute>&kind=<directory|file|file-or-directory>` validates the requested selection kind and returns the canonical absolute server-local path and native separator. It performs only path validation, `realpath`/stat-style reads, and canonicalization.
- `POST /api/v1/local-paths/choose` accepts a closed request shape for `directory` or `file` choice, with an optional already-resolved initial directory and a fixed file-filter id such as `rasen-package`. It returns a discriminated result: `selected` with a resolved absolute path, `cancelled`, or `unavailable`.

The existing `GET /api/v1/local-paths` listing remains the always-available browser and retains its home-floor behavior. The UI keeps that browser reachable whether the native attempt is unavailable or cancelled; cancellation does not erase the current value or turn into an error.

Native choice is implemented with an explicit adapter table keyed by `process.platform`, not heuristic platform matching:

- Windows uses the system Windows PowerShell executable and fixed `System.Windows.Forms` folder/file dialog scripts.
- macOS uses `/usr/bin/osascript` with fixed dialog programs.
- Linux attempts an explicitly ordered, resolved executable list for common desktop choosers (Zenity, then KDialog) only when a graphical session is available.

Adapter programs and script bodies are constants. The server spawns a resolved executable with `shell: false`; request values travel as discrete argv or environment values and are never interpolated into executable code. A selected value is passed through the same resolver before it reaches the client. Missing utilities, unsupported platforms, GUI initialization failures, WSL/headless/remote environments without a usable display, and ordinary cancellation return the structured fallback statuses rather than breaking the path control. One chooser may be open per server, it has a bounded lifetime, and the child is terminated on timeout or server shutdown.

This endpoint opens a read-only UI process, not a Rasen mutation, so it does not enter the bounded-CLI mutation whitelist. It remains protected by the router's loopback, bearer-token, no-CORS, body-size, method, concurrency, and timeout controls.

Alternatives considered:

- Browser `<input type="file">` and File System Access API handles were rejected because they identify the browser client's files and intentionally do not reveal a dependable server-local absolute path.
- A native-only picker was rejected because desktop utilities are not dependable in headless, WSL, container, or forwarded environments.
- Passing arbitrary command or filter strings was rejected in favor of a closed request enum and fixed adapter/filter tables.

### D2. Use one authoritative selection controller for visible, resolved, and submitted path state

Refactor the shared picker around a controlled selection state with:

- `value`: the exact string rendered in the path input;
- `status`: empty, dirty, resolving, resolved, or invalid;
- `kind`: directory, file, or file-or-directory;
- the current directory listing used by the fallback browser.

Typing updates `value` and immediately clears the resolved value/status; there is no retained path that a host can accidentally submit. Enter resolves the visible value. Native selection, directory navigation, file-entry selection, and a successful typed resolution all replace `value` with the canonical path and mark it resolved. Browse failures leave the visible value intact and show the error beside it.

The shared controller exposes an async resolve-for-submit action. Every host primary action calls it before invoking its mutation; a dirty visible value is resolved, canonicalized, and returned, or the action stops with an inline error. Hosts submit the returned value directly and do not keep a second target variable. For a file-or-directory import, the current browsed directory is itself a valid selection and clicking a file changes the same selection, removing the separate **Use this folder** commit.

Export dialogs continue to select an existing destination directory and edit a filename separately. They join/display the preview with the separator returned by the server; the workflow/pipeline mutation endpoint remains the final authority over the full absolute destination path. Tests build expected paths with Node's path helpers or supplied native separators rather than literal `/`.

Alternatives considered:

- Merely disabling submit while the input is dirty was rejected because it gives no primary-action resolution path and is easy for hosts to implement inconsistently.
- Keeping `pathInput` and `listing.path` with an extra synchronization callback was rejected because it preserves the two-source state that caused the bug.

### D3. Make the space-creation request a discriminated operation

Replace the ambiguous `{ kind, path, id? }` request with:

- `{ op: "create-project", path }`
- `{ op: "create-store", parent, id }`
- `{ op: "register-store", path, id? }`

The server validates the operation and only its allowed fields before spawning. For `create-store`, it validates the parent path and Store id first, then derives `targetPath = path.join(parent, id)` and invokes `rasen store setup <id> --path <targetPath> --json`. It never probes the target to change the operation to registration; a conflicting or unhealthy target is a CLI refusal. `register-store` always invokes `rasen store register <path> --yes [--id <id>] --json`, and `create-project` always invokes `rasen init <path>`.

The existing three whitelist operation ids, cap-one subprocess gate, 60-second timeout, `shell: false`, exact CLI error passthrough, and post-success `GET /spaces` re-read remain intact. Space lookup after Store setup uses the joined target, not the submitted parent.

The Spaces dialog keeps Project and Store as the top-level choice. Store adds an explicit **Create new** / **Register existing** choice. Create new labels the selected directory as the parent, requires an id, and shows the derived child intent; registration labels it as an existing Store root and allows the existing optional id override. Button text and request discriminant match the chosen action.

Alternatives considered:

- Continuing to infer setup/register from `<path>/rasen` was rejected because one UI action could silently change meaning based on filesystem state.
- Joining parent and id in the browser was rejected because the server/CLI side must own cross-platform path semantics and validation.

### D4. Share the space catalog across layout and pages, with publish-then-revalidate

Introduce one UI space-catalog store/provider used by `SpaceSwitcher`, `SpacesPage`, and creation. It owns the current `SpaceEntry[]`, loading/error state, `refresh()`, and `publish(entry)`.

After `POST /spaces` succeeds, the dialog publishes the returned listing entry before SPA navigation, then starts a background refresh. `publish` upserts by the row identity (type plus root) so a project selector shared by multiple worktrees does not collapse rows. The switcher may continue to deduplicate its options by selector. A mutation epoch/request generation prevents a list request started before `publish` from overwriting the new entry; the post-publish refresh is allowed to replace the optimistic catalog with the authoritative response. If that refresh fails, the response entry remains visible and a later manual/automatic refresh reconciles it.

Pins and recent-space ordering remain where they are; only the space listing becomes shared.

Alternatives considered:

- A hard reload was rejected because it would discard the management session token and violates the SPA behavior.
- A one-off custom browser event was rejected because it would duplicate cache/update rules among consumers and leave races with in-flight fetches.

### D5. Verify contracts at server, component, and integration seams

Server tests cover resolver kind validation and canonicalization; native-adapter selected/cancelled/unavailable/timeout outcomes without opening real dialogs; token/method routing; exact argv for all three explicit space operations; parent-plus-id joining with `path.join`; no inference when a create target already resembles a Store; CLI error passthrough; and Windows drive/separator cases.

Component tests cover dirty input followed directly by Enter and by the host primary action, invalid visible values, native selected/cancelled/unavailable fallback, directory and file selection, removal of Workflow's extra folder commit, Pipeline import/export adoption, Store mode request shapes, and export destination joining with server-native separators.

Catalog tests cover immediate switcher/All Spaces visibility, stale-fetch suppression, authoritative revalidation, refresh failure retention, selector-sharing worktrees, and navigation after publication.

## Risks / Trade-offs

- [Native chooser support varies by desktop environment] → Keep the authenticated path browser usable at all times and treat missing/failing adapters as `unavailable`.
- [A chooser process can remain open while a user walks away] → Allow only one chooser, apply a bounded timeout, and terminate the child during shutdown.
- [Launching a local GUI from an HTTP request expands the loopback attack surface] → Retain bearer authentication and no CORS, accept only closed enums, use fixed adapter programs/scripts, validate every path, and never invoke a shell.
- [A server may be local to the CLI but remote from the browser] → Label selections as server-local and keep the explicit path/browser fallback; never use browser-side file handles.
- [Optimistic publication can disagree with a later listing] → Publish only the server's successful response entry, protect it from stale requests, and revalidate immediately.
- [The discriminated request breaks old in-repo UI callers] → Update server/client wire mirrors and all call sites atomically; this loopback API has no separately versioned external client.

## Migration Plan

1. Add the resolver/chooser server contracts and shared UI selection controller while retaining directory-listing fallback.
2. Convert Workflow and Pipeline path dialogs and their tests to the shared controller.
3. Change the space request wire type and server bridge to explicit operations, then update the Spaces dialog.
4. Introduce the shared catalog provider and publish-then-revalidate creation flow.
5. Run targeted server/UI tests, type checks, and full Rasen change validation.

There is no persisted-data migration and no package-version bump. Rollback is a code revert; roots and registrations created through the CLI remain valid.

## Open Questions

None. Native-dialog availability is deliberately a runtime best-effort decision, not a release prerequisite.
