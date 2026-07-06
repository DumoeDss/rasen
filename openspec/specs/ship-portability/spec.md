# ship-portability Specification

## Purpose
TBD - created by archiving change phase0a-cleanse. Update Purpose after archive.
## Requirements
### Requirement: Runtime-agnostic test execution in ship
The `ship` skill SHALL run the project's test suite using a runtime-agnostic command rather than hardcoded Rails/Vitest invocations. It SHALL reuse the detection convention already established by the Test Framework Bootstrap generator (`generateTestBootstrap`) — detect the project runtime and its test command — instead of naming `bin/test-lane`, `RAILS_ENV=test bin/rails db:migrate`, `structure.sql`, or `npm run test` directly.

#### Scenario: No Rails harness references in ship source
- **WHEN** `skills/gstack/ship/SKILL.md.tmpl` is inspected
- **THEN** it SHALL NOT contain `bin/test-lane`, `RAILS_ENV`, `bin/rails`, or `structure.sql`

#### Scenario: Ship runs the detected test command
- **WHEN** the generated `ship` skill reaches the test step
- **THEN** it SHALL instruct running the project's detected test command (the command verified by Test Framework Bootstrap)
- **AND** it SHALL NOT assume a specific language or test runner

### Requirement: Eval suites step is optional and project-declared
The `ship` skill's eval/prompt-regression step SHALL be expressed as an optional step gated on the project declaring such a suite, not as a hardcoded Rails eval runner. References to `test/evals/*_eval_runner.rb`, `EVAL_JUDGE_TIER`, `config/system_prompts/*.txt`, and `app/services/*_prompt_builder.rb` file globs SHALL be removed.

#### Scenario: No private eval-harness references in ship source
- **WHEN** `skills/gstack/ship/SKILL.md.tmpl` is inspected
- **THEN** it SHALL NOT contain `eval_runner`, `EVAL_JUDGE_TIER`, `config/system_prompts/`, or `app/services/*_prompt_builder`

#### Scenario: Eval step skips when no suite is declared
- **WHEN** the generated `ship` skill reaches the eval step
- **AND** the project has not declared a prompt/eval regression suite
- **THEN** the skill SHALL skip the eval step without error

### Requirement: Commit co-author trailer is not model-pinned
The `ship` and `document-release` skills SHALL NOT hardcode a specific model name in the `Co-Authored-By` commit trailer. The trailer SHALL either omit the model-version-specific attribution or use a non-versioned placeholder.

#### Scenario: No hardcoded model in ship trailer
- **WHEN** `skills/gstack/ship/SKILL.md.tmpl` is inspected
- **THEN** it SHALL NOT contain the string `Claude Opus 4.6`

#### Scenario: No hardcoded model in document-release trailer
- **WHEN** `skills/gstack/document-release/SKILL.md.tmpl` is inspected
- **THEN** it SHALL NOT contain the string `Claude Opus 4.6`

#### Scenario: Generated skills carry no pinned model trailer
- **WHEN** the generated `ship` and `document-release` SKILL.md files are inspected
- **THEN** neither SHALL contain a `Co-Authored-By` line naming a specific Claude model version

