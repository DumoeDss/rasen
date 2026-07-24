# windows-process-launch Delta

## ADDED Requirements

### Requirement: Background child processes never flash a console window on Windows

Every non-interactive child process the tool starts on Windows — including the per-space enablement apply's `update` subprocess, the management API's CLI bridge subprocesses, supervised agent CLI launches, daemon and browser launches, git helpers, and version probes — SHALL be started with the console window hidden, so no console window flashes or lingers on the user's desktop. The sole exception is a child process that is interactive by design (the configuration editor spawned into the user's editor), which SHALL keep its window. The codebase SHALL enforce this with an automated guard that fails when a child-process call site neither hides the window nor appears on the explicit interactive allowlist, so future spawn sites cannot silently regress.

#### Scenario: Profile switch apply is windowless

- **WHEN** a space's profile is switched through the UI on Windows and the bounded `update` subprocess runs
- **THEN** no console window appears during the apply

#### Scenario: Interactive editor keeps its window

- **WHEN** the user opens the configuration editor path that spawns their editor
- **THEN** that child process is not hidden

#### Scenario: New spawn sites are guarded

- **WHEN** the test suite runs against a source tree containing a child-process call site that neither hides the console window nor is on the interactive allowlist
- **THEN** the guard test fails naming the offending site
