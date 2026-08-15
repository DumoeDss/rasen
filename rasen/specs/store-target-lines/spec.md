# store-target-lines Specification

## Purpose
Treat target lines as explicit authored Store content with a stable identity and mutable locators: add, set-ref, list, show, and resolve resolve a line's Store ref and per-project code refs to concrete refs and commit identities at use time, and no command ever infers a target line from a branch name.
## Requirements
### Requirement: Target lines are authored explicitly and never inferred

A target line SHALL exist only because someone authored it, with its stable id and its Store locator
stated at authoring time. Rasen SHALL NOT create, rename, or discover a target line from a Git branch
name, a checked-out ref, the current working directory, or the presence of a directory. Authoring
SHALL refuse to overwrite an existing line rather than silently replace its locators.

#### Scenario: A new line is authored with its Store locator

- **WHEN** an operator adds target line `line-0.2` with its Store ref
- **THEN** the line exists with that stable id and that locator
- **AND** it is addressable for catalog and Archive purposes immediately

#### Scenario: Authoring refuses to overwrite an existing line

- **WHEN** an operator adds a target line whose id already exists
- **THEN** the request is refused, naming the existing line
- **AND** the existing locators are unchanged

#### Scenario: A branch name is never a target line

- **WHEN** a Store checkout sits on a branch whose name matches no authored target line
- **THEN** no target line is created or resolved from that branch name
- **AND** an operation that needs a target line reports that none is selected

### Requirement: Target-line identity is stable while its locators move

A target line's id SHALL be its identity, and its Store ref and per-project code refs SHALL be
mutable locators. Repointing a locator SHALL leave the id, and everything derived from it, unchanged.
Removing a locator that a live Change depends on SHALL be refused rather than silently orphan that
Change.

#### Scenario: Moving a line from a branch to a tag keeps its identity

- **WHEN** a target line's Store locator is changed from a branch ref to a tag ref
- **THEN** the target-line id is unchanged
- **AND** every identity derived from that line is unchanged

#### Scenario: Removing a locator a live Change depends on is refused

- **WHEN** an operator removes the code locator a Change's live workspace depends on
- **THEN** the removal is refused, naming the Change that depends on it
- **AND** the locator remains in place

### Requirement: Target-line locators resolve to concrete refs and commit identities

Resolving a target line SHALL produce the concrete Store ref and commit identity, and the concrete
code ref and commit identity for the selected project, at the moment of use. A locator that cannot be
resolved SHALL fail closed, naming which side could not resolve, rather than resolve to a default, a
current checkout, or an empty value.

#### Scenario: Both sides resolve to commits

- **WHEN** a target line with a Store locator and a code locator for the selected project is resolved
- **THEN** both refs and both commit identities are reported

#### Scenario: A missing locator fails closed

- **WHEN** a target line's Store ref does not exist in the Store repository
- **THEN** resolution fails naming that ref
- **AND** no substitute ref or commit is used

#### Scenario: A line with no locator for the selected project is reported as such

- **WHEN** a target line carries no code locator for the selected project
- **THEN** resolution reports the absence explicitly
- **AND** does not fall back to the project's default branch

### Requirement: A Change cannot be re-pointed at another target line

Once a Change carries a target line, an operation naming a different target line SHALL be refused.
The current checkout, the current branch, and the current working directory SHALL NOT re-point a
Change at another line.

#### Scenario: An explicit selector disagreeing with the Change is refused

- **WHEN** an operation on a Change explicitly names a target line other than the Change's own
- **THEN** the operation is refused, naming both lines
- **AND** the Change's target line is unchanged

#### Scenario: The current checkout does not re-point a Change

- **WHEN** an operation runs from a checkout sitting on a ref belonging to another target line
- **THEN** the Change's own target line is used
- **AND** no line is inferred from the checkout
