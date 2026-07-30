## ADDED Requirements

### Requirement: Retired boundary generations are cleaned by frozen identity

`rasen init` and `rasen update` SHALL retain exact cleanup support for the
earlier `freeze`, `guard`, and `unfreeze` expert ids, installed directories,
and `freeze-dir.txt` state, and SHALL additionally clean recognized
runtime-edit-boundary hooks and version-1 state from installations of either
released 0.1.6 or 0.2.0 line. The two cleanup sets describe additive artifact
generations, not a release-exclusive split. Cleanup SHALL run before lifecycle
up-to-date short circuits and SHALL be idempotent.

#### Scenario: Earlier expert generation remains upgradeable

- **WHEN** an installation contains an exact retired boundary expert directory,
  saved selection id, or recognized `freeze-dir.txt`
- **THEN** init/update SHALL apply the existing exact cleanup or normalization
- **AND** similarly named skills, ids, files, and sibling state SHALL remain
  unchanged

#### Scenario: Runtime generation heals on one update

- **WHEN** an installation contains an exact Rasen-generated Claude or Codex
  runtime edit-boundary hook and a recognized version-1 state record
- **THEN** one update SHALL remove those retired artifacts
- **AND** a second update SHALL make no further change

### Requirement: Retired hook cleanup preserves user configuration

Hook cleanup SHALL remove only a handler whose complete object matches a frozen
Rasen-generated Claude or Codex edit-boundary handler shape. It SHALL preserve
unrelated root keys, hook phases, groups, matchers, metadata, and sibling
handlers. A valid but unrecognized or user-modified handler SHALL remain
unchanged, and invalid JSON or an invalid nested hook structure SHALL be left
byte-for-byte unchanged with an actionable warning.

#### Scenario: Owned handler is removed from a mixed group

- **WHEN** a hook group contains one complete frozen Rasen edit-boundary
  handler and one unrelated user handler
- **THEN** cleanup SHALL remove only the frozen handler
- **AND** SHALL preserve the user handler and the group's unrelated metadata
  and order

#### Scenario: Partial identity match is preserved

- **WHEN** a user-authored handler shares only a command, status message,
  matcher, or other subset of fields with a retired Rasen handler
- **THEN** cleanup SHALL preserve that handler
- **AND** SHALL NOT classify it as owned through a prefix, glob, regular
  expression, or single-field match

#### Scenario: Invalid hook configuration is not rewritten

- **WHEN** a Claude settings file or Codex hooks file is invalid JSON or has an
  unexpected nested hook shape
- **THEN** cleanup SHALL leave the file byte-for-byte unchanged
- **AND** SHALL report the exact path requiring manual review

### Requirement: Runtime state cleanup removes only recognized version-1 records

Runtime state cleanup SHALL inspect only direct children of the
platform-resolved Rasen machine-data `runtime/edit-boundaries` directory. It
SHALL remove a state file only when its filename and complete version-1 record
match the frozen checkout-digest contract, and SHALL remove a stale temporary
file only when its complete filename matches the frozen atomic-write shape.
Unknown names, malformed or unreadable records, future versions, nested
directories, and sibling files SHALL be preserved.

#### Scenario: Windows and POSIX state identities are recognized

- **WHEN** cleanup runs against valid version-1 records generated from
  Windows drive/case rules or from macOS/Linux path rules
- **THEN** it SHALL reproduce the platform-specific checkout digest and remove
  the recognized record
- **AND** expected paths in tests SHALL be constructed with the platform path
  API rather than hardcoded separators

#### Scenario: Unknown state survives compatibility cleanup

- **WHEN** the retired state directory contains a future-version record,
  malformed JSON, an unexpected filename, or a nested directory
- **THEN** cleanup SHALL preserve the unknown entry
- **AND** SHALL NOT recursively remove the state directory or its parent

#### Scenario: Empty feature directory is removed non-recursively

- **WHEN** all direct children of the exact retired state directory were
  recognized and removed
- **THEN** cleanup MAY remove that now-empty directory with a non-recursive
  operation
- **AND** SHALL leave the containing `runtime` and machine-data directories
  intact
