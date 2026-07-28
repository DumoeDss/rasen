## MODIFIED Requirements

### Requirement: The library is managed from the page through the CLI-backed endpoints

The page SHALL offer the library's management actions, each performed through the workflow endpoints and never by the browser touching the filesystem: **init** shall scaffold a new draft by entering an id and selecting an output directory through the shared server-local chooser/fallback control, with the created draft's path shown on success; **validate** shall validate an installed workflow id or a draft directory/package selected by path and render the diagnostics; **import** shall select a workflow directory or `.rasenpkg` file through that shared control and install it, reporting imported and reused ids; **export** shall select a destination directory through that shared control plus a filename, and when the destination already exists, surface the refusal and offer an explicit overwrite retry; **delete** shall remain for user workflows only, behind a confirmation dialog, with a referrer-guard refusal showing the CLI's message and a separately confirmed force option.

For path actions, the visible selection SHALL be the submitted selection. The current fallback-browser directory SHALL be immediately usable as a workflow directory without a separate Use-this-folder action, native chooser unavailability or cancellation SHALL preserve the fallback, and a dirty typed path SHALL resolve or fail inline before the action runs. Every failure SHALL show the CLI's own error message verbatim. While a mutation is in flight the page SHALL prevent submitting another.

#### Scenario: Import from a picked package

- **WHEN** the user picks a `.rasenpkg` file through native choice or the fallback browser and confirms the import
- **THEN** that visible package path is submitted, the workflow is installed, and the page reflects it without a reload while naming the imported ids

#### Scenario: Import the current draft directory directly

- **WHEN** the user browses to a workflow draft directory and activates Import
- **THEN** that current directory is submitted without requiring a separate Use-this-folder action

#### Scenario: Typed import path cannot diverge

- **WHEN** the user browses one source, types a different absolute workflow path, and immediately activates Import
- **THEN** only the typed path is resolved and submitted, or its inline error stops the import

#### Scenario: Export refusal offers overwrite

- **WHEN** the user selects a destination directory, supplies a filename, and export finds that destination already exists
- **THEN** the CLI's refusal is shown and the user can explicitly retry with overwrite, which succeeds

#### Scenario: Windows export uses the selected native directory

- **WHEN** a Windows user selects a destination directory on a drive and supplies a package filename
- **THEN** the displayed and submitted export destination uses the selected Windows path semantics without a hardcoded forward-slash join

#### Scenario: Native choice falls back without blocking the action

- **WHEN** a Workflow path chooser is unavailable or cancelled
- **THEN** the current selection is preserved and the typed-path/server-browser control remains usable for the same action

#### Scenario: Guarded delete surfaces referrers then allows force

- **WHEN** the user confirms deletion of a workflow that is still referenced
- **THEN** the refusal names the referrers, and only a second explicit force confirmation deletes it, showing the dangling referrers reported

#### Scenario: Draft scaffold guides the next step

- **WHEN** the user scaffolds a new draft via init
- **THEN** the created draft path is shown with guidance to edit, validate, and import it
