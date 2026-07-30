# ecp-change-run-runtime Specification

## Purpose
Own how a Change Run selects and keeps an execution engine: explicit, defaulted and
reversible engine selection (`runs.engine` with flag > project > store > global
precedence); run-state that declares its own engine so ownership conflicts are refused
from disk rather than discovered mid-Run; and the rule that exactly one engine owner and
one canonical state exist per Run.

It also holds the honest boundary that recorded session guidance
(`handoffTokenLimit`, `reuseRoundLimit`, `sessionReuse`) is a PLACEHOLDER until a
dedicated slice defines its authoritative source — the values are stamped with
`'default'` provenance and no behavior may treat them as designed.

## Requirements
### Requirement: Engine selection is explicit, defaulted, and reversible

Rasen SHALL resolve which engine owns a NEW Run from an explicit policy — the `--engine` flag on `rasen pipeline start`, then the `runs.engine` configuration key (project, then store, then global), then the built-in default `auto` — and SHALL display the effective engine and its deciding source wherever a Run is launched. Under `auto`, the reconciler engine SHALL be selected exactly when the pipeline's capability discovery reports it supported, and the legacy path SHALL be used otherwise with the support reason shown. An explicit `reconciler` selection for an unsupported pipeline SHALL fail with the support reason rather than silently falling back. An explicit `legacy` configuration SHALL make `rasen pipeline start` refuse to create a canonical Run with a typed `engine_disabled_by_config` error naming the deciding configuration layer, so the reconciler engine can be turned off without editing any pipeline. Engine selection SHALL apply only at launch: it SHALL never re-home an existing Run, and legacy Runs SHALL continue to recover exactly as before regardless of the policy in effect.

#### Scenario: Default auto selects the reconciler where supported

- **WHEN** `rasen pipeline start` launches a Run for a pipeline whose capability discovery reports the reconciler supported, with no `--engine` flag and no `runs.engine` configuration
- **THEN** the Run SHALL be created with the reconciler engine owner
- **AND** the launch output SHALL show the effective engine and source (e.g. `engine: reconciler (auto)`)

#### Scenario: Explicit legacy disables canonical Run creation

- **WHEN** `runs.engine: legacy` is configured and `rasen pipeline start` is invoked
- **THEN** the command SHALL refuse with an `engine_disabled_by_config` error that names the deciding configuration layer
- **AND** no canonical Run Record SHALL be created

#### Scenario: Forced reconciler on an unsupported pipeline fails closed

- **WHEN** `--engine reconciler` is passed for a pipeline whose capability discovery reports the reconciler unsupported
- **THEN** the launch SHALL fail with that support reason
- **AND** SHALL NOT create a Run under either engine

#### Scenario: Flag overrides configuration

- **WHEN** `runs.engine: legacy` is configured and `rasen pipeline start --engine reconciler` is invoked for a supported pipeline
- **THEN** the Run SHALL be created with the reconciler engine owner and the output SHALL attribute the choice to the flag

#### Scenario: Legacy recovery is untouched by policy

- **WHEN** a change has only legacy run-state and any `runs.engine` value is configured
- **THEN** resuming that change SHALL follow the legacy recovery path unchanged
- **AND** the policy SHALL NOT migrate, adopt, or block that legacy Run

### Requirement: Run-state declares its engine and ownership conflicts are refused from disk

Run-state written for a reconciler-engine run SHALL declare `engine: reconciler` at run start, marking the artifact as operational bookkeeping beside the canonical Run rather than a competing progression record. Rasen SHALL determine a change's engine owner from what is actually on disk, bound to the change instance (never to a name or alias): a canonical Run Record, and the change's run-state artifact — where run-state without a reconciler declaration (including all run-state written before this capability existed, and any run-state that cannot be read) SHALL count as legacy-owner state, and derived projections (`goal-run.json`, generated reports) SHALL never count as an ownership signal. When legacy-owner state exists, launching a new canonical Run SHALL be refused — including when no canonical Run exists yet, because allowing that launch would create a Run born unable to advance — and when legacy-owner state and a canonical Run coexist, every canonical mutation except cancellation SHALL be refused, in each case with an actionable `engine_owner_conflict` error that names the artifacts and the operator's resolution options. Cancelling the canonical Run SHALL remain available so the refusal's own documented resolution is always reachable, and read-only status SHALL remain unguarded. Rasen SHALL NOT auto-adopt, rewrite, or delete either side to resolve the conflict.

#### Scenario: Declared bookkeeping beside the canonical Run is not a conflict

- **WHEN** a reconciler-engine run's run-state declares `engine: reconciler` and its canonical Run Record exists
- **THEN** canonical mutations SHALL proceed normally
- **AND** the run-state SHALL be read only as bookkeeping and labeled projection, never as a progression record

#### Scenario: Pre-existing run-state beside a canonical Run blocks mutation

- **WHEN** a change has run-state with no engine declaration (written before this capability) and a canonical Run Record
- **THEN** `rasen pipeline start` and every canonical mutation except cancellation SHALL refuse with `engine_owner_conflict`, naming the run-state artifact and the Run
- **AND** neither artifact SHALL be modified, adopted, or deleted by the refusal

#### Scenario: Launching on a legacy-only change refuses rather than creating a stuck Run

- **WHEN** a change has legacy-owner run-state (no engine declaration, or `engine: legacy`) and no canonical Run Record
- **THEN** `rasen pipeline start` SHALL refuse with `engine_owner_conflict`, naming the legacy artifact and the resolution options
- **AND** the run-state SHALL NOT be modified
- **AND** legacy resume for that change SHALL remain available unchanged

#### Scenario: Cancellation stays available as the escape hatch

- **WHEN** a change is in the dual-owner conflict state (legacy-owner run-state beside a canonical Run)
- **THEN** cancelling the canonical Run SHALL proceed despite the conflict
- **AND** the refusal error for other mutations SHALL name cancellation as a resolution option

#### Scenario: Projections never create a conflict

- **WHEN** a reconciler-engine goal run has a derived `goal-run.json` beside its canonical Run Record
- **THEN** no ownership conflict SHALL be reported

#### Scenario: Unreadable run-state fails closed

- **WHEN** a change's run-state artifact exists but cannot be parsed and a canonical Run Record exists
- **THEN** the run-state SHALL be treated as legacy-owner state and canonical mutations SHALL refuse with `engine_owner_conflict`

#### Scenario: Ownership is bound to the change instance

- **WHEN** a change is archived and a new change with the same name is created and run
- **THEN** the archived instance's artifacts SHALL NOT create an ownership conflict for the new instance's Run

### Requirement: Recorded session guidance is placeholder until a slice defines its authoritative source

Committed agent actions carry a session block (`reuse`, `handoffTokenLimit`, `reuseRoundLimit`) whose values are recorded for forward compatibility, not enforced by 0.1.6. Because 0.1.6 provides no configuration or authoring surface for `handoffTokenLimit` or `reuseRoundLimit`, every value recorded for those two fields under the 0.1.6 contract is a placeholder: a future reader SHALL NOT treat them as an operator's or author's choice, SHALL NOT enforce them against a session (in particular, enforcing the recorded `reuseRoundLimit: 1` would forbid reviewer reuse across review rounds — the primary reuse pattern), and SHALL derive real limits from its own slice's authoritative source when one exists. A synthesized stage's `sessionReuse` follows its provenance: a value implied by the node's nature (a one-shot evaluator cannot reuse a session) SHALL carry `definition` provenance and is authoritative; a value nobody chose SHALL carry `default` provenance and is a placeholder. Authored session-reuse intent SHALL be preserved with full fidelity: when a pipeline authors a reuse scope (`none`, `stage`, `run-planner`, `review-thread`), the recorded session block SHALL carry the authored scope verbatim in an additive `sessionReuseAuthored` field beside the two-value `reuse` contract, and resolution SHALL NOT erase the distinction between authored scopes; the field is absent when nothing was authored.

#### Scenario: Recorded limits are not enforced as chosen values

- **WHEN** a future reader consumes a 0.1.6-era Record whose agent actions carry `handoffTokenLimit` or `reuseRoundLimit`
- **THEN** it SHALL treat those values as placeholders, not as configured or authored constraints
- **AND** SHALL obtain real limits from the slice that first defines their authoritative source

#### Scenario: Authored reuse scope survives resolution verbatim

- **WHEN** a pipeline stage authors `sessionReuse: review-thread`
- **THEN** the effective stage and the committed action's session block SHALL carry `sessionReuseAuthored: review-thread` alongside the flattened `reuse` value
- **AND** authored `stage`, `run-planner`, and `review-thread` SHALL remain distinguishable in the Record

#### Scenario: Unauthored reuse records no fabricated intent

- **WHEN** a stage authors no `sessionReuse` (or the stage is synthesized)
- **THEN** the session block SHALL omit `sessionReuseAuthored`
- **AND** existing Records and digests SHALL be unaffected by the field's introduction

#### Scenario: One-shot evaluator non-reuse is definitional, not defaulted

- **WHEN** a synthetic orchestration evaluator stage (parallel dispatch or choice select) is synthesized
- **THEN** its `sessionReuse: never` SHALL carry `definition` provenance
- **AND** a reader MAY rely on it as an intentional contract value

