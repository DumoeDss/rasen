## MODIFIED Requirements

### Requirement: Three Retro Scopes

The command SHALL support 3 scopes: change-scoped, general, and global. The general and global scopes SHALL run a self-contained git-analysis contract absorbed into the `/opsx:retro` workflow template and SHALL NOT delegate to a gstack `/retro` expert skill.

#### Scenario: Change-scoped retro invocation

- **WHEN** agent executes `/opsx:retro <change-name>`
- **THEN** the retro SHALL run in change-scoped mode
- **AND** SHALL read artifacts from the specified change directory

#### Scenario: General retro invocation

- **WHEN** agent executes `/opsx:retro` without a change name
- **AND** the user selects general scope
- **THEN** the retro SHALL gather recent commit, author, and LOC data from git and compute metrics itself
- **AND** SHALL produce insights based on commit patterns, frequency, code areas touched, and a per-author breakdown
- **AND** SHALL complete without invoking any gstack `/retro` expert skill

#### Scenario: Global retro invocation

- **WHEN** agent executes `/opsx:retro global`
- **THEN** the retro SHALL run cross-project analysis using its own git-analysis contract
- **AND** SHALL produce insights spanning multiple repositories if available
- **AND** SHALL complete without invoking any gstack `/retro` expert skill
