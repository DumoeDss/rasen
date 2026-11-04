# executable-goal-loop Specification Delta

## MODIFIED Requirements

### Requirement: Three goal-loop built-ins migrate to reconciler Runs

The three goal-loop built-in pipelines (`goal-loop-measure`, `goal-loop-evaluate`, `goal-loop-research`) SHALL be authored as native Definition v2 BoundedLoop plus typed goal-cycle body definitions. Each SHALL declare its variant, a write-capable `rasen-goal-iterate` work phase, a read-only `rasen-goal-judge` judge phase, complete shared lifecycle policy, exact strategy capability binding, and typed downstream tail. The judge SHALL be the sole authoritative emitter of the variant-specific judge result and SHALL use an actor distinct from the work Action author. The reconciler SHALL execute these as real Runs with hierarchical identity, typed results, and deterministic recovery; v1 GoalLoop definitions SHALL remain supported compatibility inputs but SHALL no longer be the package built-in source.

#### Scenario: goal-loop-measure authors a typed goal-cycle bounded loop

- **WHEN** `goal-loop-measure` is prepared for a reconciler-engine Run
- **THEN** its authored v2 definition contains a BoundedLoop with variant `measure` and a work-to-judge body
- **AND** the plan lowers to a bounded-loop RuntimePlan node with explicit limits, lifecycle, strategy, and ship/retain/archive tail
- **AND** no v1 normalization warning is emitted

#### Scenario: goal-loop-evaluate preserves rubric evaluation semantics

- **WHEN** `goal-loop-evaluate` is prepared
- **THEN** its authored v2 definition declares variant `evaluate`, separated work/judge roles, and the established downstream tail
- **AND** capability and execution views agree with the frozen plan

#### Scenario: goal-loop-research uses truthful report-only tail

- **WHEN** `goal-loop-research` is prepared for a reconciler-engine Run
- **THEN** its authored v2 definition declares variant `research` and a downstream report stage instead of ship/archive
- **AND** domain satisfaction enters the report tail as satisfied
- **AND** a declared non-success iteration-limit exit enters the report tail with `max-rounds-exhausted` while goal and lifecycle projections remain unsatisfied/non-success

#### Scenario: Goal strategy uses one exact capability contract

- **WHEN** a measure, evaluate, or research stall policy selects strategy
- **THEN** the frozen Goal strategy capability consumes the versioned strategy invocation and returns `bounded-loop/strategy-result/1`
- **AND** failed or blocked attempts, exact WaitId resume, recovery materiality, and exhaustion are accounted by the shared lifecycle rather than GoalLoop-local state

#### Scenario: Goal judgment is read-only and actor-separated

- **WHEN** any measure, evaluate, or research goal-cycle body is prepared and executed
- **THEN** its judge phase pins `rasen-goal-judge`, advertises the matching judge-result contract, and has reviewer/read execution policy
- **AND** the judge actor differs from the work Action author before its result can be authoritative

## ADDED Requirements

### Requirement: Goal built-in authoring and execution views are equivalent

The registry, CLI, and API execution view for every native v2 goal built-in SHALL expose variant, logical order, roles, gates, capability paths, loop limits/lifecycle, exact strategy binding, tail, and reconciler support from the same prepared definition used at launch.

#### Scenario: Three-goal matrix has no legacy inference

- **WHEN** the native package definitions and their immutable plans are audited
- **THEN** measure/evaluate/research variants and tails are derived from typed authored fields
- **AND** pipeline-name checks, `legacy.loop`, `goal-run.json`, and prompt-owned counters are not needed to recover execution meaning
