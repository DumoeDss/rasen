## MODIFIED Requirements

### Requirement: A command migrates legacy in-repo ephemera to the machine home

The CLI SHALL provide `rasen work migrate` (a new `work` command group, distinct from the brand-migration `rasen migrate`) that scans the resolved root's active change directories and its `changes/archive/**` directories for legacy process ephemera and moves them into the project's machine-home work directories. The migrate set follows the legacy ephemera enumeration: run-state files (`auto-run.json`, `portfolio-run.json`, `goal-run.json`), `verification-report.md`, `ship-log.md`, and `*-report.md` files found at the change directory's top level. The `handoff/` directory SHALL NOT be a migration candidate: `<changeRoot>/handoff/` is the terminal landing for handoff documents and relay prompts (`file-placement` capability), so moving it would reverse that landing and, through the sticky-legacy series rule, pin the change's future handoff documents to the machine home. The command SHALL report a `handoff/` directory it finds and leave every file under it in place. Review material (proposal, design, tasks, delta specs, research), knowledge documents, `retro.md`, and `.openspec.yaml` SHALL never be moved. Report-like files outside the set and the possibility of custom run-artifact names SHALL be reported, not moved. The command SHALL support `--change <name>` scoping and construct all paths with the platform path module. Machine-home identity SHALL be minted (when needed) only at the point an actual move executes — never during a preview — erroring with init guidance when minting cannot succeed on an execute call.

#### Scenario: Untracked run-state noise disappears in one run

- **WHEN** `rasen work migrate` executes in a repo with untracked `auto-run.json`/`portfolio-run.json` files under active and archived change directories
- **THEN** those files SHALL be moved to the corresponding machine-home work directories
- **AND** `git status` SHALL no longer show them

#### Scenario: Review material is never a candidate

- **WHEN** the migration scans a change directory containing `proposal.md`, `design.md`, `tasks.md`, `specs/`, and `retro.md`
- **THEN** none of those SHALL appear in the migration plan

#### Scenario: Scoped migration

- **WHEN** `rasen work migrate --change <name>` runs
- **THEN** only that change's (or that archived directory's) ephemera SHALL be considered

#### Scenario: Terminal handoff directory is never migrated

- **WHEN** the migration scans or executes against a change directory containing a `handoff/` directory
- **THEN** no file under `handoff/` SHALL appear in the migration plan or be moved
- **AND** the run SHALL report that the directory was left in place as the terminal handoff landing
- **AND** no machine-home `handoff/` directory SHALL be created for that change by this command
