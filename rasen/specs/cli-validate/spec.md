# cli-validate Specification

## Purpose
Define `rasen validate` behavior for validating changes and specs with actionable remediation guidance and structured output.

## Requirements
### Requirement: Validation SHALL provide actionable remediation steps
Validation output SHALL include specific guidance to fix each error, including expected structure, example headers, and suggested commands to verify fixes.

#### Scenario: No deltas found in change
- **WHEN** validating a change with zero parsed deltas
- **THEN** show error "No deltas found" with guidance:
  - Explain that change specs must include `## ADDED Requirements`, `## MODIFIED Requirements`, `## REMOVED Requirements`, or `## RENAMED Requirements`
  - Remind authors that files must live under `rasen/changes/{id}/specs/<capability>/spec.md`
  - Include an explicit note: "Spec delta files cannot start with titles before the operation headers"
  - Suggest running `rasen show {id} --json --deltas-only` for debugging

#### Scenario: Missing required sections
- **WHEN** a required section is missing
- **THEN** include expected header names and a minimal skeleton:
  - For Spec: `## Purpose`, `## Requirements`
  - For Change: `## Why`, `## What Changes`
  - Provide an example snippet of the missing section with placeholder prose ready to copy
  - Mention the quick-reference section in `rasen/AGENTS.md` as the authoritative template

#### Scenario: Missing requirement descriptive text
- **WHEN** a requirement header lacks descriptive text before scenarios
- **THEN** emit an error explaining that `### Requirement:` lines must be followed by narrative text before any `#### Scenario:` headers
  - Show compliant example: "### Requirement: Foo" followed by "The system SHALL ..."
  - Suggest adding 1-2 sentences describing the normative behavior prior to listing scenarios
  - Reference the pre-validation checklist in `rasen/AGENTS.md`

### Requirement: Validator SHALL detect likely misformatted scenarios and warn with a fix
The validator SHALL recognize bulleted lines that look like scenarios (e.g., lines beginning with WHEN/THEN/AND) and emit a targeted warning with a conversion example to `#### Scenario:`.

#### Scenario: Bulleted WHEN/THEN under a Requirement
- **WHEN** bullets that start with WHEN/THEN/AND are found under a requirement without any `#### Scenario:` headers
- **THEN** emit warning: "Scenarios must use '#### Scenario:' headers", and show a conversion template:
```
#### Scenario: Short name
- **WHEN** ...
- **THEN** ...
- **AND** ...
```

### Requirement: All issues SHALL include file paths and structured locations
Error, warning, and info messages SHALL include:
- Source file path (`rasen/changes/{id}/proposal.md`, `.../specs/{cap}/spec.md`)
- Structured path (e.g., `deltas[0].requirements[0].scenarios`)

#### Scenario: Zod validation error
- **WHEN** a schema validation fails
- **THEN** the message SHALL include `file`, `path`, and a remediation hint if applicable

### Requirement: Invalid results SHALL include a Next steps footer in human-readable output
The CLI SHALL append a Next steps footer when the item is invalid and not using `--json`, including:
- Summary line with counts
- Top-3 guidance bullets (contextual to the most frequent or blocking errors)
- A suggestion to re-run with `--json` and/or the debug command

#### Scenario: Change invalid summary
- **WHEN** a change validation fails
- **THEN** print "Next steps" with 2-3 targeted bullets and suggest `rasen show <id> --json --deltas-only`

### Requirement: Top-level validate command

The CLI SHALL provide a top-level `validate` command for validating changes and specs with flexible selection options.

#### Scenario: Interactive validation selection

- **WHEN** executing `rasen validate` without arguments
- **THEN** prompt user to select what to validate (all, changes, specs, or specific item)
- **AND** perform validation based on selection
- **AND** display results with appropriate formatting

#### Scenario: Non-interactive environments do not prompt

- **GIVEN** stdin is not a TTY or `--no-interactive` is provided or environment variable `OPEN_SPEC_INTERACTIVE=0`
- **WHEN** executing `rasen validate` without arguments
- **THEN** do not prompt interactively
- **AND** print a helpful hint listing available commands/flags and exit with code 1

#### Scenario: Direct item validation

- **WHEN** executing `rasen validate <item-name>`
- **THEN** automatically detect if item is a change or spec
- **AND** validate the specified item
- **AND** display validation results

### Requirement: Bulk and filtered validation

The validate command SHALL support flags for bulk validation (--all) and filtered validation by type (--changes, --specs).

#### Scenario: Validate everything

- **WHEN** executing `rasen validate --all`
- **THEN** validate all changes in rasen/changes/ (excluding archive)
- **AND** validate all specs in rasen/specs/
- **AND** display a summary showing passed/failed items
- **AND** exit with code 1 if any validation fails

#### Scenario: Scope of bulk validation

- **WHEN** validating with `--all` or `--changes`
- **THEN** include all change proposals under `rasen/changes/`
- **AND** exclude the `rasen/changes/archive/` directory

- **WHEN** validating with `--specs`
- **THEN** include all specs that have a `spec.md` under `rasen/specs/<id>/spec.md`

#### Scenario: Validate all changes

- **WHEN** executing `rasen validate --changes`
- **THEN** validate all changes in rasen/changes/ (excluding archive)
- **AND** display results for each change
- **AND** show summary statistics

#### Scenario: Validate all specs

- **WHEN** executing `rasen validate --specs`
- **THEN** validate all specs in rasen/specs/
- **AND** display results for each spec
- **AND** show summary statistics

### Requirement: Validation options and progress indication

The validate command SHALL support standard validation options (--strict, --json) and display progress during bulk operations.

#### Scenario: Strict validation

- **WHEN** executing `rasen validate --all --strict`
- **THEN** apply strict validation to all items
- **AND** treat warnings as errors
- **AND** fail if any item has warnings or errors

#### Scenario: JSON output

- **WHEN** executing `rasen validate --all --json`
- **THEN** output validation results as JSON
- **AND** include detailed issues for each item
- **AND** include summary statistics

#### Scenario: JSON output schema for bulk validation

- **WHEN** executing `rasen validate --all --json` (or `--changes` / `--specs`)
- **THEN** output a JSON object with the following shape:
  - `items`: Array of objects with fields `{ id: string, type: "change"|"spec", valid: boolean, issues: Issue[], durationMs: number }`
  - `summary`: Object `{ totals: { items: number, passed: number, failed: number }, byType: { change?: { items: number, passed: number, failed: number }, spec?: { items: number, passed: number, failed: number } } }`
  - `version`: String identifier for the schema (e.g., `"1.0"`)
- **AND** exit with code 1 if any `items[].valid === false`

Where `Issue` follows the existing per-item validation report shape `{ level: "ERROR"|"WARNING"|"INFO", path: string, message: string }`.

#### Scenario: Show validation progress

- **WHEN** validating multiple items (--all, --changes, or --specs)
- **THEN** show progress indicator or status updates
- **AND** indicate which item is currently being validated
- **AND** display running count of passed/failed items

#### Scenario: Concurrency limits for performance

- **WHEN** validating multiple items
- **THEN** run validations with a bounded concurrency (e.g., 4–8 in parallel)
- **AND** ensure progress indicators remain responsive

### Requirement: Item type detection and ambiguity handling

The validate command SHALL handle ambiguous names and explicit type overrides to ensure clear, deterministic behavior.

#### Scenario: Direct item validation with automatic type detection

- **WHEN** executing `rasen validate <item-name>`
- **THEN** if `<item-name>` uniquely matches a change or a spec, validate that item

#### Scenario: Ambiguity between change and spec names

- **GIVEN** `<item-name>` exists both as a change and as a spec
- **WHEN** executing `rasen validate <item-name>`
- **THEN** print an ambiguity error explaining both matches
- **AND** suggest passing `--type change` or `--type spec`, or using `rasen change validate` / `rasen spec validate`
- **AND** exit with code 1 without performing validation

#### Scenario: Unknown item name

- **WHEN** the `<item-name>` matches neither a change nor a spec
- **THEN** print a not-found error
- **AND** show nearest-match suggestions when available
- **AND** exit with code 1

#### Scenario: Explicit type override

- **WHEN** executing `rasen validate --type change <item>`
- **THEN** treat `<item>` as a change ID and validate it (skipping auto-detection)

- **WHEN** executing `rasen validate --type spec <item>`
- **THEN** treat `<item>` as a spec ID and validate it (skipping auto-detection)

### Requirement: Interactivity controls

- The CLI SHALL respect `--no-interactive` to disable prompts.
- The CLI SHALL respect `OPEN_SPEC_INTERACTIVE=0` to disable prompts globally.
- Interactive prompts SHALL only be shown when stdin is a TTY and interactivity is not disabled.

#### Scenario: Disabling prompts via flags or environment

- **WHEN** `rasen validate` is executed with `--no-interactive` or with environment `OPEN_SPEC_INTERACTIVE=0`
- **THEN** the CLI SHALL not display interactive prompts
- **AND** SHALL print non-interactive hints or chosen outputs as appropriate

### Requirement: Parser SHALL handle cross-platform line endings
The markdown parser SHALL correctly identify sections regardless of line ending format (LF, CRLF, CR).

#### Scenario: Required sections parsed with CRLF line endings
- **GIVEN** a change proposal markdown saved with CRLF line endings
- **AND** the document contains `## Why` and `## What Changes`
- **WHEN** running `rasen validate <change-id>`
- **THEN** validation SHALL recognize the sections and NOT raise parsing errors

### Requirement: Validate SHALL resolve changes by directory existence, matching status

`openspec validate` SHALL resolve whether a named item is a change using the same rule `openspec status` and `openspec instructions` use — directory existence within the resolved root — rather than requiring a `proposal.md` to be present. This SHALL apply to targeted validation (`openspec validate <name>`), bulk validation (`openspec validate --all` / `--changes`), and the interactive "pick one" selector shown when no item is given in a TTY — within both the repository root and a `--store`-selected root. A resolved change with a nested multi-area spec layout SHALL have its deltas discovered and validated. Spec/change ambiguity handling and `--type` overrides SHALL remain unchanged. The spec-resolution side (a spec is resolved by the presence of its `spec.md`) is correct today and SHALL be left unchanged.

#### Scenario: Scaffolded change without proposal.md

- **GIVEN** a change directory created by `openspec new change <name>` that has not yet had `proposal.md` written
- **WHEN** executing `openspec validate <name>`
- **THEN** validate resolves the change and validates it
- **AND** it SHALL NOT print `Unknown item '<name>'`

#### Scenario: Targeted-resolution parity with status

- **GIVEN** any change that `openspec status --change <name>` resolves, including a change in a `--store`-selected root
- **WHEN** executing `openspec validate <name>` (passing the same `--store` when applicable)
- **THEN** validate SHALL resolve the same change that status resolved, and SHALL NOT report it as unknown

#### Scenario: Bulk validation includes a sole proposal-less change

- **GIVEN** a repository whose only active change lacks `proposal.md` and is listed by `openspec status`
- **WHEN** executing `openspec validate --all` (or `--changes`)
- **THEN** validate SHALL validate that change, and SHALL NOT print "No items found to validate"
- **AND** the exit status SHALL reflect the change's validity

#### Scenario: Interactive selector lists proposal-less changes

- **GIVEN** a TTY and a change directory without `proposal.md` that `openspec status` lists
- **WHEN** executing `openspec validate` with no item name
- **THEN** the interactive "pick one" selector SHALL include that change

#### Scenario: Resolved-but-invalid change exits non-zero

- **GIVEN** a change that resolves by directory existence but fails validation
- **WHEN** executing `openspec validate <name>` or `openspec validate --all`
- **THEN** validate SHALL exit with a non-zero status
- **AND** SHALL NOT exit 0 while reporting the change as having issues

#### Scenario: Nested multi-area delta discovery

- **GIVEN** a resolved change whose deltas live at `specs/<area>/<capability>/spec.md` (nested deeper than one directory)
- **WHEN** validating that change
- **THEN** validate SHALL discover and validate those delta specs
- **AND** SHALL NOT report "No delta sections found" for a change that does contain deltas

#### Scenario: Change/spec ambiguity is preserved

- **GIVEN** a name that exists both as a change directory and as a spec
- **WHEN** executing `openspec validate <name>`
- **THEN** validate SHALL print the ambiguity error and respect `--type change` / `--type spec`, exactly as before

#### Scenario: Changes with proposal.md are unaffected

- **GIVEN** a change that already contains `proposal.md`
- **WHEN** validating it targeted or in bulk
- **THEN** resolution and validation behavior SHALL be byte-for-byte unchanged from today

### Requirement: SHALL/MUST body-keyword hint SHALL apply to main specs

When a requirement places the normative keyword (SHALL or MUST) only in its `### Requirement:` header and omits it from the requirement body line, `openspec validate` SHALL emit the same targeted remediation guidance for main specs under `openspec/specs/**` as it already does for change delta specs, instead of the generic "must contain SHALL or MUST" message. The targeted message SHALL be emitted exactly once for such a requirement, the generic `REQUIREMENT_NO_SHALL` message SHALL no longer be emitted on the main-spec path, and the behavior SHALL be uniform across every main-spec validation surface (`openspec validate <spec>`, `--all`, JSON output, `openspec spec validate`, and rebuilt-spec validation via `validateSpecContent`). The main-spec message's actionable sentence SHALL be byte-identical to the change-delta message; only the leading prefix differs (main specs have no `ADDED`/`MODIFIED` action).

#### Scenario: Main spec with the keyword in the header only

- **GIVEN** a main spec requirement whose header contains SHALL or MUST but whose body line omits it
- **WHEN** running `openspec validate` over that spec
- **THEN** the error message SHALL contain the actionable sentence: "must contain SHALL or MUST in the requirement body, not only in the header. Move the SHALL/MUST statement to the line immediately after the \"### Requirement: ...\" header."
- **AND** SHALL NOT be the generic "Requirement must contain SHALL or MUST keyword" message

#### Scenario: Actionable-sentence parity with change deltas

- **GIVEN** the identical header-only-keyword mistake authored once in a main spec and once in a change delta
- **WHEN** validating each
- **THEN** the actionable remediation sentence SHALL be byte-identical between the two (the change-delta `ADDED`/`MODIFIED` prefix is not required for the main-spec message)

#### Scenario: Exactly one issue is emitted

- **GIVEN** a main spec requirement with the keyword in the header only
- **WHEN** validating it
- **THEN** validate SHALL emit exactly one issue for the missing body keyword
- **AND** SHALL NOT emit both the generic message and the targeted message for the same requirement

#### Scenario: Requirement missing the keyword entirely still errors

- **GIVEN** a main spec requirement that contains no SHALL or MUST in either the header or the body
- **WHEN** running `openspec validate` over that spec
- **THEN** validate SHALL report that the requirement must contain SHALL or MUST, as it does today

#### Scenario: Keyword present in the body is not flagged

- **GIVEN** a main spec requirement whose body line contains SHALL or MUST (whether or not the header also does)
- **WHEN** running `openspec validate` over that spec
- **THEN** validate SHALL NOT raise a missing-keyword error for that requirement

#### Scenario: Lowercase keyword does not satisfy the body requirement

- **GIVEN** a main spec requirement whose only "shall"/"must" is lowercase
- **WHEN** running `openspec validate` over that spec
- **THEN** validate SHALL report a missing-keyword error, matching the change-delta behavior for the same lowercase mistake

#### Scenario: Header keyword with no body line emits the hint

- **GIVEN** a main spec requirement whose header contains SHALL or MUST and that has no body line before its first scenario
- **WHEN** running `openspec validate` over that spec
- **THEN** validate SHALL emit the body-keyword hint (the keyword is only in the header)
- **AND** this case, which is reported valid today, becomes a deliberate, additive validation improvement

#### Scenario: Renamed requirements are not subject to the body-keyword hint

- **GIVEN** a change delta `## RENAMED Requirements` whose TO header contains SHALL or MUST
- **WHEN** validating that change
- **THEN** validate SHALL NOT emit the body-keyword hint for the renamed pair
- **AND** RENAMED validation behavior SHALL be byte-for-byte unchanged

