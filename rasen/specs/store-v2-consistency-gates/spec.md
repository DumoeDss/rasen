# store-v2-consistency-gates Specification

## Purpose
Read-only consistency diagnosis that detects when manual Git operations have placed a
Change, Archive entry, or canonical spec on a Store ref that contradicts the recorded
target-line and project facts. Reports mismatches without repairing — the design forbids
automatic merge, rebase, or history rewrite.
## Requirements
### Requirement: One diagnostic surface reports Store planning-layout health

Every command that reports a Store's health SHALL report the same planning-layout findings. `rasen doctor` and `rasen store doctor` SHALL compose their layout findings from one read-only diagnosis, so the two can never disagree about whether a Store's layout is healthy. The diagnosis SHALL remain read-only: it SHALL create, move, delete, and rewrite nothing, contact no network, and repair nothing, and every finding SHALL carry a stable code, name the affected ref, file, project, or item, and carry a copy-pasteable repair.

A Store whose planning layout cannot be diagnosed SHALL be reported as undiagnosed with the reason, and SHALL NOT be reported as healthy.

#### Scenario: Both doctors report the same layout findings

- **WHEN** a Store carries flat refs, mixed residue, an unfinished migration, an orphaned partition, a legacy membership record, or a relocated legacy Archive record
- **THEN** `rasen doctor` and `rasen store doctor` SHALL both report that finding with the same code and the same repair
- **AND** neither SHALL report a finding the other omits

#### Scenario: Layout diagnosis writes nothing

- **WHEN** either doctor runs against a Store in any layout state, including a partially migrated one
- **THEN** the Store's files, the project's files, and the machine registries SHALL all be left byte-identical

#### Scenario: An undiagnosable Store is not a healthy one

- **WHEN** the layout diagnosis cannot complete for a Store
- **THEN** the report SHALL state that the layout was not diagnosed and why
- **AND** it SHALL NOT present that Store's layout as healthy

### Requirement: Doctor cross-checks committed planning facts against the target-line catalogs

Git can bypass Rasen entirely, so a Change, an Archive entry, or a canonical spec can reach a Store ref without any Rasen operation having placed it there. Doctor SHALL detect and report the resulting inconsistencies without rewriting history, moving an entry, replaying a spec delta, or merging anything.

Doctor SHALL report, for the Store refs it can read: an Archive entry whose recorded target line disagrees with the target-line partition that holds it; an Archive entry or active Change whose recorded project disagrees with the project partition that holds it; a Change or Archive entry naming a target line the Store's target-line catalogs do not declare; and a target-line catalog whose declared Store ref does not resolve. A finding SHALL name both disagreeing values rather than choosing one.

An inconsistency SHALL be reported and never repaired: doctor SHALL NOT synthesize an outcome, a target line, a project owner, or a workspace pair that the committed evidence does not already prove.

#### Scenario: An entry merged onto the wrong target line is reported

- **WHEN** an Archive entry recorded for one target line is present under another target line's Archive partition
- **THEN** doctor SHALL report the disagreement naming the recorded line and the holding line
- **AND** it SHALL neither move the entry nor apply any spec action from it

#### Scenario: An entry in the wrong project partition is reported

- **WHEN** a Change or Archive entry whose committed identity names project A is present under project B's partition
- **THEN** doctor SHALL report the disagreement naming both projects
- **AND** it SHALL NOT rewrite the entry's identity to match its location

#### Scenario: An undeclared target line is reported

- **WHEN** a Change or Archive entry names a target line for which the Store has no target-line catalog
- **THEN** doctor SHALL report the entry and the missing catalog
- **AND** it SHALL NOT create the catalog

#### Scenario: Consistency findings never replay a delta

- **WHEN** doctor reports any inconsistency, including one involving a non-landed Archive entry
- **THEN** every canonical spec under every project partition SHALL be byte-identical afterwards

### Requirement: A source census bounds every reader of a layout-versioned Store record

A file whose schema depends on the Store's declared layout version SHALL be read through the layout-dispatching accessor for that file. Reading such a file with a single-version parser is a read narrowing: against the other layout it reports healthy data as broken, or absent data as present.

The repository SHALL carry a census, enforced as a test, that bounds by file and by count every direct use of a single-layout parser for a layout-versioned Store record, and classifies each entry as the dispatcher itself, a frozen legacy adapter, or a migration-source reader. A new unclassified use SHALL fail the census.

The census SHALL be extended by enumerating each new entry individually with its classification. It SHALL NOT be relaxed into a directory exemption, a path prefix rule, or a total count, because each of those makes the census pass while destroying the per-site precision it exists for.

#### Scenario: An unclassified single-layout read fails the census

- **WHEN** a new call site reads a layout-versioned Store record with a single-layout parser
- **THEN** the census SHALL fail naming that file
- **AND** the failure SHALL persist until the site is either routed through the dispatcher or enumerated with a classification

#### Scenario: A removed call site also fails the census

- **WHEN** an enumerated call site is removed or its count changes
- **THEN** the census SHALL fail rather than silently accept the smaller set

#### Scenario: The census is enumerated, never relaxed

- **WHEN** the census is extended for new call sites
- **THEN** each site SHALL appear as its own entry with its own count and classification
- **AND** no entry SHALL be expressed as a directory exemption, a path prefix, or an aggregate total

### Requirement: Store v2 introduces no change in standalone or legacy-flat planning behavior

A project that is not bound to a Store, and a Store that still carries the legacy flat planning layout, SHALL behave exactly as they did before Store layout v2 existed. Layout v2 SHALL be reachable only through an explicit migration, and no standalone or legacy-flat operation SHALL acquire a Store-shaped requirement — no project selector, no target line, and no finalization outcome.

The equivalence SHALL be demonstrated by comparison against the pre-v2 behavior rather than asserted, and the comparison SHALL cover the planning locations each operation writes, the CLI output it produces, and the files it leaves behind.

#### Scenario: A standalone lifecycle is byte-identical

- **WHEN** a standalone project runs create, edit, validate, and archive
- **THEN** every planning location written SHALL be the pre-v2 in-project location
- **AND** no project selector, target line, or finalization outcome SHALL be required at any step

#### Scenario: A legacy flat Store keeps its read surface

- **WHEN** a Store that has not been migrated is listed, shown, or exported
- **THEN** the results SHALL be the pre-v2 results
- **AND** the refusal for a planning write SHALL name the migration as the repair rather than a project or target-line selector

#### Scenario: Layout v2 is never entered implicitly

- **WHEN** any operation runs against a standalone project or a legacy flat Store
- **THEN** no project partition, project catalog, target-line catalog, or layout-version declaration SHALL be created

