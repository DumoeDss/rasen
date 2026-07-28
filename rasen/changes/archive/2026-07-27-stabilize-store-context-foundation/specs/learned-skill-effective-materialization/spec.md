## MODIFIED Requirements

### Requirement: Applicability is decided before precedence, in the checkout being worked on

Knowledge that does not apply to the project SHALL be filtered out before any precedence between project, Store, and machine-wide sources is considered. Applicability SHALL be evaluated against the checkout the session is actually working in, which is a different thing from where the project's knowledge is stored and from where generated files are written. Every path that decides applicability SHALL reach that checkout the same way: the checkout the session recorded, then the checkout already resolved for the work, and only when neither exists SHALL the current directory answer. No path SHALL reach for the current directory while an earlier answer is available, and the paths SHALL NOT differ from one another in what they fall back to.

#### Scenario: Inapplicable knowledge never reaches precedence

- **WHEN** knowledge does not apply to the project being worked on
- **THEN** it is removed before precedence is considered
- **AND** it cannot win at any scope

#### Scenario: Applicability uses the session's checkout

- **WHEN** a session records an execution checkout and applicability is evaluated
- **THEN** it is decided against that checkout
- **AND** not against the project's knowledge storage location

#### Scenario: Two clones evaluate independently

- **WHEN** the same project has two checkouts whose contents differ in what makes knowledge applicable
- **THEN** each session evaluates applicability against its own checkout
- **AND** both draw on the same stored project knowledge

#### Scenario: A resolved checkout is preferred over the current directory

- **WHEN** no session records a checkout, the work has already resolved a project checkout, and the current directory is a different location
- **THEN** applicability is decided against the resolved project checkout
- **AND** not against the current directory

#### Scenario: The current directory answers only when nothing else has

- **WHEN** no session records a checkout and no project checkout has been resolved for the work
- **THEN** the current directory decides applicability

#### Scenario: Every path falls back the same way

- **WHEN** applicability is decided through any of the paths that resolve it
- **THEN** each path reaches the checkout by the same stated order
- **AND** no two paths disagree about which checkout is used for the same session
