# quality-rules-injection Specification

## Purpose
Read quality rules from project config and inject them additively into generated instructions in a defined order while preserving existing content.

## Requirements
### Requirement: Read Quality Rules from Project Config
instruction-loader SHALL read `quality-rules` array from project config.

#### Scenario: Quality rules present in config
- **WHEN** project config contains `quality-rules: ["Always validate inputs", "Handle error boundaries"]`
- **THEN** the instruction-loader reads and stores both rules for injection

#### Scenario: Quality rules absent from config
- **WHEN** project config does not contain a `quality-rules` key
- **THEN** the instruction-loader proceeds without quality rules

#### Scenario: Quality rules is empty array
- **WHEN** project config contains `quality-rules: []`
- **THEN** the instruction-loader treats it the same as absent (no injection)

### Requirement: Quality Rules Injection into Instructions
When quality-rules exist, they SHALL be injected into all artifact instructions wrapped in `<quality-rules>` tags, with each rule as a bullet point.

#### Scenario: Quality rules injected into artifact instructions
- **WHEN** instructions are generated for any artifact and quality-rules contains `["Always validate inputs", "Handle error boundaries"]`
- **THEN** the output includes a `<quality-rules>` section with each rule as a bullet point

#### Scenario: No quality-rules section when rules are empty
- **WHEN** instructions are generated and quality-rules is empty or undefined
- **THEN** the output does not contain a `<quality-rules>` section

### Requirement: Injection Order
Injection order SHALL be: context, then rules, then quality-rules, then template.

#### Scenario: Quality rules appear after rules and before template
- **WHEN** instructions are generated with context, rules, quality-rules, and a template all present
- **THEN** the `<quality-rules>` section appears after the rules section and before the template section

### Requirement: Content Preservation
quality-rules content SHALL be preserved exactly as stored with no modification or escaping.

#### Scenario: Rules with special characters preserved
- **WHEN** a quality rule contains `"Use <strong> tags for emphasis"` (with angle brackets)
- **THEN** the injected rule text reads exactly `Use <strong> tags for emphasis` without escaping

#### Scenario: Rules with markdown preserved
- **WHEN** a quality rule contains `"Ensure **bold** formatting works"`
- **THEN** the injected rule text reads exactly `Ensure **bold** formatting works`

### Requirement: Additive Behavior
quality-rules SHALL be additive to existing context and rules, never replacing them.

#### Scenario: Quality rules added alongside existing rules
- **WHEN** an artifact has its own rules section and quality-rules also exist in config
- **THEN** both the artifact's rules and the quality-rules appear in the output

#### Scenario: Quality rules do not remove existing context
- **WHEN** instructions include context, rules, and quality-rules
- **THEN** all three sections are present in the final output

