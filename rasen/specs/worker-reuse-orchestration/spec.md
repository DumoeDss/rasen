# worker-reuse-orchestration Specification

## Purpose
Defines the orchestration playbook's cross-child worker reuse policy: configurable planner reuse (auto/never), a probed warm-vs-retire decision for cross-child implementer reuse gated by the resolved reuse threshold, a unique-warm-predecessor rule for DAG merge nodes, `reusedFrom` lineage recording, and the scope boundaries where reuse does not apply.

## Requirements
### Requirement: Configurable planner reuse
The orchestration playbook's persistent-planner rule SHALL be governed by the resolved `reuse.planner` mode. Under `auto` (the default) a run SHALL keep a single planner and re-engage it for every propose-stage unit of work, as today. Under `never` the LEAD SHALL spawn a fresh planner for each propose and seed it from `planning-context.md` and the sibling proposals already on disk, rather than reusing the prior planner.

#### Scenario: Planner reuse under auto
- **WHEN** the resolved `reuse.planner` is `auto` and a run proposes a second child change
- **THEN** the LEAD SHALL re-engage the existing planner (warm continuation in a live session, or warm-seed from its recorded pointer across a boundary), consistent with the pre-existing persistent-planner behavior

#### Scenario: Fresh planner under never
- **WHEN** the resolved `reuse.planner` is `never` and a run proposes a second child change
- **THEN** the LEAD SHALL spawn a fresh planner seeded from `planning-context.md` (and any sibling proposals on disk) instead of reusing the prior planner

### Requirement: Cross-child implementer reuse decision
For two child changes joined by a dependency edge, the LEAD SHALL decide whether to reuse the prerequisite child's implementer for the dependent child by probing that implementer's recorded context usage AFTER the prerequisite child is review-clean, and comparing it to the resolved reuse threshold for the implementer role. At or below the threshold the LEAD SHALL warm-reuse the implementer for the dependent child; above it the LEAD SHALL retire the implementer. Reuse SHALL be considered only when `reuse.implementer` resolves to `auto`; under `never` the LEAD SHALL always spawn a fresh implementer per child.

#### Scenario: Warm reuse below threshold
- **WHEN** child B depends on child A, `reuse.implementer` is `auto`, and A's implementer probes at or below the resolved reuse threshold after A is review-clean
- **THEN** the LEAD SHALL reuse A's implementer for B (warm continuation in a live session, or warm-seed across a boundary)
- **AND** the reused worker's dispatch SHALL carry the contamination guard that A's conventions hold only where B's own artifacts (proposal/design) are silent

#### Scenario: Retire above threshold
- **WHEN** A's implementer probes above the resolved reuse threshold after A is review-clean
- **THEN** the LEAD SHALL retire it: the worker writes a handoff document with reason `retired-between-children`, focused on cross-change-transferable knowledge (conventions, gotchas, dead ends, working set) with an empty `remaining`
- **AND** the LEAD SHALL dual-source seed a fresh implementer for B from that document plus its own child-B dispatch brief

#### Scenario: Probe timing is prerequisite review-clean
- **WHEN** the LEAD evaluates reuse for a dependent child
- **THEN** it SHALL take the implementer probe only after the prerequisite child has passed its review loop (review-clean), not during the review-fix loop

#### Scenario: Reuse disabled under never
- **WHEN** `reuse.implementer` resolves to `never`
- **THEN** the LEAD SHALL spawn a fresh implementer for every child regardless of DAG adjacency or probe result

### Requirement: Unique warm predecessor required for reuse
Implementer reuse SHALL require a single warm predecessor. A child change that depends on more than one prerequisite (a DAG merge node) SHALL always receive a fresh implementer, multi-source seeded from each prerequisite's durable findings, rather than inheriting any one predecessor's worker.

#### Scenario: Merge node gets a fresh worker
- **WHEN** child C depends on both child A and child B
- **THEN** the LEAD SHALL spawn a fresh implementer for C and seed it from the durable findings of both A and B
- **AND** it SHALL NOT warm-reuse either A's or B's implementer for C

### Requirement: Reused worker lineage is recorded
When the LEAD reuses (or seeds from a retired) predecessor's implementer across a child boundary, it SHALL record the source child's id as `reusedFrom` on the dependent child's implementer worker record in run-state.

#### Scenario: Lineage recorded on reuse
- **WHEN** the LEAD reuses child A's implementer for child B
- **THEN** B's implementer worker record SHALL carry `reusedFrom: "<A's child id>"`

### Requirement: Reuse scope boundaries
The playbook SHALL exclude the design-level fixer from reuse (its value is fresh eyes), SHALL degrade reuse through the existing seeding and thread-resume ladders under Tier B and for Codex workers (the policy holds across runtimes), and SHALL NOT attempt reuse across a user's manually-run sequence of unrelated changes, which has no reliable relatedness signal.

#### Scenario: Design fixer never reused
- **WHEN** a design-level finding is routed to a fixer
- **THEN** the LEAD SHALL assign a fresh fixer and SHALL NOT warm-reuse a prior worker for that role

#### Scenario: Reuse degrades on non-Tier-A hosts
- **WHEN** the host is Tier B (or the worker runtime is Codex) and reuse is indicated
- **THEN** the LEAD SHALL carry the reuse intent through the existing warm-seed / thread-resume ladder rather than a live `SendMessage` continuation

#### Scenario: Manual sequential runs are out of scope
- **WHEN** a user runs several unrelated small-feature changes in sequence by hand (no orchestrated dependency DAG)
- **THEN** the reuse policy SHALL NOT apply and worker staffing SHALL be left to the user
