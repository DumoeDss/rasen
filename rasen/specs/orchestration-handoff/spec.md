# orchestration-handoff Specification

## Purpose
Defines the orchestration playbook's context-handoff protocol: every worker spawn carries a handoff clause (soft-budget/compaction/self-assessment triggers and a structured DONE-or-HANDOFF return), the LEAD relays handoffs into run-state and spawns seeded successors under relay and stall caps, and escalation stays LEAD-first and non-blocking. Preserves the single-writer run-state invariant and adds a LEAD session pre-flight probe.

## Requirements
### Requirement: Worker handoff contract
The orchestration playbook SHALL instruct every worker spawn prompt to carry a handoff clause: triggers (LEAD-supplied soft budget, the compaction marker as a hard trigger, self-assessment) and a structured return contract (`DONE` + summary, or `HANDOFF { path, reason, completed, remaining }` after writing the handoff document to `rasen/changes/<id>/handoff/`). The `DONE` return SHALL additionally carry a durable-findings clause — 1–3 lines of discoveries that remain true for future planning (not per-task chatter) — which the LEAD relays verbatim into the next planner's dispatch so implementation discoveries feed subsequent proposals.

#### Scenario: Worker self-handoff mid-stage
- **WHEN** a worker returns a `HANDOFF` result
- **THEN** the playbook SHALL direct the LEAD to append the record to the stage's `handoffs[]` in run-state, and (below caps) spawn a successor worker seeded with the handoff document plus remaining tasks, in the same session
- **AND** workers SHALL NOT write run-state themselves (single-writer invariant)

#### Scenario: Worker dies without a handoff document
- **WHEN** a worker terminates abnormally or returns `DONE` with unticked tasks
- **THEN** the playbook SHALL direct the LEAD to treat it as a handoff without a document and cold-reconstruct the successor's context from the change-directory blackboard

#### Scenario: Durable findings relayed to the next planner
- **WHEN** a worker returns `DONE` with a durable-findings clause
- **THEN** the LEAD SHALL relay those findings verbatim into the dispatch of the planner that proposes a dependent or subsequent child change

### Requirement: Relay caps with LEAD-first review
The playbook SHALL bound handoff relays per stage by the resolved `maxRelays` and `stallLimit`, with the LEAD — not a human gate — performing the triggered review.

#### Scenario: Relay cap triggers LEAD review
- **WHEN** a stage receives its (maxRelays+1)th handoff request
- **THEN** the LEAD SHALL review the relay history before spawning another successor, choosing among: changing the approach/re-prompting (including better seeding), design-level rework via the planner, or isolating/decomposing the remaining work
- **AND** relays that show progress MAY continue past the cap after review

#### Scenario: Stall detection triggers early review
- **WHEN** `stallLimit` consecutive handoffs show no material progress (remaining set unchanged and no hypotheses eliminated)
- **THEN** the LEAD review SHALL trigger immediately without waiting for the relay cap

### Requirement: Warm-continue guard
Before re-engaging an existing worker via `SendMessage`, the LEAD SHALL probe that worker's recorded transcript with `rasen agent context` and, at or above the resolved threshold, retire it via a handoff document instead of continuing it.

#### Scenario: Bloated worker retired via handoff
- **WHEN** a worker's transcript probe reports `pct` at or above its resolved threshold
- **THEN** the LEAD SHALL have that worker write a handoff document as its final message, then seed a fresh successor from the document (raw-transcript warm-seed only as fallback)

### Requirement: Non-blocking escalation ladder
When a stage exhausts its strategy budget (relay reviews or review-loop rounds), the playbook SHALL park the stage as `escalated` with its history and continue unblocked work, surfacing parked items at the next gate or the run-end report — never a mid-run hard stop, and never reporting clean while a Blocker/Major finding is open.

#### Scenario: Review loop rounds exhausted
- **WHEN** the review-fix loop reaches its round cap with open Blocker/Major findings
- **THEN** the LEAD SHALL run the strategy ladder (each retry changing a material variable, recorded in `strategyAttempts`) instead of immediately stopping for a human
- **AND** after the strategy budget is exhausted the stage SHALL be marked `escalated` and parked while independent work continues

### Requirement: LEAD session pre-flight probe
The `/rasen:auto` entry SHALL probe the LEAD's own transcript (`rasen agent context --latest`) once before starting the pipeline and, when usage meets the session threshold, offer the user a choice — without blocking: (a) automatic session relay now (write the session handoff document, then launch a successor session per the session-relay protocol), (b) continue in the current session with auto-compact as the backstop, or (c) handle it manually. Below the threshold it proceeds silently.

#### Scenario: Entry probe above threshold
- **WHEN** an auto run starts and the probe reports usage at or above the session threshold
- **THEN** the LEAD SHALL present the relay/continue/manual choice and proceed only on the user's say-so at that moment; below threshold it proceeds silently

#### Scenario: User chooses automatic relay
- **WHEN** the user selects automatic relay at the pre-flight offer
- **THEN** the LEAD SHALL complete the session handoff document and run-state update, then perform the relay at a stage boundary per the session-relay protocol (quiesce invariant and generation cap included)

#### Scenario: User declines automatic relay
- **WHEN** the user chooses to continue or to handle handoff manually
- **THEN** behavior SHALL match the pre-existing flow: the run proceeds and auto-compact remains the backstop

### Requirement: Dual-form threshold interpretation

The orchestration playbook SHALL state how a resolved threshold of either form is compared against a probe. A fraction threshold `t` SHALL fire a handoff when the probe's `pct >= t` and SHALL permit reuse when `pct <= t` (unchanged behavior). An absolute threshold `{ remainingTokens: N }` SHALL fire a handoff when the probe's `remainingTokens <= N` and SHALL permit reuse when `remainingTokens >= N`. The playbook SHALL also state that a probe reporting `limit: 0` (no window known — e.g. a Codex rollout with zero completed turns) fires NEITHER form: a young rollout is by definition not near its limit.

#### Scenario: Playbook states both comparison rules
- **WHEN** the orchestration playbook template's Step H threshold guidance is inspected
- **THEN** it SHALL state the fraction rule (`pct >= t` hands off) and the absolute rule (`remainingTokens <= N` hands off; reuse requires `remainingTokens >= N`)
- **AND** it SHALL state that the resolution order includes the model-preset layer between pipeline config and built-in defaults

#### Scenario: Zero-limit probe fires no threshold
- **WHEN** the playbook's guidance for interpreting a probe with `limit: 0` is inspected
- **THEN** it SHALL direct the LEAD to treat neither threshold form as fired

