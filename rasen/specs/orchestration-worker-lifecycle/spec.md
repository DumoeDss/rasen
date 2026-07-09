# orchestration-worker-lifecycle Specification

## Purpose
Triage a dispatched worker's stop-without-clean-DONE by cause (context death, infra/transient death, transcript lost) rather than treating all as one cold-reconstruct branch; disambiguate the orchestration playbook's independent counters (relay count, review rounds, strategy attempts, goal-loop rounds/stall, handoff stall, session relays) so no counter is conflated with another.

## Requirements

### Requirement: Worker-death taxonomy triaged by cause

The orchestration playbook (`src/core/templates/workflows/_orchestration.ts`, Step H.4) SHALL triage a worker that stops without a clean `DONE` by WHY it stopped, in three classes, rather than treating all as one cold-reconstruct branch:

- **Context death** — the worker returned `HANDOFF` (compaction / budget / self-assessment) or hit its context limit. It has (or should have) a handoff document. The LEAD SHALL relay via the document; this consumes relay budget.
- **Infra / transient death** — the worker died from an environment fault (API error, tool timeout, socket close, or returned nothing) while its transcript is intact and the session is live. The LEAD's FIRST action SHALL be to `SendMessage` the SAME agent to revive it, instructing it that the failure was infrastructure (not context), that the working directory may have moved, and to re-read `tasks.md` and run `git status` to re-orient before continuing. Infra revivals SHALL consume NEITHER `maxRelays` NOR `stallLimit`. During an overload wave the LEAD SHALL back off and retry the wake with increasing delay before falling through.
- **Transcript lost** — no live agent and no recoverable transcript. Only this class SHALL cold-reconstruct the successor from the change-directory blackboard + run-state, and the cold reconstruction SHALL be recorded as a degradation in run-state.

#### Scenario: infra death revives the same agent without charging budget

- **WHEN** a dispatched worker dies from an API error or timeout with its transcript intact in a live session
- **THEN** the generated playbook SHALL instruct the LEAD to `SendMessage` the same agent to revive it (re-read tasks.md / git status, continue)
- **AND** SHALL state that infra revivals consume neither `maxRelays` nor `stallLimit`
- **AND** SHALL reserve cold reconstruction for the transcript-lost class only

#### Scenario: context death still relays via document

- **WHEN** a worker returns `HANDOFF`
- **THEN** the playbook SHALL relay via the handoff document and count it toward relay budget

### Requirement: DONE with unticked tasks is not a death

The playbook SHALL treat a `DONE` return with unticked tasks as an ambiguous completion by a live, in-session worker — NOT a death. The LEAD SHALL `SendMessage` the same worker to finish the remaining tasks or explain why they are moot, preserving its reasoning, without charging relay budget. Cold reconstruction SHALL apply only if that worker is unreachable / cross-session.

#### Scenario: unticked DONE is clarified, not cold-reconstructed

- **WHEN** a worker returns `DONE` with some tasks unticked in a live session
- **THEN** the playbook SHALL instruct the LEAD to `SendMessage` the same worker to finish or explain
- **AND** SHALL NOT cold-reconstruct a successor or charge a relay for this case

### Requirement: SendMessage-resume scoping and cross-session dead handles

The playbook SHALL state that `SendMessage`-ing a completed or interrupted worker within a live session IS a transcript-resume of the same agent (the cheap in-session path), and SHALL scope the "agentIds are dead handles" rule explicitly to CROSS-SESSION boundaries. The in-session revival note SHALL appear in the resume rule body, not only as an aside.

#### Scenario: dead-handle rule scoped to cross-session

- **WHEN** the generated Step F.1 resume ladder is inspected
- **THEN** it SHALL state that agentIds are dead handles only across a session boundary
- **AND** SHALL state that within a live session `SendMessage` revives the same agent (a transcript-resume)

### Requirement: Named, independent orchestration counters

The playbook SHALL name every orchestration counter and state its independence: relay count (`maxRelays`), review rounds (`loop.maxRounds`), strategy attempts, goal-loop rounds (goal `maxRounds`), goal stall (`loopStallLimit`, over rounds), handoff stall (`stallLimit`, over relays), and session relays (`sessionHandoff.n`). It SHALL state that a review round MAY span multiple worker relays and that the round cap and `maxRelays` are independent counters. It SHALL state the `maxRelays` asymmetry: a worker relay triggers a soft LEAD review after `maxRelays`, while a session relay is a hard stop at `maxRelays`. It SHALL state that a goal loop's stall counter is `loopStallLimit` over rounds, not `stallLimit` over relays.

#### Scenario: counters disambiguated in the playbook

- **WHEN** the generated playbook is inspected
- **THEN** it SHALL state that a review round may span multiple relays and that round cap and `maxRelays` are independent
- **AND** SHALL state the worker-relay-soft-review vs session-relay-hard-stop asymmetry for `maxRelays`
- **AND** SHALL distinguish `loopStallLimit` (goal rounds) from `stallLimit` (handoff relays)

### Requirement: Resume matches the latest generation's distillation

The Step F.1 resume ladder in the orchestration playbook (`src/core/templates/workflows/_orchestration.ts`) SHALL prefer a handoff or retirement document over a transcript ONLY when that document is the LATEST holder's own distillation of the role's final state. If the role's latest holder died un-exhausted (an unexpected interruption) leaving no document, the LEAD SHALL resume from that holder's transcript (the warm-seed of step 3); an intact transcript of the latest generation SHALL take precedence over any earlier generation's document. The LEAD SHALL NOT seed a successor from a stale predecessor's document when a newer holder's context survives unrecorded.

#### Scenario: Un-exhausted latest holder with no document, older document present

- **WHEN** the LEAD re-engages a role whose latest holder died un-exhausted without writing a handoff document
- **AND** an earlier generation of that role left a retirement or handoff document
- **THEN** the LEAD SHALL resume from the latest holder's transcript (step 3), NOT the earlier generation's document
- **AND** SHALL NOT treat the stale document as the resume source

#### Scenario: Latest holder's own document present

- **WHEN** the role's latest holder wrote its own handoff or retirement document distilling its final state
- **THEN** the LEAD SHALL seed the fresh worker from that document, as the document-first path already prescribes

#### Scenario: Same-session restart may still resolve the live handle

- **WHEN** the resume follows a restart in which the session directory survived
- **THEN** the LEAD MAY find that `SendMessage`-by-name still resolves to the latest holder
- **AND** SHALL attempt that wake first, falling back to the F.1 ladder only if the wake does not resolve
