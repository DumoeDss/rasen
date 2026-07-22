# opsx-goal-command Specification

## Purpose
Define the `/rasen-goal` command and its backing skill templates — the single user-facing entry to the goal-loop family, LEAD classification and explicit override semantics, and the three goal-loop skill templates (plan, iterate, report) registered through the existing generation pipeline.

## Requirements
### Requirement: Goal Command and Skill Templates

The system SHALL provide a `rasen-goal` SkillTemplate and a `Rasen: Goal` CommandTemplate in `src/core/templates/workflows/` (mirroring `auto.ts`'s structure), plus three goal-loop skill templates — `rasen-goal-plan`, `rasen-goal-iterate`, and `rasen-goal-report` — all registered through the existing skill/command generation pipeline so `rasen init` installs them when the workflow is selected.

#### Scenario: Templates export and register

- **WHEN** the template files are loaded
- **THEN** the goal command module SHALL export a SkillTemplate named `rasen-goal`, invoked as `/rasen-goal`
- **AND** the three skill modules SHALL export `SkillTemplate`s named `rasen-goal-plan`, `rasen-goal-iterate`, and `rasen-goal-report`
- **AND** all four SHALL be registered in `getSkillTemplates()` in `src/core/shared/skill-generation.ts`, and re-exported from `src/core/templates/skill-templates.ts`

#### Scenario: Goal-plan skill produces a goal plan, not a proposal

- **WHEN** the `rasen-goal-plan` skill runs at the `define-goal` stage
- **THEN** it SHALL produce a `goal-plan.md` containing a natural-language `goal`, a `gate` (`{kind: measure, command, threshold/target, direction}` OR `{kind: evaluate, goal, rubric}`), a `workProduct` (`code` | `prose`), and `maxRounds`
- **AND** it SHALL NOT produce a proposal, design, or specs

#### Scenario: Goal-iterate skill is work-product-aware and never spawns children

- **WHEN** the `rasen-goal-iterate` skill runs at the `iterate` loop stage
- **THEN** for a `code` work product it SHALL edit code toward the goal and MAY self-run the measure command informally during its dispatch
- **AND** for a `prose` work product it SHALL research (web search/fetch) and write/refine the document inline
- **AND** it SHALL NOT spawn child subagents (flat-hierarchy invariant)

#### Scenario: Goal-report skill summarizes the run

- **WHEN** the `rasen-goal-report` skill runs at the research pipeline's `report` tail stage
- **THEN** it SHALL summarize `goal-run.json` (rounds, scores or satisfaction, outcome) into a final report artifact
- **AND** it SHALL NOT ship or archive code

### Requirement: LEAD Classifies and Selects a Backend Pipeline

The `/rasen-goal` command SHALL present a single user-facing entry. The LEAD SHALL run its pre-flight and classify the task, selecting ONE backend pipeline from `goal-loop-measure`, `goal-loop-evaluate`, and `goal-loop-research`. Classification keywords SHALL be suggestions only (an explicit selector always wins): score/latency/optimize/lighthouse/benchmark/p99/memory/throughput → measure; rubric/quality/clean/standard/refactor-quality → evaluate; research/investigate/write report or brief/autoresearch/literature → research.

#### Scenario: Single entry with LEAD classification

- **WHEN** a user runs `/rasen-goal <task>` with no selector
- **THEN** the LEAD SHALL classify the task and select one backend pipeline
- **AND** SHALL display the chosen pipeline and let the user change it before proceeding

#### Scenario: Classification keywords are advisory

- **WHEN** the LEAD classifies a task and no explicit selector is present
- **THEN** it SHALL use the classification keywords as suggestions
- **AND** the suggestion SHALL be overridable by the caller

### Requirement: Explicit Override Wins

An explicit pipeline selection SHALL always override LEAD classification. The user MAY select the backend directly with a leading selector token (`/rasen-goal measure|evaluate|research <task>`) or with `--pipeline goal-loop-<variant>`.

#### Scenario: Selector token overrides classification

- **WHEN** `/rasen-goal measure <task>` is invoked
- **THEN** the LEAD SHALL select the `goal-loop-measure` pipeline regardless of its own classification suggestion
- **AND** SHALL strip the selector token; the rest is the task description

#### Scenario: Pipeline flag overrides classification

- **WHEN** `/rasen-goal --pipeline goal-loop-research <task>` is invoked
- **THEN** the LEAD SHALL select the `goal-loop-research` pipeline
- **AND** explicit selection SHALL win over both classification and the default

### Requirement: Goal Workflows Deploy Under the Full Profile

The goal-loop family SHALL be first-class registered workflows so that `rasen update` and `rasen init` install them under the default `full` profile. Registration in the generation pipeline alone is insufficient: because the `full` profile passes a workflow filter, a goal workflow that is absent from the profile-system registries is silently filtered out and never emitted. The system SHALL therefore register each goal workflow ID in the profile registry, map each to its skill directory name in every skill-directory registry, and register the goal command ID in the command registry, so that a `full`-profile install produces the four goal skill directories and the goal command payload.

#### Scenario: Goal workflows are members of the full profile

- **WHEN** the `full` profile resolves its workflow set
- **THEN** the set SHALL include the workflow IDs `goal-plan`, `goal-iterate`, `goal-report`, and `goal-command`
- **AND** these IDs SHALL be recognized workflow IDs (present in the system's list of all available workflows), so the workflow filter does not drop the goal skills

#### Scenario: Goal workflows map to their skill directories

- **WHEN** the system resolves the skill directory name for a goal workflow ID
- **THEN** `goal-plan` SHALL map to `rasen-goal-plan`, `goal-iterate` SHALL map to `rasen-goal-iterate`, `goal-report` SHALL map to `rasen-goal-report`, and `goal-command` SHALL map to `rasen-goal` (the entry command's directory name has no `-command` suffix, matching its SkillTemplate name)
- **AND** this mapping SHALL be consistent across every skill-directory registry the system consults, so directory selection, drift detection, and removal of unselected skill directories all recognize the goal directories

#### Scenario: Goal command ID is registered

- **WHEN** the system enumerates the command template IDs it creates
- **THEN** the list SHALL include `goal-command`, so the `/rasen-goal` command payload is generated and detected

#### Scenario: rasen update installs the goal family under the full profile

- **WHEN** `rasen update` runs in a project configured with the `full` profile and `both` delivery
- **THEN** the four skill directories `rasen-goal-plan`, `rasen-goal-iterate`, `rasen-goal-report`, and `rasen-goal` SHALL be present after the run
- **AND** the `/rasen-goal` command payload SHALL be present after the run
- **AND** each goal skill directory SHALL be located under the project's skills directory using platform-appropriate path joining (no assumption of a forward-slash separator)
