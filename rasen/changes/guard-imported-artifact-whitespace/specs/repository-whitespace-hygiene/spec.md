## ADDED Requirements

### Requirement: Staged content whitespace guard
The repository SHALL provide an installable `pre-commit` hook that rejects a commit whose staged content carries whitespace errors, and the hook SHALL determine those errors with git's own staged whitespace check rather than a separate reimplementation, so the local gate and the continuous-integration gate cannot diverge.

#### Scenario: Staged trailing whitespace is rejected
- **WHEN** a developer stages a file whose added lines carry trailing whitespace and runs `git commit`
- **THEN** the hook fails the commit, names the offending paths and lines, and no commit object is created

#### Scenario: Clean staged content commits normally
- **WHEN** a developer stages content with no whitespace errors and no lint errors
- **THEN** the hook exits successfully and the commit proceeds

#### Scenario: Staged lint errors are rejected
- **WHEN** the staged set contains a JavaScript or TypeScript file inside the lint scope that fails ESLint
- **THEN** the hook fails the commit and reports the ESLint output

#### Scenario: Type checking is not part of the commit gate
- **WHEN** the staged set contains a type error but no whitespace or lint error
- **THEN** the hook allows the commit, leaving type checking to continuous integration

### Requirement: Hook installation is safe and reversible
The repository SHALL install the hook by pointing git's hooks path at a tracked hooks directory during dependency preparation, and installation SHALL be a silent no-op — never a failure — outside a git work tree, in continuous integration, when the developer has opted out, or when a different hooks path is already configured.

#### Scenario: Normal install arms the hook
- **WHEN** a developer runs the repository's dependency install in a git work tree with no hooks path configured
- **THEN** git's hooks path points at the tracked hooks directory and the hook is executable

#### Scenario: Non-git checkout is unaffected
- **WHEN** preparation runs where there is no git work tree
- **THEN** installation is skipped and preparation still succeeds

#### Scenario: Existing hook configuration is preserved
- **WHEN** a developer has already configured a different hooks path
- **THEN** installation leaves that configuration untouched

#### Scenario: Explicit opt-out is honored
- **WHEN** the documented opt-out environment variable is set
- **THEN** installation is skipped

### Requirement: Archive whitespace preflight
`rasen archive` SHALL inspect the change's text artifacts for whitespace errors before those artifacts are staged, copied, or hashed, and SHALL block the archive with every offending `file:line` when any are found. The preflight SHALL report only; it SHALL NOT rewrite artifact content, so the archive engine's byte-preservation and recorded evidence hashes remain authoritative.

#### Scenario: Dirty evidence blocks the archive before staging
- **WHEN** a change carries an evidence document with trailing whitespace and the developer archives it
- **THEN** the archive is blocked, the message lists each offending file and line, and no staging directory, archived copy, or evidence hash is produced

#### Scenario: Every offending line is reported at once
- **WHEN** the change carries several artifacts with several offending lines each
- **THEN** the failure names all of them rather than stopping at the first

#### Scenario: Binary artifacts are not inspected
- **WHEN** the change carries a binary artifact
- **THEN** the preflight skips it and does not report it as a whitespace error

#### Scenario: Clean change archives unchanged
- **WHEN** the change's artifacts carry no whitespace errors
- **THEN** the archive proceeds exactly as before the preflight existed

#### Scenario: Explicit opt-out records itself
- **WHEN** the developer archives with the documented whitespace opt-out because trailing whitespace is the artifact's intended content
- **THEN** the archive proceeds and its recorded output states that the whitespace guard was disabled
