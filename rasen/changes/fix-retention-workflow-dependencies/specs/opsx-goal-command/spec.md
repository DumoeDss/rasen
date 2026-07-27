## ADDED Requirements

### Requirement: Goal command executes retention for shipped work

The `rasen-goal` LEAD SHALL execute the selected backend pipeline's declared lifecycle tail rather than substituting post-stage prose for a missing stage. Measure and evaluate runs SHALL execute ship, then the profile-selected retention operation, then archive; research runs SHALL continue to end at their report stage without shipping or retention.

#### Scenario: Measure goal retains before archive

- **WHEN** a `rasen-goal measure` run completes its iterate loop and ship stage
- **THEN** the LEAD SHALL dispatch `rasen-retain` before `rasen-archive-change`
- **AND** archive SHALL not become ready until retain completes successfully or records the `off` no-op

#### Scenario: Evaluate goal retains before archive

- **WHEN** a `rasen-goal evaluate` run completes its iterate loop and ship stage
- **THEN** the LEAD SHALL dispatch `rasen-retain` using the mode frozen for that run
- **AND** a resume SHALL continue the same retention branch before archive

#### Scenario: Goal display reflects the real tail

- **WHEN** the goal command displays the chosen pipeline and run progress
- **THEN** measure and evaluate descriptions SHALL show `ship → retain → archive`
- **AND** research descriptions SHALL show the report-only tail

#### Scenario: Research goal does not gain a retention stage

- **WHEN** a `rasen-goal research` run satisfies or exhausts its evaluate loop
- **THEN** the LEAD SHALL execute the goal-report tail
- **AND** it SHALL not dispatch ship, retain, or archive
