## ADDED Requirements

### Requirement: Experts are first-class catalog units

The 21 built-in experts SHALL be members of the unified workflow catalog with `kind: 'expert'` and `source: 'built-in'`, carrying no command. Each expert SHALL carry a digest computed over its template and its sidecar directory tree, and SHALL preserve its sidecar source alias (an expert may materialize its sidecars from another expert's directory). `workflow list` SHALL present an `expert` group, shown by default alongside `task` and `driver`; `--json` SHALL expose experts with `kind: 'expert'` like any other unit. Enumerating the built-in catalog SHALL include the expert units.

#### Scenario: Experts appear in the catalog with kind expert

- **WHEN** the built-in catalog is enumerated
- **THEN** each of the 21 experts SHALL appear with `kind: 'expert'`, `source: 'built-in'`, no command, and a digest
- **AND** an expert that borrows another expert's sidecar directory SHALL retain that alias

#### Scenario: Experts listed by default

- **WHEN** a user runs `rasen workflow list` without `--all`
- **THEN** the `expert` group SHALL be shown
- **AND** `rasen workflow list --json` SHALL include experts annotated with `kind: 'expert'`

#### Scenario: Expert digest covers template and sidecars

- **WHEN** an expert's template or a sidecar file changes
- **THEN** its digest SHALL change
- **AND** two experts sharing one sidecar directory SHALL have distinct digests

### Requirement: Expert installation is unchanged in this round

Migrating experts into the catalog SHALL NOT change which experts are installed: every built-in expert SHALL continue to be installed as it is today, independent of the selected workflow profile. (The shift to profile-default plus dependency-closure installation is a separate change.)

#### Scenario: All experts still installed after migration

- **WHEN** `rasen init` or `rasen update` runs after the migration
- **THEN** every built-in expert SHALL be installed, exactly as before the migration

### Requirement: Delete guard protects skills referenced by requires.skills

The workflow delete refcount guard SHALL additionally refuse to delete a unit whose skill is referenced by any installed workflow's `requires.skills` (in addition to `requires.workflows` and pipeline stage skill references), naming the referrers. Built-in units, including experts, SHALL remain non-deletable regardless of any flag.

#### Scenario: Skill referenced by requires.skills is protected

- **WHEN** a unit's skill is named in another workflow's `requires.skills`
- **AND** a user attempts to delete that unit without `--force`
- **THEN** the deletion SHALL be refused, naming the referrers

#### Scenario: Built-in expert cannot be deleted

- **WHEN** a user attempts to delete a built-in expert, even with `--force`
- **THEN** the deletion SHALL be refused because built-in units cannot be deleted
