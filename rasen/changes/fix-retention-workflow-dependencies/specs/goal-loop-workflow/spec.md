## MODIFIED Requirements

### Requirement: Three Backend Goal-Loop Pipelines Are Registered

The package SHALL ship three goal-loop pipelines, each homogeneous (one gate kind, one iterate-skill flavor, one tail), auto-discovered from `pipelines/<name>/pipeline.yaml`: `goal-loop-measure` (measure gate, code-edit iterate, ship → retain → archive tail), `goal-loop-evaluate` (evaluate gate, code-edit iterate, ship → retain → archive tail), and `goal-loop-research` (evaluate gate, prose/research iterate, a `report` tail instead of ship/retain/archive, with a lower implementer handoff threshold for earlier relay).

#### Scenario: Goal-loop pipelines are listed and valid

- **WHEN** `rasen pipeline list --json` runs
- **THEN** it SHALL include `goal-loop-measure`, `goal-loop-evaluate`, and `goal-loop-research`
- **AND** each SHALL parse and pass all pipeline validators with a valid DAG

#### Scenario: Measure and evaluate pipelines share the retained ship tail

- **WHEN** `goal-loop-measure` and `goal-loop-evaluate` are loaded
- **THEN** their final stages SHALL be ship → retain → archive, reusing the existing ship, retention, and archive skills
- **AND** the retain stage SHALL require ship while archive SHALL require retain

#### Scenario: Goal retention freezes one mode for resume

- **WHEN** a code-producing goal run first enters its retain stage
- **THEN** the LEAD SHALL record exactly one effective `off`, `report`, or `codify` mode in run-state before dispatch
- **AND** a resumed run SHALL use that recorded mode even if the active profile changes later

#### Scenario: Legacy goal run awaiting archive adopts the retain frontier

- **WHEN** a pre-upgrade measure or evaluate run records ship complete and archive incomplete without a retain stage record
- **THEN** resume SHALL present retain as the next required stage before archive

#### Scenario: Legacy completed goal run remains complete

- **WHEN** a pre-upgrade measure or evaluate run already records archive complete without a retain stage record
- **THEN** migration SHALL preserve the completed run and record the newly introduced retain stage as skipped for the legacy-completed tail
- **AND** it SHALL NOT run retention after archive

#### Scenario: Research pipeline uses a report tail

- **WHEN** `goal-loop-research` is loaded
- **THEN** its final stage SHALL be a `report` stage invoking the goal-report skill, not ship, retain, or archive
- **AND** it SHALL set a lower implementer handoff threshold so relay happens earlier under context pressure
