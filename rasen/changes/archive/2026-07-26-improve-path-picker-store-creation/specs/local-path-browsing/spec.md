## ADDED Requirements

### Requirement: Server-local paths can be acquired through a native chooser with browser fallback

The management server SHALL offer an authenticated chooser request for an existing directory or file on the server. A successful choice SHALL return a canonical absolute path in the server platform's native form; cancellation SHALL preserve the caller's current selection; and an unsupported platform, missing desktop utility, unavailable graphical session, WSL/headless/remote limitation, or chooser launch failure SHALL report that native choice is unavailable. The local-path browser SHALL remain usable in every cancelled or unavailable case and SHALL continue to be the sole required path-acquisition mechanism.

The chooser SHALL be read-only: it may inspect and return a path but SHALL create, modify, register, import, or export nothing. It SHALL run under the management API's loopback, bearer-token, and no-CORS posture, accept only the supported directory/file choice modes and fixed file filters, serialize concurrent chooser requests, and bound any native chooser process so it cannot remain resident indefinitely.

#### Scenario: Native directory choice fills a canonical server path

- **WHEN** a supported desktop runtime returns a directory from the chooser
- **THEN** the response identifies the choice as selected and carries that directory's canonical absolute path using the server's native separators

#### Scenario: Windows chooser returns a Windows absolute path

- **WHEN** a directory is selected on Windows using a drive-letter path
- **THEN** the returned path is canonicalized as one native Windows path and can be used without translating it to forward-slash form

#### Scenario: Headless or unsupported runtime falls back safely

- **WHEN** the server cannot start a usable native chooser because its platform, utility inventory, or graphical session is unsupported
- **THEN** the request reports native choice as unavailable, changes no selection, and the same control still offers typed-path and server-browser acquisition

#### Scenario: Cancellation preserves the current selection

- **WHEN** the user cancels a native chooser
- **THEN** the request reports cancellation, the visible selection remains unchanged, and the server-browser fallback remains available

#### Scenario: Chooser is protected and read-only

- **WHEN** an unauthenticated caller requests a chooser, or an authenticated caller completes one
- **THEN** the unauthenticated request is rejected and the completed request writes no filesystem or Rasen state

#### Scenario: Concurrent or abandoned chooser is bounded

- **WHEN** one chooser is already open or exceeds its interaction timeout
- **THEN** a concurrent request is refused as busy and an expired chooser is terminated with a structured timeout result

### Requirement: Path selection has one visible and submitted value

Every Spaces, Workflows, or Pipelines path control using the shared server-local picker SHALL treat the path shown in its input as the only candidate for submission. Editing that input SHALL invalidate any earlier resolved selection. Pressing Enter, choosing a native path, choosing an entry in the fallback browser, or activating the host dialog's primary action SHALL resolve the current visible value for the required kind (directory, file, or either), replace it with the canonical absolute result on success, or show an inline error and stop the host action on failure. No host SHALL submit a previously browsed path while displaying a different value.

The fallback browser's current directory SHALL be a valid directory selection without a second commit button, while choosing a listed file SHALL change the same selection to that file. Resolution SHALL preserve native path semantics across macOS, Linux, and Windows.

#### Scenario: Primary action resolves a dirty visible path

- **WHEN** the user browses one directory, types a different absolute directory, and immediately activates Create, Import, or Export
- **THEN** the control resolves and submits the typed directory, or reports why that typed directory is invalid; it never submits the earlier browsed directory

#### Scenario: Enter resolves the visible value

- **WHEN** the user types an absolute path and presses Enter in the path control
- **THEN** the control resolves that exact visible value and shows its canonical path, or leaves it visible with an inline resolution error

#### Scenario: Current directory imports without an extra commit

- **WHEN** an import accepts a directory and the user navigates the fallback browser to that directory
- **THEN** the directory is the active selection and the user can invoke Import without first activating a separate Use-this-folder action

#### Scenario: File choice replaces the directory selection

- **WHEN** a file-capable picker is showing a directory and the user chooses a listed package file
- **THEN** the visible and submitted selection both become that file's canonical absolute path

#### Scenario: Windows dirty input cannot submit the older listing

- **WHEN** a Windows picker lists `C:\old` and the user types `D:\new` before activating the host action
- **THEN** only `D:\new` is resolved for submission, with drive and separator semantics preserved
