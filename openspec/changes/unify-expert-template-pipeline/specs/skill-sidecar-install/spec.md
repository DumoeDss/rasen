## MODIFIED Requirements

### Requirement: Sidecar reference files installed alongside SKILL.md

`openspec init` and `openspec update` SHALL, for each installed expert skill, copy the skill's sidecar reference files from the packaged source skill directory (`skills/experts/<workflowId>/`) into the installed skill directory, preserving relative subdirectory structure, after writing `SKILL.md`. This SHALL be a single shared helper called by both commands.

#### Scenario: Reference sidecars land on init

- **WHEN** `openspec init` installs the Claude Code skills from a checkout
- **THEN** `.claude/skills/openspec-review/checklist.md` SHALL exist
- **AND** `.claude/skills/openspec-investigate/scripts/hitl-loop.template.sh` SHALL exist
- **AND** `.claude/skills/openspec-qa/references/issue-taxonomy.md` and `.../templates/qa-report-template.md` SHALL exist

#### Scenario: Update installs sidecars too

- **WHEN** `openspec update` refreshes the installed skills
- **THEN** it SHALL copy the same sidecars via the shared helper

### Requirement: Copy allowlist excludes code and the browse package

The sidecar copy SHALL include only files ending `.md` (excluding `SKILL.md`) and `.sh`, found recursively under the source skill directory, and SHALL exclude `*.tmpl`. It SHALL skip the `browse` skill directory entirely.

#### Scenario: Code assets and templates are not copied

- **WHEN** sidecars are copied for any skill
- **THEN** no `.tmpl` file SHALL be copied
- **AND** the generated `SKILL.md` SHALL not be duplicated by the sidecar copy

#### Scenario: browse heavy assets excluded

- **WHEN** `openspec init` installs skills
- **THEN** `.claude/skills/openspec-browse/src/` SHALL NOT exist
- **AND** no `.ts` source files SHALL be copied into any installed skill directory
