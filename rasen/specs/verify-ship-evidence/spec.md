# verify-ship-evidence Specification

## Purpose
The verify -> ship evidence chain — verify-change persists `verification-report.md`; both verify variants emit a shared canonical verdict plus a machine-checkable status line and record fingerprinted test evidence when they run tests; ship consumes these as verification and test-skip evidence.
## Requirements
### Requirement: verify-change persists a verification report file

The `verify-change` workflow (`src/core/templates/workflows/verify-change.ts`, both the skill getter and the command getter) SHALL write its verification result to a durable file `verification-report.md` in the change's work directory (the `workDir` reported by the CLI per the `change-work-dir` capability, with the change directory as the sticky-legacy fallback), containing the summary scorecard, the canonical verdict status line, and the grouped findings. It SHALL NOT emit its result only to the conversation.

#### Scenario: plain verify leaves a discoverable report

- **WHEN** the generated `verify-change` skill and command are inspected
- **THEN** each SHALL instruct writing `verification-report.md` to the work directory (falling back to the change directory when `workDir` is unavailable or a legacy report exists there)
- **AND** the written report SHALL include the summary scorecard and the findings

### Requirement: ship pre-flight consumes the verification report file

The `ship` workflow (`src/core/templates/workflows/ship.ts`) pre-flight verification check SHALL accept `verification-report.md` as verification evidence alongside `review-report.md`, `review-cycle-report.md`, and the other expert `*-report.md` files, looking in the change's work directory first and the change directory as fallback, so that running `/rasen-verify-change` satisfies the gate with no orphan consumer.

#### Scenario: ship recognizes verify-change output as evidence

- **WHEN** the generated `ship` skill pre-flight is inspected
- **THEN** its verification-evidence list SHALL include `verification-report.md`, resolved in the work directory with change-directory fallback
- **AND** SHALL treat its presence as satisfying the verification gate

### Requirement: Both verify entry points emit one canonical verdict and a machine-checkable status line

`verify-change` and `verify-enhanced` SHALL map their findings onto the canonical Blocker/Major/Minor/Trivial severity scale defined by the `canonical-severity-vocabulary` capability (referenced, not re-declared), and SHALL each emit a single machine-checkable status line into their written report of the form `VERIFY VERDICT: <CLEAN|BLOCKED> — Blocker:<n> Major:<n> Minor:<n> Trivial:<n>`. A verdict SHALL be `CLEAN` if and only if no Blocker and no Major finding is open, matching the review-cycle termination invariant. This requirement standardizes the verdict vocabulary and the pass rule only; it does NOT define whether a `BLOCKED` verdict enforces an archive refusal.

#### Scenario: canonical verdict line present in both verify variants

- **WHEN** the generated `verify-change` and `verify-enhanced` outputs are inspected
- **THEN** each SHALL map its findings to Blocker/Major/Minor/Trivial per the referenced canonical vocabulary
- **AND** each SHALL emit a `VERIFY VERDICT:` status line with per-severity counts
- **AND** SHALL define CLEAN as no open Blocker and no open Major

### Requirement: Verify records fingerprinted test evidence consumable by ship's skip gate

When a verify variant runs project tests or gates as part of verification, it SHALL record into its report a test-evidence block containing the selected verification scope, why that scope covers the observed risk, the exact command(s) executed, their result, and the content tree fingerprint (`git rev-parse HEAD^{tree}`) of the state they ran against — the same schema `review-cycle-report.md` records — so that `ship` can compare both scope coverage and tree identity. When a verify variant does NOT run tests, it SHALL record no such block. `ship`'s evidence source list SHALL name `verification-report.md`.

#### Scenario: verify records tree-fingerprinted test evidence when it runs tests

- **WHEN** the generated `verify-enhanced` (and `verify-change` where it runs tests) output is inspected
- **THEN** it SHALL record the verification scope, scope rationale, test command(s), their result, and the `git rev-parse HEAD^{tree}` fingerprint when tests are run
- **AND** `ship`'s test-skip evidence sources SHALL include `verification-report.md`

### Requirement: chrome-use covered by the parity golden master

The parity golden master (`test/core/templates/skill-templates-parity.test.ts`) SHALL include `getChromeUseSkillTemplate` in both the function-hash factories and the generated-skill-content factories, with corresponding `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` entries, so that PREAMBLE and other shared-block changes are verified for `chrome-use` instead of shipping unverified.

#### Scenario: chrome-use present in the parity suite

- **WHEN** `test/core/templates/skill-templates-parity.test.ts` is inspected
- **THEN** it SHALL include a `chrome-use` entry in the function-hash factories and the generated-content factories
- **AND** SHALL carry the corresponding expected-hash entries
- **AND** `npx vitest run test/core/templates/` SHALL pass with those entries

### Requirement: A completion gate names the evidence that settles it

A task written as a gate on completing work SHALL state the evidence that settles
it, in terms a later reader can check. A gate SHALL NOT be written as a condition
the project is already known not to meet for reasons outside the work being
gated, because such a gate can never be honestly settled and leaves permanent
unreconciled debt behind. Where the outcome a gate depends on is produced by
someone other than the person writing it, the gate SHALL say whose result settles
it. A gate SHALL NOT be recorded as met unless the evidence it names was actually
obtained.

#### Scenario: A gate states checkable evidence

- **WHEN** a task is written as a gate on completing work
- **THEN** it SHALL name the evidence that settles it
- **AND** a later reader SHALL be able to check that evidence

#### Scenario: An unsatisfiable gate is not written

- **WHEN** a gate would depend on a condition the project is already known not to meet for reasons outside the work being gated
- **THEN** that gate SHALL NOT be written in those terms
- **AND** it SHALL instead state the outcome the work itself is responsible for

#### Scenario: A gate settled by someone else says so

- **WHEN** the result that settles a gate is produced by someone other than the person who wrote the gate
- **THEN** the gate SHALL say whose result settles it

#### Scenario: A gate is never marked met without its evidence

- **WHEN** the evidence a gate names has not been obtained
- **THEN** the gate SHALL NOT be recorded as met

### Requirement: A combined verification result accounts for every failure it observed

A verification result covering several completed pieces of work SHALL record what
was run, what passed, and what failed, and SHALL account for every failure it
observed rather than reporting only the ones it chose to explain. Each failure
SHALL be attributed to a stated cause, and an attribution placing a failure
outside the work being verified SHALL name the evidence supporting that
placement. A failure that cannot be attributed outside the work being verified
SHALL count against that work. A verification result SHALL NOT be reported as
satisfying a gate while it contains a failure it did not account for.

#### Scenario: Every observed failure is accounted for

- **WHEN** a combined verification result is recorded
- **THEN** it SHALL list every failure it observed
- **AND** each failure SHALL carry a stated cause

#### Scenario: A failure placed outside the work names its evidence

- **WHEN** a failure is attributed to a cause outside the work being verified
- **THEN** the result SHALL name the evidence supporting that attribution

#### Scenario: An unattributable failure counts against the work

- **WHEN** a failure cannot be attributed to a cause outside the work being verified
- **THEN** it SHALL count as a failure of that work
- **AND** the gate it would settle SHALL stay open

#### Scenario: An unaccounted failure cannot settle a gate

- **WHEN** a verification result contains a failure it did not account for
- **THEN** that result SHALL NOT be reported as satisfying any gate
