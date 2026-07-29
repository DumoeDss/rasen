## ADDED Requirements

### Requirement: v1 parallel-only pipelines get truthful engine support and lower consistently

A v1 pipeline whose only v2 construct is `parallelGroup` (no ReviewCycle loop) SHALL be treated by capability binding resolution, policy resolution, and engine-support analysis under the same v2-migration rule that routes its lowering, so that the three layers never disagree about the definition's execution shape. When all FanOut/Join/Choice bindings resolve, such a pipeline SHALL report `supported_v2_parallel` and SHALL lower to a runnable FanOut/Join plan; when bindings are incomplete, the pipeline SHALL report unsupported before any Run is created — it SHALL never report supported and then fail admission mid-Run for a missing binding.

#### Scenario: v1 parallel-only pipeline reports supported

- **WHEN** a v1 pipeline with a `parallelGroup` and no review-loop stage resolves all of its member and evaluator capability bindings
- **THEN** `rasen pipeline show` SHALL report `availableEngines` including `reconciler` with reason `supported_v2_parallel`

#### Scenario: v1 parallel-only pipeline lowers and reconciles

- **WHEN** a Run is started for that pipeline targeting the reconciler engine
- **THEN** the lowered plan SHALL contain the FanOut, member, and Join nodes of the normalized definition
- **AND** the first reconcile pass SHALL admit the FanOut condition evaluation rather than failing on a missing binding

#### Scenario: Incomplete bindings fail before launch

- **WHEN** the same pipeline is missing any member or evaluator binding
- **THEN** engine support SHALL report the pipeline unsupported for the reconciler
- **AND** no Run SHALL be created that could later fail admission on the missing binding
