## MODIFIED Requirements

### Requirement: Ephemera cleaner uses a whitelist by filename, never discretionary deletion

The ephemera cleaner SHALL delete only files whose names match a known whitelist of regenerable ephemera and whose content, when the filename denotes structured run-state, matches a schema supported by this Rasen version. It SHALL preserve every unknown, malformed, or unsupported entry byte-for-byte and report its exact path. It SHALL never recursively delete the ephemera directory or any part of the machine root.

The whitelist SHALL cover:

- **Run-state and control state**: `auto-run.json`, `portfolio-run.json`, `goal-run.json`, change-level `.signal`, `.lock`, `.heartbeat`, and `expert-selection-explicit.json`.
- **Regenerable raw material**: `*.log`, `raw-*.json`, `benchmark-*.json` at the ephemera directory's top level.

Before classifying a known structured run-state file as deletable, the cleaner SHALL parse it and validate it against that filename's supported schema and version markers. A versionless legacy shape SHALL be deletable only when the supported parser explicitly accepts that shape. Unknown fields accepted by a supported schema do not by themselves make a record a future version.

The cleaner SHALL preserve and report:

- Unknown filenames not in the whitelist.
- State files carrying an explicit version marker newer than or otherwise unsupported by this Rasen version.
- Malformed entries, including known state filenames whose JSON or schema is invalid.
- Nested directory entries and their contents.
- Symlinks and other non-regular filesystem entries.

Before any deletion, the cleaner SHALL recursively inspect the complete ephemera tree for source-code signals using the product's explicit manifest-name, source-directory, and source-extension lists. Discovery of a source manifest (`package.json`, `Cargo.toml`, `pyproject.toml`, `build.rs`, `rust-toolchain.toml`) or a source-tree structure at any depth SHALL abort cleaning for that change, preserve every entry, and report every discovered signal. A filesystem inspection error other than absence, including `EACCES`, `EPERM`, and `EIO`, SHALL produce an explicit blocked/error result and SHALL NOT be interpreted as an empty directory.

Every file deleted by the cleaner SHALL be listed in `archive.json`'s `ephemeraDiscarded` array. Every file preserved and reported SHALL appear in the archive output (human mode) or the JSON result's `ephemeraPreserved` array (JSON mode) so a human can judge it.

#### Scenario: Valid known run-state is deleted and accounted

- **WHEN** the ephemera directory contains schema-valid, supported `auto-run.json` and `portfolio-run.json` files
- **THEN** both files SHALL be deleted
- **AND** both filenames SHALL appear in `archive.json`'s `ephemeraDiscarded` array

#### Scenario: Malformed known run-state is preserved

- **WHEN** `auto-run.json`, `portfolio-run.json`, or `goal-run.json` contains invalid JSON or does not match its supported schema
- **THEN** the cleaner SHALL preserve the file byte-for-byte
- **AND** the cleaner SHALL report its exact path and validation reason

#### Scenario: Future-version known run-state is preserved

- **WHEN** a known run-state file carries an explicit version marker that this Rasen version does not support
- **THEN** the cleaner SHALL preserve the file byte-for-byte
- **AND** the cleaner SHALL report that its version is unsupported

#### Scenario: Unknown file is preserved and reported

- **WHEN** the ephemera directory contains a file named `custom-experiment.json` that is not in the whitelist
- **THEN** the file SHALL be left in place byte-for-byte
- **AND** its exact path SHALL be reported in the archive output

#### Scenario: Nested source tree aborts all cleaning

- **WHEN** the ephemera directory contains a valid deletable run-state file and a nested source-tree signal such as `research/probe/src/main.ts`
- **THEN** the cleaner SHALL recursively discover and report the source-tree signal before deletion
- **AND** no ephemera entry, including the otherwise deletable run-state file, SHALL be deleted

#### Scenario: Nested non-source directory is preserved

- **WHEN** the ephemera directory contains a subdirectory `research/data/` with no source-code signal
- **THEN** the subdirectory and all its contents SHALL be left in place
- **AND** its path SHALL be reported in the archive output

#### Scenario: Permission or I/O failure blocks cleaning

- **WHEN** any directory or candidate file needed for complete classification fails to read with `EACCES`, `EPERM`, or `EIO`
- **THEN** the cleaner SHALL report the failed path and error
- **AND** no ephemera file SHALL be deleted for that change

#### Scenario: Windows paths retain exact identity

- **WHEN** cleaning runs on Windows with nested paths containing drive letters and backslash separators
- **THEN** containment checks and on-disk access SHALL use platform-native path semantics
- **AND** reported paths SHALL identify the same entries deterministically without relying on a forward-slash filesystem path
