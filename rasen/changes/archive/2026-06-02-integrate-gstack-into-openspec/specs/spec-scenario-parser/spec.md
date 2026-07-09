# spec-scenario-parser Specification

## Purpose
Parse spec scenarios (WHEN/THEN format) into structured TestPlan data for consumption by QA provider artifacts.

## ADDED Requirements

### Requirement: TestPlan Export
The system SHALL export a `parseTestPlan(specContent: string): TestPlan` function.

#### Scenario: Parse single spec content into TestPlan
- **WHEN** `parseTestPlan(specContent)` is called with valid spec markdown
- **THEN** it returns a TestPlan object containing an array of test cases

#### Scenario: Parse empty spec content
- **WHEN** `parseTestPlan("")` is called with empty string
- **THEN** it returns a TestPlan with an empty test cases array

### Requirement: TestPlan Structure
TestPlan SHALL contain an array of test cases, each with: name (string), preconditions (string[], from GIVEN lines), actions (string[], from WHEN lines), expectations (string[], from THEN/AND lines).

#### Scenario: Test case with all fields populated
- **GIVEN** spec content contains a scenario with GIVEN, WHEN, THEN, and AND lines
- **WHEN** `parseTestPlan` is called
- **THEN** the resulting test case has `name` from the scenario title, `preconditions` from GIVEN lines, `actions` from WHEN lines, and `expectations` from THEN and AND lines

#### Scenario: Test case without GIVEN lines
- **GIVEN** spec content contains a scenario with only WHEN and THEN lines
- **WHEN** `parseTestPlan` is called
- **THEN** the resulting test case has an empty `preconditions` array

### Requirement: Scenario Block Extraction
The parser SHALL extract scenarios from all `#### Scenario:` blocks in the spec content.

#### Scenario: Multiple scenarios extracted
- **GIVEN** spec content contains three `#### Scenario:` blocks
- **WHEN** `parseTestPlan` is called
- **THEN** the TestPlan contains three test cases, one for each scenario

#### Scenario: Scenario name extracted from heading
- **GIVEN** spec content contains `#### Scenario: Valid input accepted`
- **WHEN** `parseTestPlan` is called
- **THEN** the test case name is `"Valid input accepted"`

#### Scenario: Scenarios across multiple requirements
- **GIVEN** spec content has two `### Requirement:` sections, each with two scenarios
- **WHEN** `parseTestPlan` is called
- **THEN** the TestPlan contains four test cases total

### Requirement: Handling Incomplete Scenarios
Scenarios without WHEN or THEN lines SHALL be included with empty arrays for missing fields.

#### Scenario: Scenario without THEN lines
- **GIVEN** spec content contains a scenario with WHEN lines but no THEN lines
- **WHEN** `parseTestPlan` is called
- **THEN** the test case has populated `actions` but empty `expectations`

#### Scenario: Scenario without WHEN lines
- **GIVEN** spec content contains a scenario with THEN lines but no WHEN lines
- **WHEN** `parseTestPlan` is called
- **THEN** the test case has empty `actions` but populated `expectations`

### Requirement: Multi-File Aggregation
The parser SHALL handle multiple spec files and aggregate scenarios across them.

#### Scenario: Aggregate scenarios from two spec files
- **WHEN** `parseTestPlan` is called with concatenated content from two spec files containing 3 and 2 scenarios respectively
- **THEN** the TestPlan contains 5 test cases total

#### Scenario: Duplicate scenario names across files
- **WHEN** two spec files each contain a scenario named "Valid input accepted"
- **THEN** both test cases are included in the TestPlan (no deduplication)

### Requirement: Integration with Context-From
When `context-from` references a specs artifact, the instruction-loader SHALL use this parser to extract a TestPlan and inject it as the structured context.

#### Scenario: Specs artifact parsed into TestPlan for context injection
- **GIVEN** artifact "review" has `context-from: "specs"` and the "specs" artifact output contains spec scenarios
- **WHEN** instruction-loader generates instructions for "review"
- **THEN** the `<structured-context>` section contains the TestPlan data extracted by the parser

#### Scenario: Non-spec artifact uses raw content for context
- **GIVEN** artifact "impl" has `context-from: "proposal"` and "proposal" is not a specs artifact
- **WHEN** instruction-loader generates instructions for "impl"
- **THEN** the `<structured-context>` section contains the raw content of the proposal (parser not invoked)
