## MODIFIED Requirements

### Requirement: Report output location
By default, the command SHALL write its report into the user's Rasen machine-data directory under an `analytics` subdirectory — a location the user owns, that survives no update, and that can be deleted at any time without affecting the tool. The default filename SHALL be derived deterministically from the report's canonical runtime and complete session id so that distinct canonical session identities receive distinct paths while repeated audits of the same identity reuse its path. For the ordinary portable identifier shape emitted by supported runtimes, the filename SHALL include the runtime and complete human-readable session id. An unusual or overlong identifier SHALL use a deterministic, bounded, filesystem-safe representation that preserves practical collision resistance across the complete canonical identity. A `--out <path>` flag SHALL override the destination with an explicit file path.

#### Scenario: Default output location
- **WHEN** a user runs `rasen agent audit <session>` without `--out`
- **THEN** the report SHALL be written under the user's Rasen machine-data directory's `analytics` subdirectory, using a filename that identifies the canonical runtime and complete session
- **AND** the resolved path SHALL be printed so the user knows where to find it

#### Scenario: Sessions with a shared id prefix remain separate
- **WHEN** two supported-runtime sessions have different canonical ids that share the same initial characters
- **THEN** auditing both sessions with their default destinations SHALL write two different report files
- **AND** neither session's report SHALL overwrite the other's report

#### Scenario: The same session has a stable default path
- **WHEN** the same canonical runtime and session id are audited more than once without `--out`
- **THEN** every run SHALL resolve the same default report path

#### Scenario: Runtime is part of report identity
- **WHEN** two audit reports have the same session id but different canonical runtimes
- **THEN** their default report paths SHALL be different

#### Scenario: Unusual or overlong session id
- **WHEN** a canonical session id contains characters unsafe in a filename on a supported platform or would make the generated filename component too long
- **THEN** the command SHALL use a deterministic, bounded filename that represents the complete canonical runtime and session identity without emitting unsafe path characters

#### Scenario: Explicit output path
- **WHEN** a user runs `rasen agent audit <session> --out <path>`
- **THEN** the report SHALL be written to `<path>` instead of the default location

#### Scenario: Output location resolution is cross-platform
- **WHEN** the command resolves its default output directory on Windows, macOS, or Linux
- **THEN** the resolved path SHALL use the platform's native path separators and SHALL honor the same machine-home override the rest of the CLI's machine data respects
- **AND** the generated filename component SHALL be valid and bounded for all supported platforms
