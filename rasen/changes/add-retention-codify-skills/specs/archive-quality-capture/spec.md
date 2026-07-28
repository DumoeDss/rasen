## ADDED Requirements

### Requirement: Archive Preserves Project Quality Rules
The archive process SHALL preserve the project's `quality-rules` configuration exactly as it existed before archive, including when quality artifacts contain `[RULE]` markers. Existing `quality-rules` SHALL remain available to the normal instruction-injection path after the change is archived.

#### Scenario: Existing quality rules remain unchanged
- **WHEN** archive processes a change whose quality artifacts contain `[RULE]` markers and the project already has `quality-rules`
- **THEN** archive leaves every existing `quality-rules` entry unchanged
- **AND** those entries continue to participate in normal instruction injection

#### Scenario: Archive does not create quality rules
- **WHEN** archive processes `[RULE]` markers for a project that has no `quality-rules` key
- **THEN** archive does not create a `quality-rules` key
- **AND** quality artifact scanning, summary extraction, quality metadata, and normal archiving continue

## REMOVED Requirements

### Requirement: Reusable Pattern Extraction
**Reason**: Archive is no longer a codification step and no longer interprets `[RULE]` markers as reusable guidance. Quality artifacts remain inputs to quality summary extraction only.
**Migration**: Use the `codify` mode of `rasen-retain` to evaluate evidence and manage learned skills. Existing `quality-rules` require no migration and remain available to normal instruction injection.

#### Scenario: Rule markers remain ordinary archive content
- **WHEN** a quality artifact contains one or more lines prefixed with `[RULE]`
- **THEN** archive does not extract reusable patterns from those lines
- **AND** archive continues to scan the artifact and extract its supported quality summary fields

### Requirement: Rules Appended to Config
**Reason**: Because archive no longer extracts reusable patterns, it no longer appends generated entries to project `quality-rules`.
**Migration**: Existing `quality-rules` remain unchanged and continue normal injection. New evidence-derived guidance is handled by the `codify` mode of `rasen-retain` as managed learned skills rather than as archive-generated config entries.

#### Scenario: Archive leaves project configuration untouched
- **WHEN** archive processes a change with `[RULE]` markers and the project has existing `quality-rules`
- **THEN** archive does not add, remove, reorder, or deduplicate `quality-rules`

### Requirement: Archive Summary Output
**Reason**: Archive no longer extracts quality rules, so an extracted-rule count is no longer meaningful archive summary information.
**Migration**: Continue using the archive quality summary for findings, test results, and other supported quality metadata; there is no replacement extracted-rule count.

#### Scenario: Archive summary omits extracted-rule counts
- **WHEN** archive completes after processing quality artifacts with or without `[RULE]` markers
- **THEN** the archive summary does not report a count of extracted quality rules
