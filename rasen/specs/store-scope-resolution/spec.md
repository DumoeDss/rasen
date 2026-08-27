# store-scope-resolution Specification

## Purpose
Define how a scoped command resolves its Store, project and target-line facts —
from explicit selectors, frozen session context, execution association, the
planning-worktree marker, project binding, and the store registry — and how those
facts merge fail-closed rather than by guessing.

Three rules carry most of the weight. A Store checkout is an aggregate, not a
project, so its root config contributes no project-binding projectId fact; a git
worktree of a registered Store repository IS that Store, matched by repository
identity rather than canonical path equality; and the planning-bound gate is
satisfiable by evidence the official flows actually produce — the catalog binding,
or a recorded workspace pair whose index entry, planning-worktree marker and
execution association agree. A pair whose own sources disagree stays a refusal, a
torn sibling pair does not veto a write an agreeing pair admits, and every refusal
names the repair.

The contract exists because its absence was load-bearing: retention run from a
real verified planning worktree was hard-refused three different ways, which
forced a real delivery to close under an owner waiver rather than run the
lifecycle as designed.

## Requirements
### Requirement: Scoped fact selection merges fail-closed and never guesses

A scoped command (retention, archive/finalization, and any Store-project-scoped write) SHALL derive its Store, project, and target line by merging facts from, in order of strength: explicit selectors, frozen session context, execution association, planning-worktree marker, project binding, and the store registry. Weaker sources SHALL only fill absent fields, never override stronger ones. When two sources disagree on the same field, the command SHALL refuse with a conflict that names both sources and both values, and SHALL write nothing.

#### Scenario: Two agreeing sources resolve

- **WHEN** a scoped command runs from a seat whose planning-worktree marker and execution association agree on store, project, and target line
- **THEN** the scope resolves to that triple and the command proceeds

#### Scenario: Genuine disagreement refuses with both sources named

- **WHEN** the planning-worktree marker names project P1 while the execution association names a different project P2 for the same store
- **THEN** the command refuses with a conflict naming both sources and both values, and no write occurs

### Requirement: A Store checkout's root configuration contributes no project identity fact

The root `rasen/config.yaml` of a Store checkout (a root carrying Store metadata) SHALL NOT contribute a projectId fact to scope selection, because a Store aggregate is not a project and its setup-time projectId is a member of no project catalog. A standalone project root's configuration SHALL continue to contribute its projectId fact.

#### Scenario: Planning worktree of a partitioned Store resolves

- **WHEN** a scoped command runs from a planning worktree of a v2 Store whose committed root configuration carries a projectId that belongs to no project catalog, while the worktree marker names a member partition
- **THEN** the root configuration's projectId is not admitted as a fact, and the scope resolves through the marker without a conflict

#### Scenario: Standalone project config still binds

- **WHEN** a scoped command runs in a standalone project whose root configuration declares a projectId and no Store metadata is present at that root
- **THEN** the configuration's projectId is admitted as a project-binding fact as before

### Requirement: A worktree of a registered Store repository resolves to that registered Store

Root-to-registry matching SHALL recognize a Store checkout by canonical path equality first, and, failing that, by git repository identity: a root that is a linked worktree sharing a repository common directory with a registered entry's local path SHALL resolve to that entry. A worktree whose Store metadata identity disagrees with the matched entry SHALL be refused fail-closed. A probe that cannot run SHALL leave matching unchanged (no match), never produce a wrong match.

#### Scenario: Planning worktree matches the registered main checkout's entry

- **WHEN** the registry entry's local path is the Store's main checkout and the current root is a linked planning worktree of the same repository carrying matching Store metadata
- **THEN** the root resolves to that registered Store entry

#### Scenario: Identity disagreement refuses

- **WHEN** a linked worktree of a registered Store repository carries Store metadata whose identity does not match the registered entry
- **THEN** resolution refuses with a conflict naming the mismatch, and no write occurs

### Requirement: The planning-bound gate accepts a consistent recorded pair or a bound catalog

A project-scoped write SHALL be admitted as planning-bound when either the selected project's catalog record states `planningBinding: bound`, or a recorded workspace pair for the selected store, project, and target line exists whose index entry, planning-worktree marker, and execution association all agree on that triple. Each recorded pair SHALL be evaluated as an independent witness: one pair whose three sources agree admits the write regardless of how many other pairs are recorded for the same project and target line, and regardless of the order they are enumerated in. When no recorded pair agrees and no catalog record states `bound`, the command SHALL refuse: as a fail-closed conflict naming every disagreeing source when some pair's own index entry, marker, or association contradict each other, and otherwise naming the exact repair that records a pair.

#### Scenario: Recorded pair satisfies the gate without a bound catalog

- **WHEN** a scoped command targets a project whose catalog is unbound but whose recorded pair (index entry, marker, and association) agrees on the store, project, and target line
- **THEN** the write is admitted as planning-bound

#### Scenario: Bound catalog satisfies the gate with no local pair

- **WHEN** a scoped command targets a project whose catalog states `planningBinding: bound` and no workspace pair is recorded on this machine
- **THEN** the write is admitted as planning-bound

#### Scenario: Neither evidence refuses with the named repair

- **WHEN** a scoped command targets a project whose catalog is unbound and no pair is recorded
- **THEN** the command refuses with the exact command that would record a pair, and no write occurs

#### Scenario: Inconsistent pair evidence refuses

- **WHEN** no recorded pair for the selected project agrees across its index entry, marker, and association, and at least one of those pairs has a marker or association naming a different store, project, or target line than its own index entry
- **THEN** the command refuses as a conflict naming every disagreeing source, and no write occurs

#### Scenario: A torn sibling pair does not veto an agreeing pair

- **WHEN** two pairs are recorded for the selected project and target line, one whose index entry, marker, and association all agree, and one whose marker or association contradicts its own index entry
- **THEN** the write is admitted as planning-bound on the agreeing pair, in either enumeration order, and the torn sibling is left to the diagnostic surfaces rather than refusing the write
