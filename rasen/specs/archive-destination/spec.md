# archive-destination Specification

## Purpose
Define the `archive.destination` config axis (`in-repo` default, `external`, or `prune`) that decides WHERE archive's directory bookkeeping lands — the repo's own archive folder, the project's machine-home archive, or nowhere (git history as the archive). Covers destructive-destination safety preconditions (delivery-complete, clean-and-tracked git state), the prune confirmation as a consent separate from any other override in the flow, the prune tombstone that lets a later archive invocation recognize a pruned change once its directory is gone, union-of-locations discovery for readers, and the machine-home archive's lifecycle tie to project registration.

## Requirements
### Requirement: Archive destination is a config axis with in-repo as the default

The project config's `archive` block SHALL support a `destination` field accepting exactly `in-repo`, `external`, or `prune`; when absent or invalid the resolved destination SHALL be `in-repo`, preserving today's behavior byte-for-byte. The axis decides only where directory bookkeeping lands — `in-repo`: the planning root's archive directory (`<changesDir>/archive/`); `external`: the project's machine-home archive (`<home>/archive/`, the location frozen by the `project-registry` capability); `prune`: the change directory is deleted and git history is the archive. Spec sync is identical under every destination. Every bookkeeping actor (the archive CLI command, the archive skill, bulk archive, and ship's in-ship step) SHALL resolve the destination through one shared rule and behave identically for a given value. All paths SHALL be built with the platform path module (Windows and POSIX).

#### Scenario: Default is in-repo

- **WHEN** the config has no `archive.destination`
- **THEN** archiving SHALL move the change to the in-repo archive directory exactly as before this axis existed

#### Scenario: External lands in the machine home

- **WHEN** the resolved destination is `external` and a change is archived
- **THEN** the change directory SHALL be moved to the project's machine-home archive location
- **AND** the repository SHALL be left without a copy of the change directory (the removal is part of the archive)

#### Scenario: Prune deletes with git history as the archive

- **WHEN** the resolved destination is `prune` and a change is archived
- **THEN** the change directory SHALL be deleted after the safety preconditions pass
- **AND** no archive copy SHALL be created anywhere

### Requirement: External destination resolves through the machine home at write time

Resolving the `external` archive location SHALL use the machine-home resolver (probe first; establish identity only when actually archiving), never re-derive home paths. When `external` is configured but no location can be resolved on a surface that cannot establish identity (e.g. a read-only payload for an unregistered project), consumers SHALL fall back to an in-repo move accompanied by an explicit note — a destination fallback MAY relocate but SHALL NEVER escalate to deletion.

#### Scenario: Archive write ensures the home

- **WHEN** the archive CLI command runs with destination `external` in a project not yet registered
- **THEN** the project SHALL be registered (identity minted, home created) and the archive SHALL land in the home archive

#### Scenario: Unresolvable external falls back to in-repo with a note

- **WHEN** the archive skill sees destination `external` but the status payload carries no resolved archive location
- **THEN** it SHALL perform an in-repo move and state explicitly that it fell back from `external`
- **AND** SHALL NOT delete anything as a result of the fallback

### Requirement: Readers see the union of archive locations; config governs writes only

Enumerating or locating archived changes SHALL consider BOTH the in-repo archive directory AND the machine-home archive whenever a home resolves, regardless of the currently configured destination, de-duplicated by archive id with the in-repo copy preferred for display. Switching the destination SHALL affect only future archives; previously archived changes SHALL remain discoverable in place with no migration. Pruned changes are represented by their recorded ship-log/git history, not by directory presence.

#### Scenario: Destination flip does not orphan existing archives

- **WHEN** a project with archives in the in-repo directory switches to `external` and archives more changes
- **THEN** archived-change enumeration (e.g. shell completion of archived ids) SHALL list both the old in-repo archives and the new external ones

#### Scenario: Already-archived detection covers all destinations

- **WHEN** archive is invoked for a change already archived to either the in-repo or the external location, or recorded as pruned/archived in its ship log
- **THEN** the invocation SHALL report the existing outcome (location or pruned state) and stop cleanly without re-gating, re-syncing, or re-moving

### Requirement: Destructive destinations require delivery-complete and committed state

Because `external` and `prune` remove the repository's copy of the change's review material, bookkeeping under either SHALL require: (1) delivery completeness per the recorded ship-log facts — for a `pr`-mode delivery under `on-merge` timing that means the merge-confirmation gate of the `archive-timing` capability has passed; and (2) the change directory pathspec SHALL be BOTH clean and tracked in git history — `git status --porcelain --ignored` for the pathspec SHALL be empty (a plain `git status --porcelain` without `--ignored` is NOT sufficient: ignored files are invisible to it, so a change directory covered by `.gitignore` would read as "clean" despite never having been committed) AND `git ls-files` for the pathspec SHALL be non-empty (the directory must actually hold committed content, not merely an absence of complaints). When the git state cannot be determined at all (no repository, git unavailable), the workflow SHALL fail closed and refuse exactly as it would for dirty or untracked content — an unverifiable state is NEVER treated as clean. Uncommitted, untracked, ignored-but-present, or unverifiable change-directory content SHALL never be destroyed; the workflow SHALL refuse and direct committing first (or, when nothing is tracked at all, direct committing the directory before it can be trusted as archived). `prune` SHALL additionally require its own confirmation naming the deletion (explicit flag/override in non-interactive contexts), SEPARATE from any other confirmation or override used earlier in the same invocation (e.g. a merge-confirmation override) — no other consent in the flow SHALL ever double as the prune confirmation. After bookkeeping, the removal SHALL be committed pathspec-scoped so the working tree ends clean; an external or prune archive commit SHALL contain only the spec sync and the change-directory removal — no archive-dir additions.

#### Scenario: Uncommitted change directory blocks destructive bookkeeping

- **WHEN** archive runs with destination `external` or `prune` and `git status --porcelain --ignored` shows uncommitted or ignored-but-present content under the change directory
- **THEN** the bookkeeping SHALL be refused with direction to commit the change directory first

#### Scenario: Gitignored change directory blocks destructive bookkeeping even though a plain porcelain check would read clean

- **WHEN** archive runs with destination `external` or `prune` and the change directory is covered by `.gitignore`, so it holds content that is untracked and invisible to a plain `git status --porcelain`
- **THEN** the bookkeeping SHALL still be refused — the check SHALL use `--ignored` and SHALL additionally require `git ls-files` for the pathspec to be non-empty, so a directory with no tracked content is never treated as safe to destroy

#### Scenario: Unverifiable git state blocks destructive bookkeeping (fail closed)

- **WHEN** archive runs with destination `external` or `prune` and the change directory's git state cannot be determined (no repository, or git unavailable)
- **THEN** the bookkeeping SHALL be refused exactly as it would for dirty content — an unverifiable state is NEVER treated as clean

#### Scenario: Prune demands a named confirmation, separate from any other consent in the flow

- **WHEN** archive runs with destination `prune`
- **THEN** the deletion SHALL proceed only after a confirmation that specifically names the prune (or an explicit non-interactive override flag dedicated to it)
- **AND** SHALL be refused outright non-interactively without that override
- **AND** no other confirmation or override used earlier in the same invocation (e.g. a merge-confirmation override for on-merge timing) SHALL be treated as satisfying this confirmation

#### Scenario: Removal is committed without archive additions

- **WHEN** an external or prune archive completes
- **THEN** the guidance SHALL produce a commit containing only the synced specs and the change-directory removal

### Requirement: Prune writes a tombstone before deleting

Because `prune` leaves no archived directory and no in-repo trace, the workflow SHALL write a `Pruned:` tombstone record to the change's work-directory ship log BEFORE deleting the change directory — this is the only mechanism by which a later archive invocation can recognize the change was pruned rather than never having existed. The tombstone SHALL use the literal token `Pruned:` (e.g. a `**Pruned:** true` line), and every bookkeeping actor that performs a `prune` (the CLI, the archive skill, bulk archive, and ship's in-ship step) SHALL write it using that same literal token, so the readers specified under "Readers see the union of archive locations" can detect it regardless of which actor performed the prune. When no work directory can be resolved for the write (the project has no machine identity and one cannot be established), the deletion SHALL still proceed — the tombstone is a best-effort recognizability aid, not a precondition for the deletion itself — but the outcome SHALL say so explicitly rather than silently omitting the tombstone.

#### Scenario: Prune tombstone is written before deletion

- **WHEN** a change is archived with destination `prune` and a work directory can be resolved
- **THEN** the change's work-directory ship log SHALL contain a `Pruned:` line before the change directory is deleted

#### Scenario: Every prune writer uses the same tombstone token

- **WHEN** a change is pruned by the CLI, the archive skill, bulk archive, or ship's in-ship step
- **THEN** each SHALL record the outcome using the identical literal `Pruned:` token, so a later archive invocation's tombstone detection recognizes the outcome regardless of which actor performed the prune

#### Scenario: Missing work directory does not block the deletion

- **WHEN** a change is archived with destination `prune` and no work directory can be resolved
- **THEN** the deletion SHALL proceed
- **AND** the outcome SHALL state explicitly that no tombstone was recorded

### Requirement: Quality capture follows the archived directory and is skipped for prune

Archive-time quality capture (scanning the archived directory's quality artifacts and stamping its metadata) SHALL run against the archived directory wherever it lands — in-repo or external — and SHALL be skipped for `prune`, where no archived directory exists; the skip SHALL be visible in the archive output rather than silent.

#### Scenario: External archive still captures quality

- **WHEN** a change with quality artifacts archives to `external`
- **THEN** quality capture SHALL stamp the external archived directory's metadata as it would in-repo

#### Scenario: Prune skips capture visibly

- **WHEN** a change archives under `prune`
- **THEN** quality capture SHALL be skipped and the output SHALL say so

### Requirement: Machine-home archives share the home's lifecycle

External archives live inside the registered project home and SHALL be protected from home garbage collection while the project's registry entry lives; when a project is unregistered and its home garbage-collected, its external archives are removed with it — machine-local archives share the machine registration's lifecycle, with git history remaining the durable record. This lifecycle SHALL be stated in the doctor/GC documentation for the machine home.

#### Scenario: GC does not touch a live project's external archives

- **WHEN** `doctor --gc` runs while the project's registry entry exists
- **THEN** the project's home — including `<home>/archive/` — SHALL NOT be deleted
