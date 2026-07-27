## MODIFIED Requirements

### Requirement: The pipeline library is managed from the page

The page SHALL offer pipeline library actions through the pipelines API's CLI-backed bridge, never by the browser touching the filesystem, and SHALL offer each action only where the CLI supports it: **import** (a `.rasenpkg` selected through the shared server-local chooser/fallback control, with an explicit overwrite retry when a same-name pipeline is already installed), **export** (user pipelines only; a destination directory selected through the same control plus a filename, with an explicit overwrite retry on an existing destination), and **delete** (user pipelines only, behind confirmation; a referrer-guard refusal shows the CLI's message naming the referrers with a separately confirmed force option).

For import and export, the visible path SHALL be the submitted selection: a typed dirty value SHALL resolve or fail inline before mutation, and unavailable or cancelled native choice SHALL leave the typed-path/server-browser fallback usable. Cross-platform destination construction SHALL retain the server-selected directory's native path semantics.

Creating a new pipeline SHALL be a single entry on the page: the name-first canvas assembly flow. The page SHALL NOT offer a second, scaffold-to-disk creation dialog; scaffolding a draft directory remains a CLI capability (`rasen pipeline init`). A pipeline the CLI will not export or delete, including a built-in package pipeline or a project-layer pipeline, SHALL present neither action and SHALL be visibly locked. The bridge's **save** operation SHALL be exercised only by the canvas editor's save flow, and draft validation's only UI surface SHALL likewise be the canvas editor. Every failure SHALL surface the CLI's own error message verbatim, and the page SHALL prevent submitting a second mutation while one is in flight.

#### Scenario: One creation entry leads to the canvas

- **WHEN** the user looks for a way to create a pipeline on the Pipelines page
- **THEN** exactly one creation entry is offered besides Import, and choosing it starts the name-first canvas assembly flow

#### Scenario: Non-user-library pipelines are locked

- **WHEN** the user views a pipeline that is not resolved from the user library, whether a built-in package pipeline or a project-layer pipeline
- **THEN** neither a delete nor an export control is offered and the entry is visibly locked, matching what the CLI will accept

#### Scenario: Import uses the shared package chooser

- **WHEN** the user selects a pipeline `.rasenpkg` through native choice or the fallback browser and activates Import
- **THEN** that visible absolute package path is submitted through the pipeline bridge instead of requiring manual copy/paste

#### Scenario: Dirty import path cannot submit an older value

- **WHEN** the user selects one package, types a different absolute package path, and immediately activates Import
- **THEN** only the typed visible path is resolved and submitted, or its inline error stops the import

#### Scenario: Import conflict offers overwrite

- **WHEN** the user imports a package whose pipeline name is already installed
- **THEN** the CLI's refusal is shown and an explicit overwrite retry succeeds

#### Scenario: Export uses a chosen destination directory

- **WHEN** the user selects an export directory through native choice or the fallback browser and enters a filename
- **THEN** the UI displays and submits the resulting absolute destination using the selected directory's native path semantics

#### Scenario: Windows export does not hardcode POSIX separators

- **WHEN** the selected Pipeline export directory is a Windows drive path
- **THEN** the destination preview and submitted path preserve Windows separator and drive behavior

#### Scenario: Native choice falls back safely

- **WHEN** native file or directory choice is unavailable or cancelled
- **THEN** the current selection remains unchanged and the typed-path/server-browser fallback remains usable

#### Scenario: Guarded delete surfaces referrers

- **WHEN** the user confirms deleting a still-referenced user pipeline
- **THEN** the refusal names the referrers, and only a separate force confirmation deletes it
