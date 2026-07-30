# investigate-diagnosing-absorption Specification

## Purpose
Folds grill `diagnosing-bugs` (MIT) into the existing `investigate` skill: before any hypothesis work, the agent must build a tight, red-capable feedback loop that drives the actual bug code path and asserts the exact symptom — no such command means no hypothesis phase. investigate keeps its Iron Law and four-phase gates; the HITL loop template rides along as a sidecar, and the skill's registration and counts stay unchanged.
## Requirements
### Requirement: Investigate requires a red-capable feedback loop before hypotheses

The `investigate` skill SHALL, before any hypothesis work, require building a tight feedback loop that can go red on the specific bug. The skill body SHALL state a hard gate: the agent can name one command it has already run at least once that drives the actual bug code path and asserts the user's exact symptom, is deterministic, fast, and agent-runnable — and that without such a command it SHALL NOT proceed to hypothesis testing. The skill SHALL keep the existing Iron Law (no fix without root cause) and its four-phase gates. This content is adapted from grill `diagnosing-bugs` (MIT) and SHALL carry an attribution note.

#### Scenario: Feedback-loop gate present in installed skill

- **WHEN** the installed `investigate` expert `SKILL.md` is inspected
- **THEN** it SHALL contain a "build a feedback loop" phase preceding hypothesis testing
- **AND** it SHALL state that no red-capable command means no hypothesis phase
- **AND** it SHALL retain the Iron Law (no fix without root cause)

#### Scenario: Minimise step present

- **WHEN** the installed investigate skill is inspected
- **THEN** it SHALL instruct shrinking the reproduction to the smallest scenario that still goes red

#### Scenario: Stricter overlaps kept on merge

- **WHEN** the merged hypothesis and regression-test guidance is inspected
- **THEN** hypotheses SHALL be required to be ranked and falsifiable (with a stated prediction)
- **AND** the regression guidance SHALL state that the absence of a correct test seam is itself a finding

### Requirement: Investigate uses risk-proportional verification

After the regression loop is green, the `investigate` skill SHALL select and
record the smallest verification scope that credibly covers the fix. A
localized fix SHALL require its regression loop and directly affected module or
package checks, but SHALL NOT require the full repository suite merely because
the workflow is finishing. The scope SHALL broaden for cross-cutting contracts,
dependency/build/config/CI changes, concurrency, persistence, migrations,
security boundaries, cross-platform behavior, broad multi-module edits, or
focused failures outside the expected area.

#### Scenario: Localized fix stops after affected checks

- **WHEN** a fix is confined to one behavior and has a direct regression test
- **AND** no cross-cutting trigger or project instruction requires broader coverage
- **THEN** investigate SHALL complete after the regression and affected-area checks pass
- **AND** SHALL NOT run the full repository suite

#### Scenario: Full-suite escalation names cause and cost

- **WHEN** risk cannot be bounded more narrowly or the user or project instructions require the full suite
- **THEN** investigate SHALL record that trigger
- **AND** before a run expected to exceed 60 seconds SHALL state the expected cost
- **AND** SHALL NOT repeat an unchanged full-suite command that already timed out

#### Scenario: Verification evidence is reusable

- **WHEN** investigate completes verification
- **THEN** it SHALL record the selected scope, rationale, exact commands, result, and content tree fingerprint
- **AND** downstream ship SHALL be able to compare both scope coverage and tree identity

### Requirement: HITL loop template carried as investigate sidecar

The system SHALL carry `skills/experts/investigate/scripts/hitl-loop.template.sh` (adapted from grill `diagnosing-bugs`, MIT) and reference it by relative path from the investigate skill for the human-in-the-loop last-resort case.

#### Scenario: HITL sidecar exists and is referenced

- **WHEN** the investigate source skill directory (`skills/experts/investigate/`) is inspected
- **THEN** `scripts/hitl-loop.template.sh` SHALL exist with an MIT attribution NOTICE at its head
- **AND** the installed `SKILL.md` SHALL reference `scripts/hitl-loop.template.sh`

### Requirement: Investigate registration and count unchanged

The absorption SHALL NOT rename the `investigate` base name, alter its expert registration, or change any skill count.

#### Scenario: No registration or count drift

- **WHEN** `getSkillTemplates()` and the count assertions in `test/core/shared/skill-generation.test.ts` are evaluated
- **THEN** the `rasen-investigate` entry SHALL be present
- **AND** all expert/total counts SHALL be unchanged

### Requirement: Investigate declares and verifies its change scope

The `investigate` skill SHALL, after minimizing the reproduction and before
making a fix, record the narrowest affected area supported by current evidence.
If root-cause evidence requires edits outside that area, investigate SHALL
record the reason and revised area before making those edits. Before
completion, it SHALL compare the actual changed-file set and diff with the
latest declared scope and SHALL classify every unexpected change as justified
scope expansion or unresolved out-of-scope work. The guidance SHALL state that
this discipline is evidence and review, not mechanical write enforcement.

#### Scenario: Localized investigation remains within declared scope

- **WHEN** the root cause and fix remain within the initially declared affected
  module
- **THEN** investigate SHALL inspect the final changed-file set and confirm
  that every changed file is within that area
- **AND** SHALL record the scope check with its verification evidence

#### Scenario: Evidence expands the affected area

- **WHEN** root-cause analysis proves that a necessary fix crosses the initial
  affected-area boundary
- **THEN** investigate SHALL record the evidence and revised scope before
  editing the additional area
- **AND** the final diff audit SHALL evaluate changes against the revised scope

#### Scenario: Unexpected change is not silently accepted

- **WHEN** the final changed-file inspection finds a file outside the latest
  declared scope without a recorded justification
- **THEN** investigate SHALL report it as unresolved out-of-scope work
- **AND** SHALL NOT describe the investigation as complete until the change is
  reverted or its scope expansion is justified and verified

### Requirement: Investigate has no boundary transition lifecycle

The `investigate` skill SHALL NOT invoke or instruct users to invoke
freeze/unfreeze or `rasen agent edit-boundary` transitions. Investigation
cleanup SHALL consist of resolving its temporary debugging changes and
verifying the final diff, with no machine-local boundary state to clear.

#### Scenario: Generated investigate contains no retired invocation

- **WHEN** the installed investigate `SKILL.md` is inspected
- **THEN** it SHALL contain no freeze, unfreeze, guard, edit-boundary set,
  edit-boundary status, or edit-boundary clear invocation
- **AND** SHALL retain its feedback-loop, root-cause, regression, and
  risk-proportional verification gates

