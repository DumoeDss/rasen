# task-detail-ui Delta

## ADDED Requirements

### Requirement: A change's task checklist renders with progressive disclosure

When the Task detail page shows a single change's task checklist, it SHALL render the checklist as a structured card rather than a flat dump of every item: a summary header stating completed/total progress with a visual progress indication, open (unchecked) items always listed, and completed items collapsed behind an explicit disclosure whenever at least one item is completed — so a fully completed change reads as a compact summary until the user expands it. Inline code spans in task text (backtick-delimited) SHALL render as code rather than as literal backticks.

#### Scenario: Completed change reads as a summary

- **WHEN** the user opens the detail page of a change whose tasks are all completed (for example an archived change with 34/34 tasks done)
- **THEN** the checklist shows the progress summary with the completed items collapsed behind a disclosure, and expanding the disclosure reveals the full item list

#### Scenario: Open items stay visible

- **WHEN** a change has both completed and open tasks
- **THEN** the open items are listed without any extra interaction while the completed items sit behind the disclosure with their count named

#### Scenario: Inline code renders as code

- **WHEN** a task item's text contains backtick-delimited spans (file paths, identifiers)
- **THEN** those spans render in code styling without the literal backtick characters

### Requirement: The sessions column actions follow the button hierarchy

The sessions column's toolbar SHALL present launching a run as the column's primary action and refreshing as a quiet secondary action, with clear spacing between them — never two identically styled buttons pressed together.

#### Scenario: Launch and refresh are visually distinct

- **WHEN** the user views the sessions column of a Task detail page
- **THEN** the launch-run action renders as the primary action, the refresh action renders as a quiet action, and the two are visibly separated
