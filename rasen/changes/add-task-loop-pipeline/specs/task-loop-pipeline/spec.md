## ADDED Requirements

### Requirement: Task loop is an explicitly selected rasen-auto Pipeline

Rasen SHALL provide a built-in `task-loop` Pipeline through the existing `rasen-auto` entry. The user SHALL be able to select it with either `rasen-auto task-loop <task>` or `rasen-auto --pipeline task-loop <task>`. Rasen SHALL add no separate loop command, SHALL NOT select `task-loop` through keyword/default classification, and SHALL keep `small-feature` as the ordinary unselected default.

#### Scenario: Leading Pipeline selector starts task loop
- **WHEN** a user invokes `rasen-auto task-loop fix the focused defect`
- **THEN** Rasen strips `task-loop` from the task text and starts the registered `task-loop` Pipeline with the remaining description
- **AND** classification is not consulted

#### Scenario: Pipeline option starts task loop
- **WHEN** a user invokes `rasen-auto --pipeline task-loop fix the focused defect`
- **THEN** Rasen starts the same registered `task-loop` Pipeline and treats the selection as explicit

#### Scenario: Ordinary automatic selection never chooses task loop
- **WHEN** a user invokes `rasen-auto` without an explicit Pipeline selector under manual, classify, or compose policy
- **THEN** `task-loop` is not returned by the built-in classifier or silently substituted for its selected/default Pipeline

#### Scenario: No separate loop command is registered
- **WHEN** a user inspects the Rasen command tree and generated user-invokable skills
- **THEN** no `rasen loop` command or directly invokable `rasen-task-loop` command is present

### Requirement: Task loop freezes an inspectable task contract before work

Before admitting a builder, Rasen SHALL freeze a canonical task contract containing a non-empty goal, at least one real artifact target, applicable constraints, and a non-empty quality bar. Every bar criterion SHALL have a unique stable identifier, a directly checkable pass condition, and an evidence hint. The frozen contract SHALL participate in launch identity and SHALL remain unchanged for the Run's lifetime.

#### Scenario: Valid task contract is recorded
- **WHEN** the auto driver can express the requested result as an evidence-backed task contract
- **THEN** the canonical Run records that contract and its digest before round one
- **AND** status can display the goal, targets, bar, constraints, and effective round budget

#### Scenario: Uninspectable bar blocks admission
- **WHEN** the task has no artifact target or no criterion with a concrete evidence source
- **THEN** Rasen refuses to admit a builder with a stable task-loop input/bar error
- **AND** it does not replace the missing bar with subjective adjectives or start a spec workflow

#### Scenario: Relaunch with the same contract is idempotent
- **WHEN** the same Change, Pipeline, engine, and canonical task contract are started again
- **THEN** Rasen reuses the existing Run without changing its contract or re-admitting completed work

#### Scenario: Relaunch with a changed contract conflicts
- **WHEN** an existing task-loop Run is started with a different goal, target, constraint, bar, or Pipeline
- **THEN** Rasen returns `launch_request_conflict`
- **AND** the persisted Run and its next action remain unchanged

#### Scenario: Windows artifact paths remain valid
- **WHEN** task targets or the internal UTF-8 input bridge use Windows paths containing spaces or non-ASCII characters
- **THEN** Rasen resolves authorized local targets with platform path APIs and records the same canonical task contract without slash- or shell-dependent corruption

### Requirement: Task loop remains separate from spec-driven execution

A task-loop runtime SHALL use its Change only as a technical identity, Run, evidence, delivery, and archive container. It SHALL execute without runtime `proposal.md`, `design.md`, `specs/`, `tasks.md`, or `goal-plan.md` and SHALL never create those artifacts as a fallback or convert the active Run to another Pipeline.

#### Scenario: New task loop has no planning artifacts
- **WHEN** an explicit task-loop Run starts and performs work
- **THEN** its runtime Change contains no generated proposal, design, delta spec, task list, or goal-plan artifact
- **AND** the canonical task contract supplies the builder and critic context

#### Scenario: Unsatisfied task never upgrades to specs
- **WHEN** a task-loop Run is exhausted, blocked, cancelled, or stopped with a remaining gap
- **THEN** Rasen preserves that terminal outcome and evidence
- **AND** it does not initialize or switch to `small-feature`, `full-feature`, a goal Pipeline, or any other spec-driven Pipeline

#### Scenario: Resume preserves the selected lifecycle
- **WHEN** a task-loop Run is resumed after interruption
- **THEN** Rasen reloads the sealed `task-loop` plan and frozen contract and continues at the deterministic next phase
- **AND** it does not run a planning stage

### Requirement: Builders improve real artifacts without judging themselves

Each task-loop round SHALL assign a builder to inspect and modify the real artifact targets under the frozen goal, bar, and constraints. The builder SHALL return material change and raw verification evidence but SHALL NOT authoritatively declare the bar satisfied. A later round SHALL receive only the prior critic's largest gap and explicit pass condition in addition to the frozen contract.

#### Scenario: Builder produces material work and evidence
- **WHEN** a work phase succeeds
- **THEN** its canonical result binds distinct before/after workspace revisions and raw evidence for the affected real artifacts
- **AND** the Run advances to judgment rather than shipping

#### Scenario: Builder receives focused feedback
- **WHEN** a prior critic reports the task unsatisfied
- **THEN** the next builder receives the frozen contract plus that single largest gap and its testable pass condition
- **AND** it is not allowed to weaken or replace the bar

#### Scenario: Builder cannot self-pass
- **WHEN** the builder's completion text claims the task is complete
- **THEN** Rasen treats the claim as non-authoritative and still requires a valid independent critic completion

### Requirement: Every judgment uses a fresh role-separated critic and real evidence

For every round, Rasen SHALL assign a critic whose actor identity differs from the current builder and every prior task-loop critic. The critic context SHALL contain the frozen goal, bar, constraints, relevant references, real target locations, and raw evidence, and SHALL exclude the builder's reasoning history, justification, and summary. The critic SHALL inspect real artifacts or their direct runtime/render/test/measurement evidence rather than grading a summary.

#### Scenario: Fresh critic inspects a round
- **WHEN** a builder completes a work phase
- **THEN** a new reviewer-bound actor receives the frozen contract and real artifact/evidence locations
- **AND** no builder narrative is included in the critic action input

#### Scenario: Builder actor is rejected as critic
- **WHEN** the work actor attempts to complete the judgment phase
- **THEN** Rasen rejects the completion with `goal_cycle_actor_separation`

#### Scenario: Prior critic actor is rejected on a later round
- **WHEN** an actor that judged an earlier task-loop round attempts to judge again
- **THEN** Rasen rejects the completion with `task_loop_critic_reused`
- **AND** the expected judgment remains pending

#### Scenario: Summary-only judgment is rejected
- **WHEN** a critic supplies conclusions without raw evidence tied to the frozen artifact targets and criteria
- **THEN** Rasen rejects the completion as insufficient task-loop evidence

### Requirement: Critic judgments exactly cover the frozen quality bar

A task-loop critic result SHALL report every frozen criterion exactly once with a satisfied flag and evidence. A satisfied result SHALL be valid only when every criterion passes and no gap remains. An unsatisfied result SHALL identify exactly one largest material remaining gap and an explicit next-round pass condition. Rasen SHALL reject incomplete, expanded, contradictory, or falsely satisfied judgments.

#### Scenario: Fully evidenced bar satisfies the task
- **WHEN** a fresh critic reports every frozen criterion satisfied, supplies raw evidence for each criterion, and reports no gap
- **THEN** Rasen records the loop outcome as `satisfied`

#### Scenario: Criterion set differs from the frozen bar
- **WHEN** a critic omits a criterion, adds a criterion, duplicates an identifier, or changes a frozen identifier
- **THEN** Rasen rejects the completion with `task_loop_bar_mismatch`

#### Scenario: Satisfaction contradicts criterion results
- **WHEN** a critic reports `satisfied: true` while any criterion is unsatisfied or any gap remains
- **THEN** Rasen rejects the completion with `task_loop_false_satisfaction`

#### Scenario: Unsatisfied result focuses the next round
- **WHEN** one or more criteria remain unsatisfied
- **THEN** the accepted judgment contains only the largest material gap plus a directly testable next-round pass condition
- **AND** all per-criterion evidence remains inspectable in Run status

### Requirement: Only satisfaction enables ship and archive

Rasen SHALL make the task-loop `ship` stage ready only after a mechanically valid `satisfied` outcome and SHALL make `archive` ready only after successful ship. Exhaustion, blockage, cancellation, phase failure, and explicit stop SHALL be terminal or escalated outcomes that retain their cause and evidence and SHALL never enable delivery. `--no-gate` SHALL remove ordinary confirmation pauses only; it SHALL NOT bypass these guards or safety and delivery permissions.

#### Scenario: Satisfied task ships and archives
- **WHEN** the canonical task-loop outcome is validly `satisfied`
- **THEN** Rasen admits the existing ship stage and, after successful delivery, the existing archive stage
- **AND** the delivered evidence is bound to the frozen task contract digest

#### Scenario: Round budget is exhausted
- **WHEN** the effective round budget is consumed without a valid satisfied judgment
- **THEN** the Run terminates or escalates as `task_loop_exhausted` with the latest evidence and largest gap
- **AND** neither ship nor archive is admitted

#### Scenario: Genuine blocker stops delivery
- **WHEN** a permission, safety, dependency, external-state, or failed-phase blocker prevents further material work
- **THEN** the Run exposes a blocked/escalated terminal with the original cause
- **AND** neither ship nor archive is admitted

#### Scenario: User cancels the loop
- **WHEN** the user cancels an active task-loop Run
- **THEN** the canonical Run remains cancelled on resume and admits no further builder, critic, ship, or archive action

#### Scenario: No-gate cannot turn failure into success
- **WHEN** a task-loop Run was launched with `--no-gate` but ends exhausted, blocked, cancelled, or unsatisfied
- **THEN** Rasen records the no-gate policy yet still refuses ship and archive

### Requirement: Task-loop progress and evidence are resumable and observable

Task-loop status SHALL derive from the sealed RuntimePlan and Canonical Run Record and expose the frozen contract digest, safe contract fields, round, phase, effective budget, builder/critic identity, criterion evidence, latest largest gap and pass condition, stall state, and outcome. Any human-readable progress or evidence file SHALL be a read-only projection that cannot change the canonical next action or terminal result.

#### Scenario: Status explains in-progress work
- **WHEN** a task-loop Run is between work and judgment or between rounds
- **THEN** status reports the exact current round/phase, actors already committed, evidence already recorded, remaining budget, and the deterministic next action

#### Scenario: Resume does not duplicate a completed phase
- **WHEN** a process stops after a phase completion and later resumes
- **THEN** Rasen replays the committed events, preserves actor/evidence history, and admits only the next uncompleted phase

#### Scenario: Derived report is stale or absent
- **WHEN** a `task-loop-report.md` or compatibility projection is absent, stale, or edited
- **THEN** status and delivery guards continue to use the Canonical Run Record
- **AND** the projection cannot back-drive satisfaction

### Requirement: Task loop participates in built-in registry and workflow parity

The `task-loop` Pipeline and its internal skill SHALL be installed, inspectable, validated, localized, and generated wherever the corresponding built-in Pipeline and workflow registries require explicit membership. Execution preflight SHALL require canonical reconciler support, and existing goal Pipelines SHALL retain their current declared skills and behavior.

#### Scenario: Registry lists and shows task loop
- **WHEN** a user runs Pipeline list/show/validation against a current installation
- **THEN** `task-loop` resolves as a valid built-in with iterate, ship, and archive stages and the role-isolated evaluate loop

#### Scenario: Unsupported engine is rejected before work
- **WHEN** task-loop execution is requested with an engine that cannot enforce canonical inputs, fresh critics, and terminal guards
- **THEN** preflight rejects the launch before a builder is admitted with a localized reconciler-required diagnostic

#### Scenario: Generated auto skill includes task-loop support
- **WHEN** Rasen initializes or updates generated skills and workflow manifests
- **THEN** the generated `rasen-auto` content, strong dependencies, template parity hashes, and explicit built-in name lists include `task-loop` and its internal skill

#### Scenario: Existing goal loops do not change capability
- **WHEN** measure, evaluate, or research goal Pipelines are loaded after this change
- **THEN** each still lowers to its declared `rasen-goal-iterate` capability and preserves its prior plan and runtime behavior

#### Scenario: Diagnostics are localized
- **WHEN** task-loop validation or terminal diagnostics are rendered in English, Japanese, or Simplified Chinese
- **THEN** Rasen uses the locale catalog rather than exposing an unlocalized internal fallback
