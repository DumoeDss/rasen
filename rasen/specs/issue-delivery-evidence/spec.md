# issue-delivery-evidence Specification

## Purpose
This capability rolls each Change node's delivery evidence up to the Issue read surface — which commit shipped the code, the planning branch in the record's own spelling, when it archived, which evidence files the archive froze, and which verification artifacts were recorded missing — derived on read from the committed archive record of the Change instance the node names, through the same projection seam the outcome basis already reads. The derivation writes nothing: no delivery value lands in an Issue record, plan revision, archive record, run-state, or workspace index, the block is display-only beside the outcome facts, and reading the same Issue over unchanged evidence yields the same facts. The fact vocabulary is closed, every fact the record's own spelling mapped per record basis, and absent evidence is a named absence from a closed vocabulary — `record`, `no-record`, `not-archived` — never a guessed or defaulted value.

## Requirements
### Requirement: Delivery facts derive from the committed archive record

Rasen SHALL derive, for each Change node of an Issue's latest readable plan revision, that
node's delivery evidence on read from the committed archive record of the Change instance the
node names — the same blob the outcome basis already reads — and SHALL persist it nowhere:
no delivery value SHALL be written into an Issue record, a plan revision, an archive record,
a Change's run-state, or the workspace index by the derivation or by the Issue read surface.
Reading the same Issue over unchanged evidence SHALL yield the same delivery facts. The fact
vocabulary is closed and every fact is the record's own spelling, mapped per record basis:
when the archive happened (`archivedAt`); the code commit that shipped the work — a v1
ledger's `codeCommit`, or a v2 record's `codeMerge` `commit`, null when the record carries
none and named as the record's own absence rather than defaulted; the planning-branch fact —
a v1 ledger's `planningBranch`, or a v2 record's `planning.sourceRef`, verbatim in each
case; the outcome where the record basis carries one, with a legacy record's absent outcome
reported as the absence it is, never filled; the evidence inventory the record froze, each
entry carrying its store-relative path and its recorded digest; and the missing-evidence
names the record recorded. A v1 ledger field that is absent or not of its expected shape
reads as its named absence, never repaired. Every delivery fact is a display fact: no
phase, health, progress, gate, or readiness value SHALL be derived from it.

#### Scenario: A v1 ledger's delivery facts read back verbatim

- **WHEN** a required node's Change is archived under a v1 ledger carrying `codeCommit`,
  `planningBranch`, `archivedAt`, a seven-file evidence inventory, and one missing-evidence
  name
- **THEN** the node's delivery facts report that commit, that branch, that date, all seven
  inventory entries with their digests, and that missing name
- **AND** no fact outside the record's own fields is presented

#### Scenario: A v2 record maps its code-merge and planning facts

- **WHEN** a node's Change is archived under a valid v2 record whose outcome is `landed`
  with implementation `code`
- **THEN** the delivery facts report the `codeMerge` commit as the code commit and the
  `planning.sourceRef` as the planning-branch fact, each verbatim
- **AND** the v2 outcome reports beside them

#### Scenario: A record with no code merge names its own absence

- **WHEN** a node's Change is archived under a v2 record whose outcome is `landed` with
  implementation `none`, or a passive outcome that carries no code merge
- **THEN** the code-commit fact reads as the absence the record itself records
- **AND** no commit value is inferred from any other source

#### Scenario: A legacy record's absent outcome stays absent

- **WHEN** a node's delivery facts derive from a legacy-basis record that predates v2
  outcome records
- **THEN** the outcome fact reports that no outcome was recorded on that record basis
- **AND** no outcome value is invented to fill it

#### Scenario: The derivation writes nothing

- **WHEN** an Issue's status and delivery facts are read
- **THEN** the Issue record, every plan revision, every archive record, every run-state
  file, and the workspace index are byte-identical before and after the read

### Requirement: Absent evidence is a named absence, never a guess

The delivery evidence SHALL report, for every Change node of the readable revision, exactly
one of a closed vocabulary of named states: `record`, an archived Change whose ledger or v2
record was read; `no-record`, an archived entry that carries no archive record at all — the
pre-record relocation shape — with the absence of the record itself named; `not-archived`,
a Change instance with committed evidence but no archive entry, whose delivery evidence is
named as not yet existing rather than as failure or as empty facts; `unreadable`, an archive
record in v2 shape that fails validation, where the standing `invalid-archive-record`
problem remains the authoritative naming and no delivery fact is derived from the damaged
bytes; and `unattributed`, a node whose reference is unresolved or ambiguous, where no
instance exists to read delivery facts from and the reference problem already reported is
the answer. An intent node carries no delivery evidence by construction. The rollup SHALL
name what the Store cannot know: no structured pull-request fact exists in either record
shape, so the answer SHALL NOT present one — the ship-log SHALL surface as an inventory
fact, its store-relative path and frozen digest from the evidence inventory, presence or
absence named, and document prose SHALL NOT be parsed into delivery facts.

#### Scenario: A run-terminal node not yet archived reads as named absence

- **WHEN** a Change node's work observes run-terminal through located run-state while its
  Change instance has no committed archive entry
- **THEN** the node's delivery evidence reads `not-archived`, named as evidence that will
  exist when the Change archives
- **AND** no delivery fact is fabricated from the run-state or the working tree

#### Scenario: An archived entry without a record names the record's absence

- **WHEN** a node's Change is archived and the entry carries no `archive.json`
- **THEN** the node's delivery evidence reads `no-record`, naming that the entry has no
  archive record to read
- **AND** no delivery fact is presented for it

#### Scenario: An unreadable record derives no delivery facts

- **WHEN** a node's Change is archived under bytes in v2 shape that fail validation
- **THEN** the node's delivery evidence reads `unreadable`
- **AND** the standing invalid-archive-record problem names the file and the reason, with
  no delivery fact derived from the damaged bytes

#### Scenario: The ship-log surfaces as an inventory fact, not parsed prose

- **WHEN** a node's archived record freezes an evidence inventory containing the ship-log
  with its digest
- **THEN** the delivery evidence carries the ship-log's store-relative path and recorded
  digest as an inventory fact
- **AND** no fact is extracted from the document's prose, and where the inventory carries
  no ship-log the absence is named

#### Scenario: No pull-request fact is presented

- **WHEN** a ship-log's prose names a pull request and the delivery evidence is derived
- **THEN** the answer presents no pull-request fact, because neither record shape records
  one
- **AND** the store names that no structured pull-request fact exists, pointing at the
  ship-log inventory entry where delivery prose lives

### Requirement: The rollup aggregates through the projection's own facts

The Issue-level delivery rollup SHALL derive as a pure post-pass over the status
projection's own facts — the per-node delivery facts the projection carries — consuming
nothing else, so the rollup, the node lines, and the attribution on the same read can never
disagree. The rollup SHALL carry one entry per Change node of the readable revision, in the
revision's canonical node order, each entry naming its node, alias, target project,
lifecycle, observed execution state, and delivery evidence; and it SHALL carry honest
counts over the named states — counts that summarize while every entry remains listed in
full. An Issue whose latest revision did not read back SHALL report no rollup rather than
an empty one: "no readable plan" and "no delivery evidence" are different truths. The
rollup SHALL drive no phase, health, progress, gate, or readiness value, and deriving it
twice over unchanged evidence SHALL yield the identical answer.

#### Scenario: Every Change node has exactly one entry

- **WHEN** an Issue's readable revision names three archived Change nodes, one not-started
  Change node, and one intent node
- **THEN** the rollup carries four entries in canonical node order, one per Change node,
  each with its named delivery state
- **AND** the intent node contributes no entry

#### Scenario: Counts summarize without replacing

- **WHEN** a rollup derives over entries in several named states
- **THEN** the counts name how many entries stand in each state
- **AND** every entry remains listed in full with its facts

#### Scenario: An unreadable revision reports no rollup

- **WHEN** an Issue's latest revision exists but fails its digest or parse
- **THEN** no rollup is reported
- **AND** the reason is reported with the status, as the projection's no-progress rule
  already reports it

#### Scenario: The rollup drives no axis

- **WHEN** the same revision is read before and after the delivery facts and rollup began
  being derived
- **THEN** its phase, health, progress, lanes, gate evaluation, and readiness equal the
  values derived before
- **AND** a node's delivery state influences no value the projection already determines

### Requirement: The Issue read surface shows the delivery evidence

`rasen store issue show` SHALL report the delivery evidence beside the status and
acceptance sections: one row per Change node carrying the node's identity, its target
project, its observed execution state, and its delivery facts — the archive date, code
commit, planning-branch fact, outcome with its basis, the evidence inventory with the
ship-log's presence named, and the recorded missing names — with every named-absence state
rendered as the named state it is. The `--json` form SHALL carry the same facts the human
form carries: the rollup and the per-node delivery facts on the status nodes. `rasen store
issue list` SHALL NOT report delivery evidence — the listing stays compact and the rollup
is the show surface's answer. The command SHALL write nothing.

#### Scenario: An archived node's row carries its delivery facts

- **WHEN** an Issue with one archived Change node is shown in human form
- **THEN** the delivery section renders that node's row with its archive date, code
  commit, planning branch, outcome basis, evidence count with the ship-log named, and
  missing names
- **AND** the `--json` form carries the same facts under the rollup and the node's status
  entry

#### Scenario: A not-archived node's row names its absence

- **WHEN** the same Issue's plan also names a Change node whose instance is not archived
- **THEN** that node's row reads the named `not-archived` state
- **AND** no delivery facts are rendered for it

#### Scenario: The listing stays compact

- **WHEN** Issues with derived delivery evidence are listed
- **THEN** the listing's lines carry no delivery facts
- **AND** the show surface remains the delivery answer

#### Scenario: Showing writes nothing

- **WHEN** `rasen store issue show` runs to completion with the delivery section rendered
- **THEN** every Issue record, plan revision, archive record, run-state file, and the
  workspace index are byte-identical before and after
