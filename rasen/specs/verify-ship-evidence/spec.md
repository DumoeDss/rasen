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

The `ship` workflow (`src/core/templates/workflows/ship.ts`) pre-flight verification check SHALL accept `verification-report.md` as verification evidence alongside `review-report.md`, `review-cycle-report.md`, and the other expert `*-report.md` files, looking in the change's work directory first and the change directory as fallback, so that running `/rasen:verify` satisfies the gate with no orphan consumer.

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

When a verify variant runs the project test/gate suite as part of verification, it SHALL record into its report a test-evidence block containing the exact command(s) executed, their result, and the content tree fingerprint (`git rev-parse HEAD^{tree}`) of the state they ran against — the same schema `review-cycle-report.md` records — so that `ship`'s evidence-based test-skip gate can honor the skip. When a verify variant does NOT run tests, it SHALL record no such block. `ship`'s evidence source list SHALL name `verification-report.md`.

#### Scenario: verify records tree-fingerprinted test evidence when it runs tests

- **WHEN** the generated `verify-enhanced` (and `verify-change` where it runs tests) output is inspected
- **THEN** it SHALL record the test command(s), their result, and the `git rev-parse HEAD^{tree}` fingerprint when tests are run
- **AND** `ship`'s test-skip evidence sources SHALL include `verification-report.md`

### Requirement: chrome-use covered by the parity golden master

The parity golden master (`test/core/templates/skill-templates-parity.test.ts`) SHALL include `getChromeUseSkillTemplate` in both the function-hash factories and the generated-skill-content factories, with corresponding `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` entries, so that PREAMBLE and other shared-block changes are verified for `chrome-use` instead of shipping unverified.

#### Scenario: chrome-use present in the parity suite

- **WHEN** `test/core/templates/skill-templates-parity.test.ts` is inspected
- **THEN** it SHALL include a `chrome-use` entry in the function-hash factories and the generated-content factories
- **AND** SHALL carry the corresponding expected-hash entries
- **AND** `npx vitest run test/core/templates/` SHALL pass with those entries
