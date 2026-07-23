# workflow-help-command Specification

## Purpose
Defines the `help` workflow — skill `rasen-help` and slash command `/rasen-help` — a router that guides users to the right Rasen command or flow, answers usage questions, and helps with configuration. It is part of both ALL_WORKFLOWS and CORE_WORKFLOWS (new users are its primary audience), generated per the configured delivery mode.
## Requirements
### Requirement: Help workflow generation
The system SHALL provide a `help` workflow (skill `rasen-help`) included in both ALL_WORKFLOWS and CORE_WORKFLOWS, generated as a skill (skills are the only delivery format) and covered by drift detection like other workflows.

#### Scenario: Generated in full and core profiles
- **WHEN** `rasen init`/`update` runs with profile `full` or `core`
- **THEN** `.claude/skills/rasen-help/SKILL.md` SHALL be generated
- **AND** no `rasen` help command file SHALL be generated

#### Scenario: Custom profile opt-out
- **WHEN** a custom profile omits `help`
- **THEN** the `help` workflow SHALL NOT be generated, and drift detection SHALL remove previously generated help artifacts on the next sync

### Requirement: Help skill routes instead of working
The help skill SHALL act as a router and explainer: it classifies the user's need (choosing a command/flow, usage question, configuration help, or troubleshooting), answers from a map of Rasen's workflows, CLI commands, and configuration surfaces, and closes with a single next action. It SHALL NOT perform the work of other workflows itself. It SHALL reference workflows by their canonical skill name (e.g. `rasen-propose`), not the `/rasen:*` colon form.

The map SHALL be layered by user level so it serves both audiences: a zero-knowledge path (Rasen's spec-driven mental model, then init → onboard → first propose), the daily main flow with variant routing, autonomous orchestration, and an advanced layer covering pipeline inspection and extension (custom `pipeline.yaml` at project/user level with project > user > package resolution), gate tuning (`autopilot.gates`), per-role runtimes (`pipeline agents`), and cross-repo stores/projects. The skill SHALL gauge the user's level from workspace evidence (e.g. `rasen status`) and the question itself.

#### Scenario: Routing a situation to a command
- **WHEN** a user asks which command fits their situation (e.g. "I have an idea I want built")
- **THEN** the skill SHALL name the fitting workflow or flow (e.g. the `rasen-propose` skill for the main flow) and end with that single next action rather than a menu of everything

#### Scenario: Grounding version- and flag-specific answers
- **WHEN** the answer depends on installed version, flags, or workspace state
- **THEN** the skill SHALL instruct grounding in actual CLI output (`rasen --version`, `rasen --help`, `rasen <command> --help`, `rasen status`) rather than inventing flags

#### Scenario: Zero-knowledge user onboarding path
- **WHEN** a user with no Rasen workspace (or who asks "what is Rasen?") invokes help
- **THEN** the skill SHALL give the spec-driven mental model first (specs as long-term truth, changes as artifact-carrying units of work) and route to `rasen init` then the `rasen-onboard` skill before any other workflow

#### Scenario: Advanced user pipeline extension guidance
- **WHEN** a user asks how to customize or extend autonomous runs (pipelines, gates, roles)
- **THEN** the skill SHALL cover inspecting pipelines (`rasen pipeline list`/`show`/`classify`), authoring a custom `pipeline.yaml` under `rasen/pipelines/<name>/` (project) or the machine home `pipelines/` directory (user) with stage fields (id, skill, role, requires, gate, condition, childPipeline), name-shadowing resolution (project > user > package), `autopilot.gates` tuning, and `rasen pipeline agents` per-role runtime assignment

#### Scenario: Configuration and troubleshooting coverage
- **WHEN** a user asks about setup, configuration, or a broken install
- **THEN** the skill SHALL cover profiles (full/core/custom), `rasen/config.yaml`, the machine home (`~/.rasen`, `RASEN_HOME` override), telemetry opt-out, upstream OpenSpec coexistence/migration, and route repair questions to `rasen init`/`rasen update`/`rasen doctor`

