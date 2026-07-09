## ADDED Requirements

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
- **THEN** the list SHALL include `goal-command`, so the `/rasen:goal` command payload is generated and detected

#### Scenario: rasen update installs the goal family under the full profile

- **WHEN** `rasen update` runs in a project configured with the `full` profile and `both` delivery
- **THEN** the four skill directories `rasen-goal-plan`, `rasen-goal-iterate`, `rasen-goal-report`, and `rasen-goal` SHALL be present after the run
- **AND** the `/rasen:goal` command payload SHALL be present after the run
- **AND** each goal skill directory SHALL be located under the project's skills directory using platform-appropriate path joining (no assumption of a forward-slash separator)
