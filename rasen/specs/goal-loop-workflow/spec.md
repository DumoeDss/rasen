# goal-loop-workflow Specification

## Purpose
Define the goal-loop stage iteration model — a bounded modify→judge cycle driven by a measure or evaluate gate, with warm-reused implementer dispatch, stall detection, resume correctness, an authoritative round record, and the three registered backend goal-loop pipelines.
## Requirements
### Requirement: Goal-Loop Stage Iteration

A stage with `loop.kind: goal` SHALL repeat a work→judge cycle driven by the deterministic reconciler. Each round dispatches ONE work-phase action followed by ONE judge-phase action. The loop SHALL stop when the judge returns satisfied/passed, and SHALL be bounded by `maxRounds` (default 5). The reconciler SHALL own round advancement, phase sequencing, cap enforcement, and exit policy — the prompt/skill SHALL NOT maintain a second mechanical state machine. The work-phase agent SHALL be warm-reused across rounds and SHALL NOT spawn child subagents.

#### Scenario: Loop runs until gate satisfied

- **WHEN** a goal-loop Run's judge phase returns satisfied/passed = true
- **THEN** the reconciler SHALL mark the bounded-loop as satisfied and contribute it to the succeeded set
- **AND** the downstream stages (tail) SHALL become eligible for admission

#### Scenario: Loop is bounded by maxRounds

- **WHEN** a goal-loop Run's judge phase returns not-satisfied in the final round (round = maxRounds)
- **THEN** the reconciler SHALL emit an escalate candidate with the exhausted outcome
- **AND** the Run SHALL NOT report the goal as satisfied or passed

#### Scenario: Reconciler owns phase sequencing

- **WHEN** a work-phase action completes with a valid domain result
- **THEN** the reconciler SHALL emit an admit candidate for the judge phase of the same round
- **AND** the skill/prompt SHALL NOT independently decide which phase runs next

#### Scenario: Implementer is warm-reused across rounds

- **WHEN** successive rounds of a goal-loop stage execute within a live session
- **THEN** the LEAD SHALL dispatch the same implementer worker for each round (warm continuation)
- **AND** SHALL NOT spawn a fresh implementer per round
- **AND** when the implementer's context fills it SHALL follow the standard worker self-handoff (write a handoff document, return `HANDOFF`), after which the LEAD warm-seeds a successor and the loop continues

### Requirement: Goal Gate Kinds Are Mutually Exclusive

Each goal-loop pipeline SHALL declare exactly one gate kind — `measure` (a deterministic command whose stdout is parsed as JSON `{score, passed?, detail?}`) or `evaluate` (a natural-language success criterion judged by a fresh reviewer worker). The schema SHALL reject any goal loop that declares both or neither. The `measure` gate SHALL define a stop condition via `threshold` (a score threshold) and/or `target` (a passed-count target), with a `direction` (`gte` default, or `lte` for smaller-is-better metrics like latency/memory). The `evaluate` gate SHALL carry a `goal` string and an optional `rubric`.

#### Scenario: Measure gate parses and validates

- **WHEN** a goal-loop stage declares `gate: { kind: measure, threshold: <n>, direction: gte|lte }` or `gate: { kind: measure, target: <n> }`
- **THEN** the schema SHALL accept it
- **AND** at runtime the LEAD SHALL run the injected `command` and parse its stdout as `{score, passed?, detail?}`

#### Scenario: Measure gate without a stop condition is rejected

- **WHEN** a goal-loop stage declares `gate: { kind: measure }` with neither `threshold` nor `target`
- **THEN** schema validation SHALL fail with an error indicating the measure gate needs a threshold or target

#### Scenario: Evaluate gate dispatches a fresh reviewer

- **WHEN** a goal-loop stage declares `gate: { kind: evaluate, goal: <text>, rubric: <text>? }`
- **THEN** at runtime the LEAD SHALL dispatch a FRESH reviewer worker (distinct from the implementer) handed the goal, rubric, and current artifact
- **AND** the reviewer SHALL return structured `{satisfied: boolean, gaps: string[]}` — not free text

#### Scenario: Combination of gate kinds is rejected

- **WHEN** a goal-loop stage attempts to declare both a measure and an evaluate gate
- **THEN** the discriminated-union schema SHALL reject it, because the gate field accepts exactly one `kind`

### Requirement: Measure Gate Failure Does Not Deadlock

A measure gate whose command exits non-zero, times out (beyond `timeoutSec`, default 120), or emits unparseable stdout SHALL be recorded as a not-passed round with the error captured — the loop SHALL continue (subject to `maxRounds`) and SHALL NOT deadlock or crash.

#### Scenario: Non-zero exit recorded as error

- **WHEN** the measure command exits non-zero
- **THEN** the round SHALL be recorded with an `error` field capturing stderr
- **AND** the round SHALL be treated as not-passed
- **AND** the loop SHALL proceed to the next round or the cap

#### Scenario: Unparseable stdout recorded as error

- **WHEN** the measure command's stdout is not valid JSON or lacks the expected fields
- **THEN** the round SHALL be recorded with an `error` field describing the parse failure
- **AND** the round SHALL be treated as not-passed and the loop SHALL continue

### Requirement: Goal-Loop Progress and Stall Detection

A round "progresses" when (measure: the score moved favorably versus the prior round — `gte` increased or `lte` decreased) or (evaluate: the gap-set shrank or the gate became newly satisfied). Round 1 SHALL count as progress. Consecutive non-progressing rounds SHALL increment a stall streak tracked in the goal-cycle domain reducer state. The stall streak SHALL be reconstructable from the frozen plan and committed Record alone. Moving the streak into the reducer SHALL NOT remove the acting rule it exists to serve: `loopStallLimit` (default 2, gate-neutral) consecutive non-progressing rounds SHALL still trigger a LEAD strategy review — warm-seed a fresh implementer with a different approach, or escalate — rather than silently burning further rounds.

#### Scenario: Stall streak triggers strategy review

- **WHEN** `loopStallLimit` consecutive rounds fail to progress
- **THEN** the LEAD SHALL initiate a strategy review (re-prompt with a different approach, or escalate)
- **AND** SHALL NOT silently continue burning rounds up to `maxRounds`

#### Scenario: Stall streak tracked in domain reducer

- **WHEN** consecutive rounds fail to progress
- **THEN** the goal-cycle domain reducer SHALL increment the stall streak in the committed state
- **AND** the stall streak SHALL be visible in the `goal/1` projection section

#### Scenario: Round one always counts as progress

- **WHEN** the first round of a goal-loop completes
- **THEN** it SHALL be counted as progress regardless of the gate result
- **AND** the stall streak SHALL begin counting from round two

### Requirement: Goal-Loop Resume Correctness

Resume of an interrupted goal-loop Run SHALL be driven entirely by the frozen plan and committed canonical Record. The reconciler SHALL reconstruct the exact same goal-cycle state (round, phase, score, gaps, stall streak) and next-ready action from committed events. The legacy `goal-run.json` file SHALL NOT be consulted during resume of a reconciler-engine Run. Completed actions SHALL NOT be re-admitted.

#### Scenario: Resume after satisfaction goes to tail

- **WHEN** a goal-loop Run is resumed and the committed Record shows a satisfied judge result
- **THEN** the reconciler SHALL project the bounded-loop as satisfied in the succeeded set
- **AND** SHALL NOT re-admit any work or judge phase

#### Scenario: Resume after a not-passed round continues at next round

- **WHEN** a goal-loop Run is resumed and the committed Record shows a complete, not-passed judge result with rounds remaining
- **THEN** the reconciler SHALL emit an admit candidate for the next round's work phase
- **AND** SHALL NOT re-admit the already-completed round

#### Scenario: Resume reconstructs state from Record only

- **WHEN** a goal-loop Run is resumed after a process restart
- **THEN** the system SHALL reconstruct round, phase, score, and stall streak from plan + Record
- **AND** SHALL NOT read `goal-run.json` to determine the next action

#### Scenario: Resume with no round record starts round one

- **WHEN** a goal-loop is resumed but no round has been committed yet (the define-goal stage completed but the iterate stage died before its first gate)
- **THEN** round 1 SHALL be dispatched — the reconciler emitting the round-1 work admit candidate for a reconciler-engine Run, the LEAD dispatching round 1 on the legacy path

### Requirement: Authoritative Round Record in goal-run.json

The canonical Record SHALL be the authoritative loop spine. Each committed goal-cycle event (work result, judge result) SHALL be recorded as a committed action in the canonical Record. The legacy `goal-run.json` file SHALL be a compatibility projection derived from the Record, NOT an independent authoritative source. A new Run SHALL NOT be back-driven by `goal-run.json`. The management API read path SHALL project per-round records from the Record into the legacy `{round, score?, measurePassed?, evaluateSatisfied?, gaps?}` shape for backward compatibility.

#### Scenario: Canonical Record is authoritative

- **WHEN** a goal-loop round's work and judge phases complete
- **THEN** the results SHALL be committed as actions in the canonical Record
- **AND** the Record SHALL be the sole source from which loop state is reconstructed

#### Scenario: goal-run.json projected for backward compatibility

- **WHEN** a management API consumer requests goal-loop run details for a reconciler-engine Run
- **THEN** the response SHALL include per-round records derived from the canonical Record
- **AND** the projection SHALL match the legacy shape
- **AND** the projection SHALL NOT be writable or back-drive the Run

#### Scenario: Round record appended after each gate

- **WHEN** a goal-loop round's gate completes (satisfied, not-passed, or error)
- **THEN** a record carrying the round number, the gate result, and the git tree fingerprint SHALL be available in the run artifact's resolved location — appended directly on the legacy path, derived from the canonical Record on the reconciler path
- **AND** the record SHALL be readable by a successor worker after relay

#### Scenario: Legacy run continues in place

- **WHEN** a goal-loop resumes and its run artifact already exists in the change directory
- **THEN** subsequent round records SHALL continue to resolve to that file (sticky-legacy), keeping one spine rather than splitting across two locations

### Requirement: Three Backend Goal-Loop Pipelines Are Registered

The package SHALL ship three goal-loop pipelines, each homogeneous (one gate kind, one iterate-skill flavor, one tail), auto-discovered from `pipelines/<name>/pipeline.yaml`: `goal-loop-measure` (measure gate, code-edit iterate, ship → archive tail), `goal-loop-evaluate` (evaluate gate, code-edit iterate, ship → archive tail), and `goal-loop-research` (evaluate gate, prose/research iterate, a `report` tail instead of ship/archive, with a lower implementer handoff threshold for earlier relay).

#### Scenario: Goal-loop pipelines are listed and valid

- **WHEN** `rasen pipeline list --json` runs
- **THEN** it SHALL include `goal-loop-measure`, `goal-loop-evaluate`, and `goal-loop-research`
- **AND** each SHALL parse and pass all pipeline validators with a valid DAG

#### Scenario: Measure and evaluate pipelines share the ship tail

- **WHEN** `goal-loop-measure` and `goal-loop-evaluate` are loaded
- **THEN** their final stages SHALL be ship → archive (reusing the existing ship and archive skills)

#### Scenario: Research pipeline uses a report tail

- **WHEN** `goal-loop-research` is loaded
- **THEN** its final stage SHALL be a `report` stage invoking the goal-report skill (not ship/archive)
- **AND** it SHALL set a lower implementer handoff threshold so relay happens earlier under context pressure

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

### Requirement: Evaluate Gate Has a Tier-C Author-Verifier Fallback

Step L (and goal-command's termination invariants) SHALL define the Tier-C degradation for an `evaluate` gate, since Step C's code-gate substitute (tests/lint/build) is meaningless for a subjective rubric. Under Tier C the author≠verifier invariant SHALL degrade to a second, freshly-reset single-context pass seeded ONLY with `goal` + `rubric` + the artifact under judgment (NOT the implementation transcript), recorded as the Tier-C fallback. If that is impossible, goal-loop-evaluate SHALL be declared unsupported under Tier C rather than allowing the implementer to self-certify.

#### Scenario: evaluate gate degrades on Tier C without self-certification

- **WHEN** the generated Step L evaluate branch (and goal-command invariants) is inspected
- **THEN** it SHALL state a Tier-C fallback: a freshly-reset single-context evaluation seeded only with goal + rubric + artifact
- **AND** SHALL forbid the implementer self-certifying the rubric under Tier C

### Requirement: Goal-Plan maxRounds Is Injected Into the Loop

Step L's Inject step SHALL copy `maxRounds` (and `loopStallLimit` and `blockedThreshold` if the planner set them) from `goal-plan.md` into `iterate.loopConfig`, alongside the gate config, so the planner's per-task round cap, stall limit, and blocked threshold are honored rather than orphaned by the pipeline/schema default.

#### Scenario: planner round cap is honored

- **WHEN** the generated Step L Inject step is inspected
- **THEN** it SHALL copy `maxRounds` (and `loopStallLimit` and `blockedThreshold` when present) from goal-plan.md into the loop config
- **AND** SHALL NOT leave the planner-authored round cap unread

### Requirement: Loop runArtifact Is Honored

Step L SHALL read the loop's `runArtifact` field (falling back to `goal-run.json`) wherever it references the loop spine file, rather than hardcoding `goal-run.json`, so a pipeline that configures a different run artifact does not diverge from the file the LEAD reads and writes.

#### Scenario: configured runArtifact is used

- **WHEN** the generated Step L is inspected
- **THEN** it SHALL reference `loop.runArtifact` (fallback `goal-run.json`) for the authoritative loop spine
- **AND** SHALL NOT hardcode `goal-run.json` as the only spine filename

### Requirement: Define-Goal Gate Confirms Goal and Gate Generally

goal-command's define-goal gate guardrail SHALL be phrased to confirm the goal plus the gate — the measure command OR the evaluate goal/rubric — before any round runs, rather than naming only "the measure command," so the gate is not read as vacuous on evaluate/research runs that carry no command.

#### Scenario: define-goal gate applies to evaluate/research runs

- **WHEN** the generated goal-command define-goal guardrail is inspected
- **THEN** it SHALL confirm the goal + gate (measure command or evaluate goal/rubric) before any round
- **AND** SHALL NOT restrict the confirmation to a measure command only

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

