## ADDED Requirements

### Requirement: Shell-completion marker dedupe on dual-family presence
When a shell profile contains a managed block under more than one recognized marker family at once (the current `RASEN` pair and the legacy `OPENSPEC` pair), the bash, zsh, and PowerShell completion installers SHALL NOT leave any block orphaned. Reconfigure SHALL converge the profile to exactly one managed block; uninstall SHALL remove every managed block regardless of family.

#### Scenario: Reconfigure deduplicates a profile with both marker families present
- **WHEN** the bash, zsh, or PowerShell completion installer configures a shell profile that contains a managed block under both the current `RASEN` marker pair and a legacy `OPENSPEC` marker pair
- **THEN** the profile ends up with exactly one managed block, using the current `RASEN` marker pair and freshly generated content
- **AND** no `OPENSPEC`-marked block remains in the profile

#### Scenario: Uninstall removes every managed block when both marker families are present
- **WHEN** a user uninstalls shell completions
- **AND** the shell profile contains managed blocks under both the current `RASEN` marker pair and a legacy `OPENSPEC` marker pair
- **THEN** the installer removes both blocks
- **AND** the profile ends up with no managed block under either marker family
