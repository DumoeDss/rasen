## MODIFIED Requirements

### Requirement: Adopt is git-safe and previewable
Adopt SHALL never stage, commit, or otherwise write to any git index. It SHALL support `--dry-run` (print the full move plan, including any uncommitted files inside moved paths, and change nothing) and `--json`. The dry-run plan SHALL cover the archive selected by `--archive` — reporting the entries that would move, enumerated from disk rather than reported as zero — and SHALL be fully inert: it creates no machine home, mints no project identity into the tracked project config, and writes no configuration key. On completion it SHALL print suggested, pathspec-scoped commit commands for each affected repository.

#### Scenario: Dry run shows the plan including uncommitted work
- **WHEN** the user runs adopt with `--dry-run` while some change files are uncommitted
- **THEN** the output lists every path that would move, flags the uncommitted ones, and no file or config is modified

#### Scenario: Dry run previews archive moves
- **WHEN** the user runs adopt with `--archive move --dry-run` on a repo that has archived changes
- **THEN** the archive line reports the real entry count for those archived changes, no archived directory moves, and no config changes

#### Scenario: Dry run previews an external archive without creating machine state
- **WHEN** the user runs adopt with `--archive external --dry-run`
- **THEN** the archive line reports the real entry count, no machine home directory is created for a project that has none, and the project's archive destination is not written

#### Scenario: Dry run mints no project identity
- **WHEN** the user runs adopt with `--dry-run` on a project whose config carries no project id
- **THEN** the tracked project config is left byte-identical and the preview reports an unassigned project id instead of writing one

#### Scenario: Completion prints per-repo commit suggestions
- **WHEN** adopt completes successfully
- **THEN** the output includes one suggested git commit command for the source repo (removals plus pointer config) and one for the store repo (additions), and neither has been executed
