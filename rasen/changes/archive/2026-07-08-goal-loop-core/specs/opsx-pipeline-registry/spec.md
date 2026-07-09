## ADDED Requirements

### Requirement: Stage Loop Is a Discriminated Union

The `loop` field of a stage SHALL be a Zod discriminated union on a `kind` discriminator with two variants: `review-cycle` (the existing single-round-cap review→fix loop) and `goal` (a goal-driven iteration loop). The union SHALL parse the existing `review-cycle` shape unchanged so existing pipelines validate identically. The `goal` variant SHALL carry a required `gate` that is itself a discriminated union on `kind` with variants `measure` and `evaluate`, plus `maxRounds` (default 5) and `loopStallLimit` (default 2, gate-neutral). A `goal` loop SHALL be rejected if its `measure` gate declares neither `threshold` nor `target`.

#### Scenario: Review-cycle shape parses unchanged under the union

- **WHEN** a stage declares `loop: { kind: review-cycle }` (or with an explicit `maxRounds`)
- **THEN** the discriminated union SHALL parse it to `{ kind: 'review-cycle', maxRounds: 3 }` (default applied when omitted)
- **AND** the parsed shape SHALL equal the pre-union `{ kind: 'review-cycle', maxRounds: 3 }` value

#### Scenario: Goal loop with a measure gate parses

- **WHEN** a stage declares `loop: { kind: goal, gate: { kind: measure, threshold: 90, direction: gte } }`
- **THEN** the union SHALL accept it and expose `loop.kind === 'goal'` with the gate narrowed to the measure variant

#### Scenario: Goal loop with an evaluate gate parses

- **WHEN** a stage declares `loop: { kind: goal, gate: { kind: evaluate, goal: '<text>' } }`
- **THEN** the union SHALL accept it and expose `loop.kind === 'goal'` with the gate narrowed to the evaluate variant

#### Scenario: Measure gate missing a stop condition is rejected

- **WHEN** a goal loop declares `gate: { kind: measure }` with neither `threshold` nor `target`
- **THEN** validation SHALL fail with an error indicating the measure gate needs a threshold or target

#### Scenario: Unknown loop kind is rejected

- **WHEN** a stage declares `loop: { kind: unknown-kind }`
- **THEN** the discriminated union SHALL reject it at parse

## MODIFIED Requirements

### Requirement: Built-In Pipelines

The package SHALL ship built-in pipelines for the initial task types and the goal-loop family. Each SHALL be included in the published package files.

#### Scenario: Initial built-ins present

- **WHEN** no user or project pipelines are defined
- **THEN** `full-feature`, `small-feature`, and `bug-fix` SHALL resolve from the package
- **AND** they SHALL be included in the published package files

#### Scenario: Goal-loop built-ins present

- **WHEN** no user or project pipelines are defined
- **THEN** `goal-loop-measure`, `goal-loop-evaluate`, and `goal-loop-research` SHALL resolve from the package
- **AND** they SHALL be included in the published package files
- **AND** they SHALL be auto-discovered from `pipelines/goal-loop-*/pipeline.yaml` with no TypeScript registration
