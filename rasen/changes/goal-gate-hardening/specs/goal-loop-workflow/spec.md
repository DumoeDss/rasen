## ADDED Requirements

### Requirement: Blocked-Threshold Guard Against Premature Give-Up

A goal `loop` SHALL carry a `blockedThreshold` (default 3), a counter DISTINCT from `maxRounds` (total loop budget) and `loopStallLimit` (consecutive non-progressing rounds). When the implementer reports it is blocked, the LEAD SHALL NOT immediately accept the blocked verdict. The SAME blocking condition SHALL recur for `blockedThreshold` consecutive rounds — each intervening round the implementer re-dispatched to attempt a materially different angle — before the loop escalates the blocker. Any measured/judged progress, OR a materially different blocker, SHALL reset the blocked streak to zero. On reaching `blockedThreshold` the LEAD SHALL run the Step H.5/H.6 strategy-review ladder (re-approach, design-level rework, or isolate) rather than silently terminating the loop; the reported blocker and streak SHALL be recorded so they survive worker relay.

#### Scenario: First-round blocked report is not accepted immediately

- **WHEN** the implementer reports it is blocked on the first round it hits the obstruction
- **THEN** the LEAD SHALL NOT end the loop as blocked
- **AND** SHALL re-dispatch the implementer for a subsequent round instructed to try a different angle

#### Scenario: Same blocker recurring for blockedThreshold rounds escalates

- **WHEN** the same blocking condition is reported for `blockedThreshold` (default 3) consecutive rounds
- **THEN** the LEAD SHALL run the Step H.5/H.6 strategy-review ladder for the blocked stage
- **AND** SHALL NOT report the goal as satisfied

#### Scenario: Progress or a different blocker resets the streak

- **WHEN** a round makes measured/judged progress, OR reports a materially different blocker than the prior round
- **THEN** the blocked streak SHALL reset to zero
- **AND** a later blocked report SHALL begin counting anew from that reset

#### Scenario: blockedThreshold is independent of stall and maxRounds

- **WHEN** the Step H counter table and the goal `loop` schema are inspected
- **THEN** `blockedThreshold` SHALL appear as its own counter with a default of 3
- **AND** it SHALL NOT share a tally with `loopStallLimit` (rounds without progress) or `maxRounds` (total rounds)

### Requirement: Evaluate Gate Applies Completion-Audit Discipline

The evaluate gate's fresh reviewer (Step L evaluate branch and goal-command's termination invariants) SHALL judge satisfaction by a completion audit, not by the absence of obvious remaining work. The generated reviewer discipline SHALL: treat completion as unproven and verify it against the actual current state; derive concrete requirements from the goal/rubric and seek authoritative evidence (files, command output, test results, runtime behavior) for each; treat uncertain or indirect evidence as not achieved; require the audit to PROVE completion rather than merely fail to find remaining work; and forbid relying on intent, partial progress, or memory as proof. This discipline SHALL also govern the Tier-C reset-pass fallback (the freshly-reset single-context evaluation), which judges by the same audit.

#### Scenario: Evaluate reviewer discipline demands proof of completion

- **WHEN** the generated Step L evaluate branch (and goal-command's evaluate termination invariant) is inspected
- **THEN** it SHALL instruct the reviewer to treat completion as unproven, derive requirements from the goal/rubric, and require authoritative evidence per requirement
- **AND** it SHALL state that uncertain or indirect evidence counts as not achieved
- **AND** it SHALL state that the audit must prove completion, not merely fail to find remaining work

#### Scenario: Tier-C reset pass judges by the same audit

- **WHEN** the generated Tier-C evaluate fallback is inspected
- **THEN** its freshly-reset single-context evaluation SHALL apply the same completion-audit discipline
- **AND** SHALL still forbid the implementer self-certifying the rubric

## MODIFIED Requirements

### Requirement: Goal-Plan maxRounds Is Injected Into the Loop

Step L's Inject step SHALL copy `maxRounds` (and `loopStallLimit` and `blockedThreshold` if the planner set them) from `goal-plan.md` into `iterate.loopConfig`, alongside the gate config, so the planner's per-task round cap, stall limit, and blocked threshold are honored rather than orphaned by the pipeline/schema default.

#### Scenario: planner round cap is honored

- **WHEN** the generated Step L Inject step is inspected
- **THEN** it SHALL copy `maxRounds` (and `loopStallLimit` and `blockedThreshold` when present) from goal-plan.md into the loop config
- **AND** SHALL NOT leave the planner-authored round cap unread

### Requirement: Goal-Loop Run-State Fields Are Additive

`RunStateSchema` SHALL accept two optional additive fields for goal-loop runs: `loopConfig` (the injected effective gate config — gate kind, command/threshold or goal/rubric, maxRounds, loopStallLimit, blockedThreshold, workProduct) and `loopProgress` (a best-effort cache: current round, last score, stall streak, blocked streak, and a `historyRef` pointing to `goal-run.json`). These fields SHALL be optional so existing run-state files and readers remain unaffected, and `blockedThreshold` SHALL itself be optional within `loopConfig` (default applied at inject) so run-state written before this field still parses.

#### Scenario: Existing run-state files still parse

- **WHEN** a run-state file written before goal-loop (no `loopConfig`/`loopProgress`) is read
- **THEN** `parseRunState` SHALL accept it unchanged
- **AND** the typed reader SHALL expose the existing fields as before

#### Scenario: loopConfig with blockedThreshold round-trips

- **WHEN** a run-state whose `loopConfig` carries a `blockedThreshold` is written and re-read
- **THEN** the re-read `loopConfig` SHALL preserve the `blockedThreshold` value
- **AND** a `loopConfig` written without `blockedThreshold` SHALL still parse (additive)
