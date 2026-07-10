# cli-show Specification (delta)

## MODIFIED Requirements

### Requirement: Top-level show command

The CLI SHALL provide a top-level `show` command for displaying changes and specs with intelligent selection.

#### Scenario: Interactive show selection

- **WHEN** executing `rasen show` without arguments
- **THEN** prompt user to select type (change or spec)
- **AND** display list of available items for selected type
- **AND** show the selected item's content

#### Scenario: Non-interactive environments do not prompt

- **GIVEN** stdin is not a TTY or `--no-interactive` is provided or environment variable `OPEN_SPEC_INTERACTIVE=0`
- **WHEN** executing `rasen show` without arguments
- **THEN** do not prompt
- **AND** print a helpful hint with examples for `rasen show <item>` and `rasen show --type change|spec`
- **AND** exit with code 1

#### Scenario: Direct item display

- **WHEN** executing `rasen show <item-name>`
- **THEN** automatically detect if item is a change or spec
- **AND** display the item's content
- **AND** use appropriate formatting based on item type

#### Scenario: Type detection and ambiguity handling

- **WHEN** executing `rasen show <item-name>`
- **THEN** if `<item-name>` uniquely matches a change or a spec, show that item
- **AND** if it matches both, print an ambiguity error and suggest `--type change|spec`
- **AND** if it matches neither, print not-found with nearest-match suggestions

#### Scenario: Explicit type override

- **WHEN** executing `rasen show --type change <item>`
- **THEN** treat `<item>` as a change ID and show it (skipping auto-detection)

- **WHEN** executing `rasen show --type spec <item>`
- **THEN** treat `<item>` as a spec ID and show it (skipping auto-detection)
