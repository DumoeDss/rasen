# local-version-test-harness Specification

## Purpose
TBD - created by archiving change add-local-version-test-harness. Update Purpose after archive.
## Requirements
### Requirement: Local source and project selection
The local-version harness SHALL accept a Rasen source worktree and a target project directory, default the source to the repository containing the harness, default the project to the caller's current directory, and support target projects with or without Node package metadata.

#### Scenario: Defaults from a target project
- **WHEN** a developer invokes a repository-owned harness launcher from a non-Node target project without source or project overrides
- **THEN** the harness uses its owning Rasen worktree as the source and the current directory as the target project

#### Scenario: Explicit worktree with Windows paths
- **WHEN** a developer supplies source and project directories containing Windows separators or spaces
- **THEN** the harness resolves their canonical identities and prepares that exact source for that exact project

### Requirement: Paired release-shaped local runtime
The harness SHALL build and package the local CLI and UI as independent dependency graphs, require their declared and installed versions to match exactly, install both local packages beside each other in an isolated runtime, and verify the installed CLI version, UI assets, and the CLI's actual UI package resolution before launching a target.

#### Scenario: Successful paired preparation
- **WHEN** the selected source produces matching CLI and UI packages with a usable UI entry asset
- **THEN** the harness returns a verified runtime whose `rasen --version` matches both package manifests and whose UI resolver returns the installed UI assets

#### Scenario: Mismatched package versions
- **WHEN** the source CLI and UI manifests or installed artifacts report different versions
- **THEN** preparation fails before a Rasen command or agent starts and identifies the mismatched versions

#### Scenario: Missing UI package assets
- **WHEN** the packed or installed UI lacks its required entry asset
- **THEN** preparation fails instead of launching a CLI that serves the UI-install hint page

### Requirement: Content-addressed runtime reuse
The harness SHALL identify prepared runtimes by relevant CLI/UI package inputs and the active platform/toolchain, reuse a verified matching runtime across projects, and produce a different runtime identity when relevant source content or toolchain identity changes even if the declared version does not.

#### Scenario: Warm cache hit
- **WHEN** a previously verified source and toolchain are prepared again without relevant changes
- **THEN** the harness reuses the immutable cached runtime without rebuilding or repacking either package

#### Scenario: Dirty source invalidates the runtime
- **WHEN** a relevant tracked or untracked source file changes while the package version remains the same
- **THEN** the next preparation uses a different runtime identity and includes the changed content

#### Scenario: Concurrent preparation
- **WHEN** two callers prepare the same uncached source identity concurrently
- **THEN** they converge on one fully verified runtime and neither observes a partially installed cache entry

### Requirement: Target project and global installation isolation
Harness preparation SHALL leave the target project's existing package manifest, lockfiles, and dependency directory unchanged, execute the selected target with the isolated runtime first on `PATH`, and leave the user's global Rasen installation and parent-shell environment unchanged after success, failure, or interruption.

#### Scenario: Non-Node project remains non-Node
- **WHEN** the harness prepares and runs a local Rasen version against a target project without `package.json`
- **THEN** preparation creates no package manifest, lockfile, or `node_modules` in that project

#### Scenario: Existing Node project package state is preserved
- **WHEN** the target project already has package metadata and dependencies
- **THEN** harness preparation leaves those entries byte-identical while the invoked product command remains free to make its documented project changes

#### Scenario: Global Rasen remains the daily version
- **WHEN** a local command or agent session exits
- **THEN** a subsequent global `rasen` invocation outside the harness resolves exactly as it did before the harness started

### Requirement: Isolated machine state, daemon, and telemetry
The harness SHALL assign a stable machine home and daemon port from the canonical source, target project, and declared version identities, SHALL keep those values distinct across different identities, and SHALL disable telemetry in harness-launched child processes.

#### Scenario: Same development line retains local state
- **WHEN** the same source worktree, target project, and declared version are launched after source edits
- **THEN** the harness reuses the same isolated machine home and daemon port while selecting the newly prepared runtime

#### Scenario: Incompatible versions do not share state
- **WHEN** the same project is launched once with a 0.1.6 worktree and once with a 0.2.0 worktree
- **THEN** the two child environments receive different machine homes and daemon ports and neither uses the default global machine home

### Requirement: Rasen and agent launchers
The repository SHALL provide launchers for Rasen commands, Codex sessions, and Claude sessions that prepare the runtime automatically, run from the selected target project, preserve interactive standard I/O, pass remaining arguments and target exit codes unchanged, and make bare `rasen` commands inside agent child processes resolve to the prepared local runtime.

#### Scenario: Initialize through the local launcher
- **WHEN** a developer invokes the Rasen launcher with `init`
- **THEN** the selected local Rasen runs interactively in the target project with the isolated environment

#### Scenario: Codex uses the selected local version
- **WHEN** the Codex launcher starts a Codex command or profile function that subsequently invokes bare `rasen --version`
- **THEN** that invocation resolves to the prepared local runtime and Codex arguments are preserved

#### Scenario: Claude uses the selected local version
- **WHEN** the Claude launcher starts a Claude command or profile function that subsequently invokes bare `rasen --version`
- **THEN** that invocation resolves to the prepared local runtime and Claude arguments are preserved

#### Scenario: Target returns a failure code
- **WHEN** Rasen, Codex, or Claude exits with a non-zero target exit code after successful preparation
- **THEN** the launcher returns that same exit code without relabeling it as a harness preparation error

### Requirement: Actionable and machine-readable preparation diagnostics
Preparation SHALL emit a single machine-readable result for adapters, report progress separately, and fail closed with a stable error code, phase, source/project context, and safe command failure summary when the harness cannot create or validate a runtime.

#### Scenario: Adapter consumes successful preparation
- **WHEN** preparation succeeds in JSON mode
- **THEN** stdout contains one parseable result naming the runtime, binary directory, local version, UI assets, machine home, daemon port, fingerprint, and cache outcome

#### Scenario: Build command fails
- **WHEN** a dependency installation, build, pack, or runtime installation command fails
- **THEN** the harness reports its phase, command, working directory, and exit code, keeps environment secrets out of the diagnostic, and does not launch a global fallback
