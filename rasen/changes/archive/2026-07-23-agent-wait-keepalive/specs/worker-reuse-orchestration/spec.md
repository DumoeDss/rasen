# worker-reuse-orchestration Specification (Delta)

## ADDED Requirements

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
