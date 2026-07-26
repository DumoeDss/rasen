## 1. Read-only server path acquisition

- [x] 1.1 Add wire types and router/client contracts for resolving an absolute server-local path by selection kind and for requesting a directory/file chooser with selected, cancelled, and unavailable results.
- [x] 1.2 Implement the read-only path resolver using existing filesystem canonicalization plus Node path/stat APIs, including absolute-path, control-character, kind, missing-path, permission, native-separator, and Windows drive-case coverage.
- [x] 1.3 Implement the fixed per-platform native chooser adapter table (Windows PowerShell, macOS osascript, Linux Zenity then KDialog) with `shell: false`, closed modes/filters, test seams, cap-one concurrency, cancellation, unavailable handling, timeout, and child cleanup.
- [x] 1.4 Add management-router tests proving chooser/resolve token and method enforcement, structured error/status responses, canonical selected paths, no filesystem writes, and fallback behavior without launching real desktop dialogs.

## 2. Authoritative shared path selection

- [x] 2.1 Add UI API client methods and mirrored chooser/resolver response types, keeping server and UI fixtures type-compatible.
- [x] 2.2 Refactor the shared local-path selection controller so its visible value, dirty/resolved status, current listing, native choice, Enter handling, and resolve-for-submit action share one source of truth and clear any older resolved value on edit.
- [x] 2.3 Update `LocalPathPicker` to expose chooser-first directory/file affordances while retaining the home-rooted typed-path/browser fallback, canonical selection feedback, file entries, git badges, cancellation preservation, and inline resolution errors.
- [x] 2.4 Add component tests for native selected/cancelled/unavailable outcomes, Enter resolution, primary-action resolution of a dirty value, invalid typed paths, directory/file selection, and Windows-native separators with no visible/submitted divergence.

## 3. Workflow and Pipeline path flows

- [x] 3.1 Convert Workflow init, path validation, import, and export dialogs to the shared selection controller; make the current import directory directly usable and remove the separate Use-this-folder action.
- [x] 3.2 Extend Workflow UI tests for chooser and fallback paths, direct directory import, package-file import, dirty-value submission, CLI-error passthrough, overwrite retry, and cross-platform export destination construction.
- [x] 3.3 Replace Pipeline import/export raw absolute-path fields with the shared file/directory selection control while preserving package conflict, overwrite, lock, and one-mutation-at-a-time behavior.
- [x] 3.4 Extend Pipeline UI tests for selected package import, dirty-value submission, unavailable/cancelled fallback, native destination preview/submission, Windows separators, and existing overwrite/referrer flows.

## 4. Explicit Store creation and registration

- [x] 4.1 Replace the legacy space request wire shape with discriminated `create-project`, `create-store`, and `register-store` variants in server types, UI mirrors, client calls, and fixtures.
- [x] 4.2 Refactor the space-creation bridge to validate only the selected operation, validate Store ids before joining, derive a new Store root with `path.join(parent, id)`, remove filesystem-state verb inference, and locate setup success by the joined root while preserving CLI-only writes, whitelist admission, bounds, and passthrough errors.
- [x] 4.3 Update server tests with exact argv for all three operations, legacy/ambiguous input rejection, create-never-register and register-never-setup behavior, parent-plus-id lookup, invalid-id-before-join, shell inertness, and POSIX/Windows path cases built with Node path helpers.
- [x] 4.4 Update the Spaces dialog with explicit Project, Create new Store, and Register existing Store modes, correct parent/root labels and button text, required new-Store id, derived-root intent, shared path resolution on submit, and unchanged verbatim CLI errors.
- [x] 4.5 Extend Spaces UI tests for each request discriminant, parent-plus-id behavior, typed-path primary submission, chooser fallback, registration refusal, successful navigation, and Windows path presentation.

## 5. Immediate shared space consistency

- [x] 5.1 Add a shared UI space-catalog provider/store with loading/error state, refresh, type-plus-root upsert, mutation epochs/request generations, and preservation of same-selector worktree rows.
- [x] 5.2 Migrate `SpaceSwitcher` and `SpacesPage` to the shared catalog without changing pinning, recency, cap, active-space inclusion, search, manual refresh, or selector navigation behavior.
- [x] 5.3 Publish the successful `POST /spaces` response before routing, start an authoritative background refresh, suppress older in-flight results, and retain the published entry when revalidation fails.
- [x] 5.4 Add catalog/integration tests proving immediate switcher and All Spaces visibility, new-entry selection after navigation, stale-fetch suppression, refresh-failure retention, authoritative reconciliation, and distinct same-selector worktree rows.

## 6. Cross-platform verification

- [x] 6.1 Run the targeted management API tests for local paths, chooser routing/adapters, space creation, and router security, then run the root type/build checks and full affected root test suite.
- [x] 6.2 Run the targeted UI component tests for LocalPathPicker, SpacesPage, SpaceSwitcher, WorkflowsPage, and PipelinesPage, followed by `pnpm --dir packages/ui typecheck`, test, and build.
- [x] 6.3 Exercise the path resolver, explicit Store join tests, and focused UI path tests in the existing `windows-latest` CI path (adding a focused Windows UI step if the current matrix does not run the UI package) so drive-letter, separator, and child-root expectations are verified on Windows.
- [x] 6.4 Run lint and `rasen validate improve-path-picker-store-creation`, confirm all artifacts and requirements pass, and verify that neither root nor UI package versions changed.
