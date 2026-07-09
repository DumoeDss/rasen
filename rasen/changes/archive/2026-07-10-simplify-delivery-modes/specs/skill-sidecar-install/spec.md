## MODIFIED Requirements

### Requirement: Copy is graceful and idempotent
The copy SHALL no-op without error when the source skill directory is absent, and re-running `init`/`update` SHALL overwrite sidecars in place without error.

#### Scenario: Absent source directory does not crash init
- **WHEN** the packaged source skill directory for a skill is not present at runtime
- **THEN** the install SHALL complete without throwing
- **AND** SHALL still write the skill's `SKILL.md`

#### Scenario: Idempotent re-run
- **WHEN** `rasen update` is run twice in succession
- **THEN** the second run SHALL complete without error
- **AND** the installed sidecars SHALL be identical to the first run

#### Scenario: Uninstall removes sidecars
- **WHEN** a skill directory is removed (workflow deselection — the only removal path, since no delivery setting removes skills)
- **THEN** its sidecar files SHALL be removed with the directory
