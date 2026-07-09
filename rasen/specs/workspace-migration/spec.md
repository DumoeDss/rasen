# workspace-migration Specification

## Purpose

This spec governs how rasen detects a legacy `openspec/` workspace and offers a safe, copy-only migration path into the `rasen/` workspace, so a project can adopt rasen without disturbing an existing upstream OpenSpec installation.

## Requirements

### Requirement: Legacy workspace detection and guidance
When a command requires a workspace and no `rasen/` directory exists, but a legacy `openspec/` directory is present in the same location, the CLI SHALL guide the user to migration instead of showing a generic "not initialized" error: the message SHALL name the detected `openspec/` workspace, offer `rasen migrate` (described as copy-only, originals untouched), and offer `rasen init` for starting fresh.

#### Scenario: Legacy workspace found where rasen workspace is missing
- **WHEN** a user runs a workspace-requiring command in a project that has `openspec/` but no `rasen/`
- **THEN** the CLI reports that a legacy OpenSpec workspace was detected
- **AND** suggests `rasen migrate` (copy-only) and `rasen init` as next steps
- **AND** does not read the `openspec/` directory as its active workspace

#### Scenario: Rasen workspace present wins outright
- **WHEN** both `rasen/` and `openspec/` exist in a project
- **THEN** the CLI operates exclusively on `rasen/`
- **AND** never reads or writes `openspec/`

### Requirement: Copy-only migration of a legacy workspace
The `rasen migrate` command SHALL copy the contents of a legacy `openspec/` workspace (`specs/`, `changes/` including `changes/archive/`, and `config.yaml`) into a `rasen/` workspace. The source directory SHALL NOT be modified, moved, or deleted; files that already exist at the destination SHALL be skipped, never overwritten; individual file failures SHALL NOT abort the migration and SHALL be reported in a summary.

#### Scenario: First migration
- **WHEN** a user runs `rasen migrate` in a project with `openspec/` and no `rasen/`
- **THEN** `rasen/` is created containing copies of `specs/`, `changes/` (with `archive/`), and `config.yaml`
- **AND** the `openspec/` directory is byte-for-byte unchanged
- **AND** a summary reports the number of files copied and skipped

#### Scenario: Idempotent re-run
- **WHEN** `rasen migrate` runs again after a previous full or partial migration
- **THEN** only files missing from `rasen/` are copied
- **AND** existing files under `rasen/` are never overwritten

#### Scenario: Partial failure does not abort
- **WHEN** copying an individual file fails (e.g., a permission error)
- **THEN** the migration continues with the remaining files
- **AND** the summary lists the files that could not be copied

#### Scenario: Cross-platform paths
- **WHEN** the migration runs on Windows, macOS, or Linux
- **THEN** all source and destination paths are constructed with platform-appropriate separators
- **AND** nested change directories (e.g., `changes/archive/<date>-<name>/`) round-trip correctly on all three platforms

### Requirement: Migration offered during init
When `rasen init` runs in a project that has a legacy `openspec/` workspace and no `rasen/` workspace, it SHALL offer to migrate (interactive prompt; declined or non-interactive runs proceed with a fresh empty workspace). Accepting performs the same copy-only migration as `rasen migrate`.

#### Scenario: Init offers migration
- **WHEN** a user runs `rasen init` interactively in a project with `openspec/` and no `rasen/`
- **THEN** the CLI asks whether to migrate the existing OpenSpec workspace into `rasen/`
- **AND** accepting copies the legacy content per the copy-only migration contract

#### Scenario: Declining keeps both worlds intact
- **WHEN** the user declines the migration offer
- **THEN** init scaffolds a fresh empty `rasen/` workspace
- **AND** the `openspec/` directory is untouched and remains usable by upstream OpenSpec

#### Scenario: Non-interactive init does not migrate silently
- **WHEN** `rasen init` runs non-interactively (e.g., CI) in a project with a legacy workspace
- **THEN** no migration is performed
- **AND** the output notes that `rasen migrate` is available

### Requirement: Coexistence with upstream OpenSpec
Migration and workspace handling SHALL support running rasen and upstream OpenSpec in the same project: rasen SHALL never write to, delete from, or clean up the `openspec/` directory, upstream-namespace command files (`opsx` paths), upstream-namespace skill directories (`openspec-*`), or marker blocks in shared config files, except when the user explicitly confirms such cleanup inside the migrate flow.

#### Scenario: Both tools in one project
- **WHEN** a project contains both an `openspec/` workspace (managed by upstream OpenSpec) and a `rasen/` workspace
- **THEN** rasen commands read and write only `rasen/` and rasen-namespace artifacts
- **AND** upstream OpenSpec continues to operate on `openspec/` unaffected

#### Scenario: Legacy artifacts reported, not removed
- **WHEN** `rasen init` or `rasen update` detects `opsx` command files or `openspec-*` skill directories
- **THEN** it prints a one-time notice explaining they may belong to upstream OpenSpec or an older rasen install
- **AND** it does not delete or modify them

#### Scenario: Marker-block cleanup requires explicit consent
- **WHEN** a shared config file (e.g., root `AGENTS.md`) contains an `<!-- OPENSPEC:START -->` / `<!-- OPENSPEC:END -->` block
- **THEN** rasen removes that block only when the user explicitly confirms it inside the `rasen migrate` flow (default: keep)
- **AND** `rasen update` never removes it automatically
