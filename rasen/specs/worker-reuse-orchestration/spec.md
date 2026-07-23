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

### Requirement: Reuse threshold vs handoff threshold selection rule

The orchestration playbook SHALL state one general rule for which threshold governs a context-occupancy decision, and the warm-continue guard (Step H.2) SHALL inline-exempt cross-change re-staffing from the handoff threshold. A **mid-task relay** decision (keep going on the current task) SHALL compare occupancy to the **handoff** threshold (default 0.5). A **cross-change re-staffing** decision (take on a whole new child change — planner reuse per Step B.1.5, cross-child implementer reuse per Step G.1.3) SHALL compare occupancy to the **reuse** threshold (default 0.25, stricter). Step H.2 SHALL forward-reference B.1.5 / G.1.3 for these cases so the reuse threshold, not the handoff threshold, is applied to planner and cross-child reuse.

#### Scenario: planner reuse uses the reuse threshold, not the handoff threshold

- **WHEN** the generated Step H.2 warm-continue guard is inspected
- **THEN** it SHALL state that planner reuse and cross-child implementer reuse compare against the reuse threshold (default 0.25) per Step B.1.5 / G.1.3
- **AND** SHALL NOT direct those cross-change decisions to the handoff threshold (default 0.5)

#### Scenario: general rule stated once

- **WHEN** the generated playbook Step H preamble is inspected
- **THEN** it SHALL distinguish a mid-task relay decision (handoff threshold) from a cross-change re-staffing decision (reuse threshold)

### Requirement: Reuse threshold is an occupancy ceiling

The `ReuseThresholdSchema` documentation in `src/core/pipeline-registry/types.ts` SHALL describe the reuse threshold's two forms with their distinct comparison directions: the fraction form as a maximum context OCCUPANCY (in (0,1]) at which a worker may take on a whole new child change — stricter (lower) than the handoff threshold — consistent with Step G.1.3's `pct ≤ threshold → reuse`; and the absolute form (`{ remainingTokens: N }`) as a required-headroom FLOOR — reuse only when at least N tokens remain. It SHALL NOT describe the fraction form as "headroom the worker must have," which implies the opposite comparison for that form.

#### Scenario: schema comment matches the occupancy comparison

- **WHEN** `ReuseThresholdSchema`'s doc comment is inspected
- **THEN** it SHALL describe the fraction form as an occupancy ceiling (max occupancy to take a new change, `pct ≤ threshold → reuse`), not required headroom
- **AND** it SHALL describe the absolute form as a headroom floor (`remainingTokens >= N → reuse`)

### Requirement: Apply implementer parks pending its first review verdict

When a review or verify stage immediately follows apply and the apply implementer's context occupancy is at or above the playbook's context floor for parking (the same floor already used to decide whether a worker is cheap enough to just re-spawn), the LEAD SHALL dispatch that implementer to park (via the parked-worker keepalive mechanism) for the interval between finishing apply and receiving the first review verdict, rather than leaving it un-parked to idle until its prompt cache expires. When the first verdict is clean, the LEAD SHALL stand the parked implementer down through the normal stand-down protocol. When the first verdict routes a fix back to that implementer, the LEAD SHALL deliver it through the parked-worker signal-file channel and the implementer resumes as an active worker to perform the fix, rather than being cold-restarted.

#### Scenario: High-context implementer parks through the review window

- **WHEN** an apply implementer above the parking context floor finishes apply and a review stage begins
- **THEN** the LEAD SHALL dispatch it to park pending the first review verdict instead of leaving it un-parked

#### Scenario: Low-context implementer is not parked

- **WHEN** an apply implementer below the parking context floor finishes apply
- **THEN** the LEAD MAY leave it un-parked, since rebuilding its context from scratch is cheap

#### Scenario: Clean first verdict stands the parked implementer down

- **WHEN** a parked apply implementer's first review verdict is clean
- **THEN** the LEAD SHALL stand it down through the normal stand-down protocol rather than keeping it parked further

#### Scenario: A routed-back fix reaches the parked implementer via signal file, not SendMessage

- **WHEN** a parked apply implementer's first review verdict routes a non-trivial fix back to it
- **THEN** the LEAD SHALL deliver that fix through the parked-worker signal-file channel
- **AND** SHALL NOT `SendMessage` the parked implementer directly, since mid-park delivery rebases its cache and defeats the purpose of parking it

### Requirement: Keepalive reuse horizons
The orchestration playbook SHALL assign every dispatched worker a reuse horizon at dispatch time, one of: `ONE_SHOT` (the default — the worker exits on DONE and never invokes `rasen agent wait`), `LOOP_BOUND` (review-cycle reviewer/fixer workers — the worker parks with `rasen agent wait` between loop rounds and stands down when the loop exits via review-clean or max-rounds), or `MILESTONE_BOUND` (the decompose planner — the worker parks between reuses and the LEAD writes a stand-down signal when the milestone is reached; for the decompose planner the milestone is the completion of the last child change's propose stage). Workers in wide fan-out stages (e.g. the verify expert fan-out) SHALL always be dispatched `ONE_SHOT`.

#### Scenario: ONE_SHOT worker exits without keepalive
- **WHEN** a ship worker completes its unit of work
- **THEN** it reports DONE and exits without ever invoking `rasen agent wait`

#### Scenario: LOOP_BOUND reviewer parks between rounds
- **WHEN** a review-cycle reviewer finishes a review round while the fixer works
- **THEN** the reviewer parks by invoking `rasen agent wait` in a loop, acting on each JSON outcome, and stands down (handoff, DONE, exit) when the review loop exits or the wait returns `standDown`

#### Scenario: MILESTONE_BOUND planner stands down after the last propose
- **WHEN** the last child change's propose stage completes in a decompose run
- **THEN** the LEAD writes a `standDown` signal for the planner's role key, and the parked planner's next wait beat returns it

#### Scenario: Fan-out workers are never kept alive
- **WHEN** the verify stage fans out parallel expert workers
- **THEN** every fanned-out worker is dispatched with the `ONE_SHOT` horizon

### Requirement: Signal-file-only interaction with parked workers
While a worker is parked in `rasen agent wait`, the LEAD SHALL interact with it exclusively by writing signal files (`kind: "resume"` with the instruction payload, or `kind: "standDown"`) using an atomic write (temp file then rename) to `<changeRoot>/signals/<role>.json`. The playbook SHALL forbid sending SendMessage to a parked worker (empirically a SendMessage delivery rebases the worker's conversation and invalidates its conversation-segment cache). SendMessage rules for workers in an active turn are unchanged.

#### Scenario: Resume via signal file
- **WHEN** the LEAD needs a parked LOOP_BOUND fixer to start the next fix round
- **THEN** the LEAD writes a `resume` signal carrying the round instruction, and the fixer receives it as the wait invocation's JSON result

#### Scenario: No SendMessage to parked workers
- **WHEN** the playbook instructs the LEAD on resuming or stopping a parked worker
- **THEN** the instructions require the signal-file channel and prohibit SendMessage for parked workers

### Requirement: Stand-down protocol
When a parked worker's wait returns `{ standDown: true }` for any reason (`beat-cap`, `lead-stand-down`, `runtime-not-gated`, `context-below-floor`), the worker SHALL follow the stand-down protocol: write or refresh its handoff distillate to the change directory, report DONE with its durable findings, and exit, freeing its concurrency slot. The LEAD SHALL treat a stood-down worker as retired and use cold-start seeding (dispatch brief plus handoff document) for any successor.

#### Scenario: Worker stands down on beat cap
- **WHEN** a parked reviewer's wait returns `{ standDown: true, reason: "beat-cap" }`
- **THEN** the reviewer writes its handoff, reports DONE, and exits, and the LEAD seeds any later re-review from the handoff plus the on-disk review report rather than resuming the retired worker
