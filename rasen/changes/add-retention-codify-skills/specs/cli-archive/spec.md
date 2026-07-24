## ADDED Requirements

### Requirement: Archive Follows Retention
In the full delivery flow, the archive command SHALL run after the active profile's retention operation has completed. Archive SHALL preserve the selected retention result as part of the change and SHALL limit itself to existing validation, spec synchronization, quality-summary capture, and archive bookkeeping rather than performing report generation or codification.

#### Scenario: Report result is archived
- **WHEN** report mode completes by writing `retro.md` before archive begins
- **THEN** archive moves `retro.md` with the rest of the change artifacts
- **AND** archive does not generate a second retrospective report

#### Scenario: Codification completes before archive
- **WHEN** codify mode is selected for a change
- **THEN** its create, update, retire, or no-accepted-lessons result completes before archive begins
- **AND** archive does not create, rewrite, retire, or materialize learned skills

## REMOVED Requirements

### Requirement: Quality Rules Auto-Generation
**Reason**: Archive is no longer a retention or codification mechanism and no longer extracts `[RULE]` markers or appends their text to project configuration.
**Migration**: Existing project `quality-rules` remain unchanged and continue normal instruction injection. Use the `codify` mode of `rasen-retain` for evidence-gated learned-skill creation, update, or retirement.

#### Scenario: Rule markers do not mutate config or archive output
- **WHEN** the archive command processes a quality artifact containing `[RULE]` markers
- **THEN** it leaves project `quality-rules` unchanged
- **AND** its archive summary does not display an extracted-quality-rules count
- **AND** supported quality metrics are still captured in archive metadata
