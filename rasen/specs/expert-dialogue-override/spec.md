# expert-dialogue-override Specification

## Purpose
Shared expert-skill dialogue rules carried in the PREAMBLE — pause the AskUserQuestion state machine and answer in prose when the user asks a question or requests discussion; scope the Completeness score to shortcut-vs-complete decisions. Applies to every expert skill that embeds the PREAMBLE.

## Requirements

### Requirement: Dialogue Override in the shared expert PREAMBLE

The shared expert PREAMBLE (`src/core/templates/experts/_shared.ts`, the `PREAMBLE` constant) SHALL carry a **Dialogue Override** section that governs every expert skill embedding the PREAMBLE. The section SHALL state that AskUserQuestion is a decision tool, not a conversation tool, and SHALL require the model to inspect the user's previous message before each AskUserQuestion call. When that message contains a question, a request to explain or discuss, or free-text that is not a clean option selection, the model SHALL pause the question flow and answer in body prose — with no lettered options, no `RECOMMENDATION`, and no `Completeness` score — and SHALL keep discussing until the user explicitly signals to proceed, then resume the original phase without skipping ahead.

The section SHALL forbid combining "answer the user's question" and "advance the phase" in a single turn. It SHALL state that a request for more dialogue ("answer me first," "let's discuss," repeated follow-up questions) is the opposite of a skip signal and SHALL NOT trigger any fast-forward or escape hatch. It SHALL restrict the Re-ground restatement to genuine long gaps and forbid repeating the template opener during continuous conversation.

#### Scenario: Dialogue Override section present in generated preamble

- **WHEN** any expert skill that embeds the PREAMBLE is regenerated and its `SKILL.md` inspected
- **THEN** the output SHALL contain a Dialogue Override section stating AskUserQuestion is a decision tool, not a conversation tool
- **AND** SHALL instruct answering in prose (no options, no RECOMMENDATION, no Completeness) when the user asks a question or requests discussion
- **AND** SHALL state that answering and advancing the phase must not be combined in one turn
- **AND** SHALL state that a request for more dialogue never triggers fast-forward

#### Scenario: Re-ground restraint in continuous conversation

- **WHEN** the Dialogue Override section is inspected
- **THEN** it SHALL restrict the Re-ground restatement to genuine long gaps
- **AND** SHALL forbid repeating the template opener during continuous back-and-forth

### Requirement: Completeness score scoped to shortcut-vs-complete decisions

The AskUserQuestion Format in the shared PREAMBLE SHALL scope the `Completeness X/10` score to decisions that weigh a shortcut against a complete implementation. It SHALL state that discussion-type or exploratory forks do NOT carry a Completeness score.

#### Scenario: Completeness scoping stated in AskUserQuestion Format

- **WHEN** the AskUserQuestion Format section of the generated preamble is inspected
- **THEN** it SHALL state that `Completeness X/10` applies only to shortcut-vs-complete-implementation decisions
- **AND** SHALL state that discussion-type forks do not attach a Completeness score

### Requirement: Golden-master parity preserved for PREAMBLE-embedding templates

Changes to the shared PREAMBLE SHALL keep the parity golden master in `test/core/templates/skill-templates-parity.test.ts` passing. The `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` entries for every affected PREAMBLE-embedding template SHALL be recomputed and updated so the parity suite passes.

#### Scenario: Parity suite passes after PREAMBLE change

- **WHEN** `pnpm vitest run test/core/templates/skill-templates-parity.test.ts` is executed after the PREAMBLE change
- **THEN** the suite SHALL pass with updated hashes for all affected PREAMBLE-embedding templates

### Requirement: AskUserQuestion Format Re-ground defers to the Dialogue Override

The AskUserQuestion Format in the shared expert PREAMBLE (`src/core/templates/experts/_shared.ts`) SHALL state that its Re-ground step (step 1: state the project, branch, and current plan/task) defers to the Dialogue Override's re-ground rule — the restatement belongs at the start of a session or after a genuine long gap, NOT on every consecutive AskUserQuestion call in a continuous back-and-forth. The Format's "for every AskUserQuestion call" framing SHALL NOT read as requiring the full project/branch/plan opener between consecutive replies.

#### Scenario: Format step 1 points to the Dialogue Override

- **WHEN** the AskUserQuestion Format section of the regenerated preamble is inspected
- **THEN** its Re-ground step SHALL state that re-grounding follows the Dialogue Override rule (session start / after a genuine gap)
- **AND** SHALL state that the full project/branch/plan opener is not repeated on every consecutive AskUserQuestion call in continuous conversation
