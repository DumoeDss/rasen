# skill-sidecar-install Specification

## Purpose
Ensures expert skills installed by `rasen init`/`update` carry their non-code sidecar reference files (checklists, templates, hook scripts) alongside `SKILL.md`, via a single shared copy helper that allowlists `.md`/`.sh`, excludes `.tmpl` and the `browse` skill's build assets, and is idempotent across repeated installs.
## Requirements
### Requirement: Sidecar reference files installed alongside SKILL.md

`rasen init` and `rasen update` SHALL, for each installed expert skill, copy the skill's sidecar reference files from the packaged source skill directory (`skills/experts/<workflowId>/`) into the installed skill directory, preserving relative subdirectory structure, after writing `SKILL.md`. This SHALL be a single shared helper called by both commands.

#### Scenario: Reference sidecars land on init

- **WHEN** `rasen init` installs the Claude Code skills from a checkout
- **THEN** `.claude/skills/rasen-review/checklist.md` SHALL exist
- **AND** `.claude/skills/rasen-investigate/scripts/hitl-loop.template.sh` SHALL exist
- **AND** `.claude/skills/rasen-qa/references/issue-taxonomy.md` and `.../templates/qa-report-template.md` SHALL exist

#### Scenario: Update installs sidecars too

- **WHEN** `rasen update` refreshes the installed skills
- **THEN** it SHALL copy the same sidecars via the shared helper

### Requirement: Copy allowlist excludes code and the browse package

The sidecar copy SHALL include only files ending `.md` (excluding `SKILL.md`) and `.sh`, found recursively under the source skill directory, and SHALL exclude `*.tmpl`. It SHALL skip the `browse` skill directory entirely.

#### Scenario: Code assets and templates are not copied

- **WHEN** sidecars are copied for any skill
- **THEN** no `.tmpl` file SHALL be copied
- **AND** the generated `SKILL.md` SHALL not be duplicated by the sidecar copy

#### Scenario: browse heavy assets excluded

- **WHEN** `rasen init` installs skills
- **THEN** `.claude/skills/rasen-browse/src/` SHALL NOT exist
- **AND** no `.ts` source files SHALL be copied into any installed skill directory

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

