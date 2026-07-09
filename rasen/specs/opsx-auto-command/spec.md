# opsx-auto-command Specification

## Purpose
Provide the `/rasen:auto` autopilot command — task-complexity classification, pipeline selection (full-feature / small-feature / bug-fix), gated pause points, expert selection, and DAG-state resume — driving the Rasen workflow end-to-end.
## Requirements
### Requirement: Auto Skill and Command Templates

The system SHALL provide a SkillTemplate and CommandTemplate for auto in `src/core/templates/workflows/auto.ts`.

#### Scenario: Template file exports

- **WHEN** the template file is loaded
- **THEN** it SHALL export `getAutoCommandSkillTemplate()` returning a SkillTemplate
- **AND** it SHALL export `getOpsxAutoCommandTemplate()` returning a CommandTemplate
- **AND** both templates SHALL follow the same pattern as existing workflow templates

#### Scenario: Dispatch agent logic embedded

- **WHEN** the auto skill template is generated
- **THEN** the skill instructions SHALL include the dispatch agent logic (task analysis, expert selection, pipeline orchestration)
- **AND** this logic SHALL be inlined from `fusion/agents/dispatch.md` content

### Requirement: Task Complexity Classification

The auto command SHALL classify the task and select a pipeline from the pipeline registry rather than from a hard-coded set of prose pipelines. The classification result SHALL be overridable by the user before execution.

#### Scenario: Classification selects a registry pipeline

- **WHEN** the user invokes `/rasen:auto` with a task description
- **THEN** auto SHALL classify the task (e.g. via `rasen pipeline classify "<task>" --json`) to a pipeline name resolved from the registry (`full-feature`, `small-feature`, `bug-fix`, or any user/project-defined pipeline)
- **AND** SHALL display the classification and allow the user to override it before proceeding

#### Scenario: New task types need no auto changes

- **WHEN** a new pipeline definition is added to the registry
- **THEN** auto SHALL be able to classify to and execute it without any change to the auto template or other source

### Requirement: Full Feature Pipeline

Full feature pipeline SHALL execute: office-hours, propose, parallel expert reviews, apply, verify, ship, archive, retro. Planning and task generation are produced by the propose stage; review depth comes from the pipeline registry's expert-review stages and the review-loop, not from a standalone planning skill.

#### Scenario: Full feature pipeline stages

- **WHEN** the full feature pipeline runs
- **THEN** the system SHALL execute stages in order: office-hours → propose → [parallel expert reviews + review-loop] → apply → verify → ship → archive → retro
- **AND** each stage SHALL wait for the previous stage to complete before starting

#### Scenario: Expert selection for full features

- **WHEN** executing the expert review stage of a full feature pipeline
- **THEN** the system SHALL run the pipeline registry's expert-review stages against the propose output (the `review` expert, plus `cso`/`benchmark`/`qa`/`design-review` as the change warrants), iterating through the review-loop
- **AND** SHALL invoke /cso if the change is security-relevant
- **AND** SHALL invoke /benchmark if the change is performance-sensitive

### Requirement: Small Feature Pipeline

Small feature pipeline SHALL execute: propose, apply, verify, ship, archive.

#### Scenario: Small feature pipeline stages

- **WHEN** the small feature pipeline runs
- **THEN** the system SHALL execute stages in order: propose → apply → verify → ship → archive
- **AND** office-hours and retro stages SHALL be skipped

### Requirement: Bug Fix Pipeline

The Bug-Fix pipeline SHALL use an adaptive verify policy: a green unit-test gate suffices for simple fixes, while complex fixes additionally engage a dedicated test/verification worker. The unit-test gate's evidence SHALL be recorded for the ship stage's evidence-based test gate.

#### Scenario: Simple fix passes on the unit-test gate

- **WHEN** a bug fix is simple (e.g. single file, non-core path, sufficient tests) and the unit-test gate is green
- **THEN** verify SHALL pass without entering the review loop
- **AND** the simple/complex determination SHALL be recorded in run-state

#### Scenario: Complex fix gets deeper verification

- **WHEN** a bug fix is complex (e.g. multiple files, core paths, insufficient coverage)
- **THEN** the LEAD SHALL spawn a dedicated test/verification worker and enter the review-cycle loop

#### Scenario: Unit-test gate evidence recorded

- **WHEN** the unit-test gate runs during adaptive verify
- **THEN** the gate's command, result, and the git code state it ran against SHALL be recorded in run-state

### Requirement: Pause Points for User Confirmation

The command SHALL provide 3 pause points for user confirmation during pipeline execution.

#### Scenario: Pause at Planning to Implementation transition

- **WHEN** the pipeline completes the planning phase (office-hours/propose)
- **AND** is about to begin implementation (apply)
- **THEN** the system SHALL pause and display a summary of the plan
- **AND** SHALL prompt the user to confirm before proceeding to implementation

#### Scenario: Pause at Implementation to Verification transition

- **WHEN** the pipeline completes implementation (apply)
- **AND** is about to begin verification (verify)
- **THEN** the system SHALL pause and display what was implemented
- **AND** SHALL prompt the user to confirm before proceeding to verification

#### Scenario: Pause at Verification to Release transition

- **WHEN** the pipeline completes verification (verify)
- **AND** is about to begin release (ship)
- **THEN** the system SHALL pause and display the verification results
- **AND** SHALL prompt the user to confirm before proceeding to release
- **AND** if verification found critical issues, SHALL recommend resolving them first

#### Scenario: User declines at pause point

- **WHEN** the user declines to proceed at any pause point
- **THEN** the system SHALL stop the pipeline at that stage
- **AND** SHALL save current progress so the pipeline can be resumed later

### Requirement: DAG State Resume

On invocation, auto SHALL determine where to resume from the change's artifacts and the LEAD run-state, via the registry's resume surface.

#### Scenario: Resume from run-state

- **WHEN** `/rasen:auto` is invoked for an existing change
- **THEN** auto SHALL determine the next incomplete stage (e.g. via `rasen pipeline resume <change> --json`) using artifact presence plus the run-state record
- **AND** SHALL resume from that stage rather than restarting

### Requirement: Expert Selection

Expert selection SHALL be context-aware based on change characteristics.

#### Scenario: Planning for full features

- **WHEN** the pipeline is classified as Full Feature
- **THEN** the system SHALL produce comprehensive planning and task generation through the propose stage and the pipeline registry's expert-review stages
- **AND** SHALL NOT invoke a standalone /autoplan skill

#### Scenario: CSO for security-relevant changes

- **WHEN** the change touches authentication, authorization, input validation, cryptography, or data handling
- **THEN** the system SHALL invoke /cso for security review during the appropriate pipeline stage

#### Scenario: Benchmark for performance-sensitive changes

- **WHEN** the change involves database queries, API endpoints, rendering logic, or computational algorithms
- **THEN** the system SHALL invoke /benchmark for performance analysis during the appropriate pipeline stage

### Requirement: Orchestrated Execution via the Pipeline Playbook

Auto SHALL execute the selected pipeline by interpreting its DAG through the `rasen-orchestration` playbook, dispatching each stage to a role-isolated worker, rather than performing the stages itself in a single context.

#### Scenario: Stages dispatched to workers

- **WHEN** auto executes a selected pipeline
- **THEN** the LEAD SHALL dispatch each stage (including `office-hours`, `propose`, and `apply`) to a worker of the stage's role, honoring gates, loops, parallel groups, and conditions per `rasen-orchestration`
- **AND** the LEAD SHALL itself not author stage outputs, but coordinate and record them

### Requirement: Optional Propose Direction-Review Gate

Auto SHALL support an optional gate by which the LEAD reviews the propose output for direction drift before implementation, controlled by a parameter.

#### Scenario: Lead reviews the plan for drift

- **WHEN** the propose direction-review gate is enabled (e.g. via `--review-plan` or a pipeline `leadReview` flag)
- **THEN** after the propose worker returns and before `apply`, the LEAD SHALL review `proposal/design/specs/tasks` against the original user intent
- **AND** on detecting drift the LEAD SHALL bounce the work back to a fresh planner worker or surface it to the user
- **AND** because the LEAD did not author the proposal, this review SHALL count as a non-author check

#### Scenario: Gate disabled by default leaves flow unchanged

- **WHEN** the gate is not enabled
- **THEN** auto SHALL proceed from propose to the next stage without the extra LEAD review

### Requirement: Decompose 是 Auto 的条件性首步

`/rasen:auto` SHALL 把 decompose 阶段作为它的第一步来评估，并根据任务本身（而非某个独立命令）决定执行还是跳过。当任务是单个内聚、可 review 的切片时，LEAD SHALL 跳过 decompose，并像今天未拆分的流水线那样在一个 change 上继续。当任务包含多个相互独立的交付物、若干彼此不同的能力、或大到无法作为单个 diff 来 review 的范围时，LEAD SHALL 执行 decompose 并扇出。

#### Scenario: 单个内聚任务跳过 decompose

- **WHEN** 针对一个单个内聚 change 运行 `/rasen:auto <task>`
- **THEN** LEAD SHALL 把 decompose 阶段记录为已跳过
- **AND** SHALL 在一个 change 上运行其余阶段，相对今天无行为变化

#### Scenario: 大型多交付物任务执行 decompose

- **WHEN** 针对一个跨多个相互独立交付物的任务运行 `/rasen:auto <task>`
- **THEN** LEAD SHALL 执行 decompose 阶段并产出一份拆分方案

### Requirement: LEAD 自审拆分方案（默认无人类 gate）

当 decompose 被执行时，`/rasen:auto` SHALL 让 LEAD 自审拆分方案（子 change、依赖 DAG，以及串行/并行执行计划）并自动继续；它 SHALL NOT 在默认情况下要求人类批准。仅当 LEAD 无法产出一份安全方案时，它 SHALL 升级给人类。用户 MAY 仍随时中断。

#### Scenario: LEAD 自审并在无人类批准下继续

- **WHEN** LEAD 形成一份它判定为安全的拆分方案
- **THEN** 它 SHALL 开始按方案执行子 change，而不为人类批准而暂停

#### Scenario: 仅当不存在安全方案时才升级

- **WHEN** LEAD 无法为方案确立安全的排序或独立性
- **THEN** 它 SHALL 升级给人类并说明问题，而不是继续执行

#### Scenario: 用户中断仍被尊重

- **WHEN** 用户在一次已拆分的运行期间中断
- **THEN** LEAD SHALL 停止并交还控制权，且组合运行状态已保存以便恢复

### Requirement: Auto 的组合恢复

当 `/rasen:auto` 在一个已拆分的父 change 上被重新调用时，它 SHALL 从组合运行状态恢复该组合，而非重新开始——按依赖顺序继续未完成的子 change，并且不重新运行已完成的子 change。

#### Scenario: 恢复继续该组合

- **WHEN** `/rasen:auto` 在一个已有组合运行状态的父 change 上被重新调用
- **THEN** LEAD SHALL 从下一个（些）可运行子 change 恢复，且 SHALL NOT 重新运行已完成的子 change

### Requirement: verifyPolicy Values Are Defined

The auto workflow (`src/core/templates/workflows/auto.ts`, §5) SHALL define the behavior of every `verifyPolicy` enum value carried by pipeline stages — `adaptive`, `standard`, and `light` — not only `adaptive`. `adaptive` SHALL scale the verification passes to the diff size (as today); `standard` SHALL run a single verify pass without the review-cycle loop; `light` SHALL skip verification when the diff is trivial (e.g. docs/tests-only). No `verifyPolicy` value carried by a shipped pipeline SHALL be undefined dead config.

#### Scenario: standard and light have defined semantics

- **WHEN** the generated auto workflow verification section is inspected
- **THEN** it SHALL define `standard` (single verify pass, no loop) and `light` (skip verify on a trivial diff) in addition to `adaptive`
- **AND** no pipeline-carried `verifyPolicy` value SHALL be left without stated behavior

