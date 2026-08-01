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

The orchestration playbook (`src/core/templates/workflows/_orchestration.ts`) SHALL instruct the LEAD to re-engage a prior worker by its recorded `agentId` (the durable live handle returned in the Agent/Task tool's spawn result) — NOT by the worker's spawn `name`. The playbook SHALL state that `name` is a non-durable dispatch label, NEVER a resume handle: a COMPLETED Agent-tool subagent is NOT reliably name-addressable, even within the same un-compacted session (observed live — a completed worker was unreachable by name ~27 messages later in one continuous session; the harness directed to "use the agent ID"). The playbook SHALL scope the "agentIds are dead handles" rule explicitly to CROSS-SESSION boundaries — `agentId` is a live handle ONLY within the session that spawned the worker — and SHALL prescribe an agentId-first re-engagement ladder: try `SendMessage` by `agentId`; if no `agentId` was recorded or it does not resolve, fall back to the transcript warm-seed of Step F.1. The same agentId-first rule SHALL apply to the infra-death revival (Step H.4a(b)) and the unticked-`DONE` clarification (Step H.4b): each SHALL re-engage by `agentId`, never rely on `name`, and SHALL fall back to the transcript warm-seed when the `agentId` is absent or does not resolve. The playbook SHALL NOT claim that within-session `SendMessage`-by-name reliably revives a completed worker.

#### Scenario: completed worker is not name-addressable within a live session

- **WHEN** the generated playbook is inspected
- **THEN** it SHALL instruct the LEAD to re-engage a prior worker by its recorded `agentId`, not by its spawn `name`
- **AND** SHALL state that a completed Agent-tool subagent is not reliably name-addressable even within the same un-compacted session
- **AND** SHALL treat `name` as a non-durable dispatch label, never a resume handle

#### Scenario: dead-handle rule scoped to cross-session, agentId-first ladder within session

- **WHEN** the generated Step F.1 resume ladder is inspected
- **THEN** it SHALL state that agentIds are dead handles only across a session boundary
- **AND** SHALL prescribe re-engagement by `agentId` first within a live session
- **AND** SHALL fall back to the transcript warm-seed when `agentId` is absent or does not resolve

#### Scenario: infra-death and unticked-DONE revivals are agentId-first

- **WHEN** the generated Step H.4a(b) infra-death revival and Step H.4b unticked-`DONE` clarification are inspected
- **THEN** each SHALL re-engage the same worker by its `agentId`, not by name
- **AND** each SHALL fall back to the transcript warm-seed when the `agentId` is absent or does not resolve

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

#### Scenario: Same-session re-engagement is agentId-first, not by name

- **WHEN** the resume re-engages a prior holder within a live session (including the case where the session directory survived a restart)
- **THEN** the LEAD SHALL `SendMessage` by the recorded `agentId` first
- **AND** SHALL NOT rely on the spawn `name` to resolve the worker
- **AND** SHALL fall back to the F.1 transcript-warm-seed ladder if the `agentId` is absent or does not resolve

### Requirement: Worker lifecycle is selected from the recorded dispatch mode

The orchestration playbook and resume accounting SHALL distinguish `native` workers from `exec-bridge` workers and SHALL select the resume protocol from both runtime and dispatch mode. New worker records SHALL carry the canonical dispatch mode when known and SHALL record only handles actually returned by that dispatch mechanism. Archived records without a dispatch mode SHALL remain readable and SHALL use conservative handle-shape inference rather than fabricated identity.

#### Scenario: Claude-native record remains agent-based

- **WHEN** a Claude-native worker is spawned
- **THEN** its worker record carries runtime `claude`, dispatch mode `native`, `agentId`, and transcript when surfaced
- **AND** continuation uses the existing same-host native ladder

#### Scenario: Claude exec record resumes by session

- **WHEN** a Claude worker is dispatched through `exec-bridge`
- **THEN** its worker record carries runtime `claude`, dispatch mode `exec-bridge`, the captured `sessionId`, and working directory
- **AND** continuation uses the explicit Claude-session bridge rather than `SendMessage`

#### Scenario: Codex-native record does not fabricate an exec thread

- **WHEN** a Codex-native worker is spawned
- **THEN** its worker record carries runtime `codex`, dispatch mode `native`, role, and the native handle or transcript pointer actually returned by the host
- **AND** it does not carry a fabricated `threadId`

#### Scenario: Codex exec record remains resumable by thread

- **WHEN** a Codex worker is dispatched through `exec-bridge`
- **THEN** its worker record carries runtime `codex`, dispatch mode `exec-bridge`, the captured `threadId`, and rollout path as transcript
- **AND** continuation uses the existing explicit-thread resume ladder

#### Scenario: Archived Claude session record infers exec bridge

- **WHEN** an archived Claude worker record has a `sessionId` but no dispatch mode
- **THEN** resume treats it as the Claude exec-bridge shape
- **AND** does not require an on-disk migration

#### Scenario: Archived Codex thread record infers exec bridge

- **WHEN** an archived Codex worker record has a `threadId` but no dispatch mode
- **THEN** resume treats it as the Codex exec-bridge shape
- **AND** does not require an on-disk migration

#### Scenario: Ambiguous legacy record degrades conservatively

- **WHEN** an archived worker record lacks enough information to identify a native or bridge resume handle
- **THEN** resume keeps the record parseable
- **AND** uses the existing artifact/transcript reconstruction fallback with an observability warning rather than inventing a route

### Requirement: Durable worker handles captured in run-state on dispatch

The orchestration playbook's Step B dispatch instructions (`src/core/templates/workflows/_orchestration.ts`) SHALL instruct the LEAD to capture the worker identity returned by the selected dispatch mechanism and write it into the stage's `worker` record in run-state (Step F). For Claude-native workers, it SHALL capture `agentId` and transcript from the Agent/Task spawn result and SHALL NOT record a fabricated spawn `name` in their place. For Claude exec-bridge workers, it SHALL record `runtime: claude`, `dispatchMode: exec-bridge`, role, exact `sessionId`, working directory, and transcript when discoverable, and SHALL NOT fabricate a native `agentId` or Codex `threadId`. For Codex-native workers, it SHALL record `runtime: codex`, `dispatchMode: native`, role, and only native handles actually returned by the spawn. For Codex exec-bridge workers, it SHALL record `runtime: codex`, `dispatchMode: exec-bridge`, role, `threadId`, and transcript/rollout from the exec event stream and SHALL NOT fabricate a turn id. The worker schema fields, including dispatch mode and all handles, SHALL remain optional and the object SHALL remain passthrough so archived `auto-run.json` files continue to parse unchanged.

#### Scenario: Claude-native dispatch captures agentId and transcript

- **WHEN** the generated Claude-native Step B dispatch instructions are inspected
- **THEN** they SHALL instruct the LEAD to read `agentId` and transcript path from the Agent tool's spawn result
- **AND** to write both into the stage worker record
- **AND** SHALL NOT instruct recording a fabricated `name` in place of those handles

#### Scenario: Claude exec dispatch captures session and cwd

- **WHEN** the generated Claude exec-bridge Step B dispatch instructions are inspected
- **THEN** they SHALL record the bridge receipt's `sessionId` and working directory with runtime and dispatch mode
- **AND** SHALL NOT describe that identity as a native `agentId` or Codex `threadId`

#### Scenario: Codex-native dispatch records only native identity

- **WHEN** the generated Codex-native Step B dispatch instructions are inspected
- **THEN** they SHALL record the native spawn handle surfaced by the host with runtime and dispatch mode
- **AND** SHALL NOT describe that handle as an exec `threadId`

#### Scenario: Codex exec dispatch captures thread and rollout

- **WHEN** the generated Codex exec-bridge Step B dispatch instructions are inspected
- **THEN** they SHALL record the JSON event stream's `threadId` and rollout path with runtime and dispatch mode
- **AND** SHALL state that exec mode yields no turn id

#### Scenario: Worker schema stays backward compatible

- **WHEN** `RunStateWorkerSchema` is inspected after this change
- **THEN** every handle and dispatch-mode field remains optional
- **AND** the schema remains passthrough so archived run-state with extra or missing keys still parses

### Requirement: Run-state worker-handle validation surfaced on resume

`rasen pipeline resume` SHALL surface a non-fatal warning for each stage whose `worker` record lacks ANY durable handle (`agentId`, `sessionId`, `transcript`, or `threadId`)—for example a name-only record (`{ name: "implementer" }`) or a role-only/bare-string record—so the worker is not silently dropped from the warm-seed set. The warning SHALL name the offending stage id and SHALL enumerate the non-durable keys the record carries so schema drift is detected rather than silently accepted. The warning SHALL appear in the `--json` output under `workerHandleWarnings` AND in human-readable output. Surfacing the warning SHALL NOT remove the worker from any other resume surface and SHALL NOT cause resume to fail or exit non-zero. Unknown worker keys SHALL remain permitted; this detection is advisory only.

#### Scenario: Name-only worker record is warned, not silently dropped

- **WHEN** a stage `worker` record carries only non-durable keys and none of `agentId`, `sessionId`, `transcript`, or `threadId`
- **THEN** `rasen pipeline resume --json` includes a `workerHandleWarnings` entry naming that stage
- **AND** human-readable output prints a warning naming that stage
- **AND** resume still exits zero

#### Scenario: Structured worker with a durable handle warns nothing

- **WHEN** every stage `worker` record carries at least one of `agentId`, `sessionId`, `transcript`, or `threadId`
- **THEN** `rasen pipeline resume --json` emits no `workerHandleWarnings`
- **AND** human-readable output prints no handle warning

#### Scenario: Warning names the non-durable keys

- **WHEN** a stage `worker` record is `{ name: "implementer", role: "implementer" }`
- **THEN** the warning enumerates the non-durable key `name`
- **AND** the passthrough schema still accepts the record

### Requirement: Duplicate JSON keys in run-state detected

Run-state parsing SHALL detect duplicate keys in the `auto-run.json` JSON text and SHALL surface them as a non-fatal warning on resume. (`JSON.parse` silently collapses duplicate keys to the last value, so imperfect LEAD-authored JSON — observed in a real run with duplicate `propose`/`verify`/`rounds` keys — is otherwise invisible.) Detection SHALL be advisory: it SHALL NOT reject the file, SHALL NOT change which value parses, and SHALL leave archived run-state readable. The warning SHALL appear in `rasen pipeline resume` `--json` output under a dedicated field AND in the human-readable output.

#### Scenario: duplicate top-level keys are warned and still parse

- **WHEN** `auto-run.json` contains a duplicate key at the same object level (e.g. two `rounds` keys)
- **THEN** `rasen pipeline resume --json` SHALL include a duplicate-key warning naming the repeated key (and path)
- **AND** the file SHALL still parse (last value wins, as `JSON.parse` already does)
- **AND** resume SHALL still exit 0

#### Scenario: clean run-state warns nothing

- **WHEN** `auto-run.json` has no duplicate keys
- **THEN** `rasen pipeline resume --json` SHALL emit no duplicate-key warning

### Requirement: Tier A capability claims bounded to observed behavior

The orchestration playbook's Step A tier description (`src/core/templates/workflows/_orchestration.ts`) and the `src/core/claude-settings.ts` header doc comment SHALL NOT claim that Tier A (Claude Code with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) guarantees a completed worker is reliably re-addressable. They SHALL characterize Tier A honestly: agent-teams enables `SendMessage`-based re-engagement of a worker via its `agentId` in general, but a COMPLETED Agent-tool subagent may not be reachable even within the same session, so the LEAD SHALL record `agentId` + `transcript` on every dispatch and SHALL re-engage agentId-first, falling back to the transcript warm-seed. The tier is LEAD-self-reported from the playbook (no runtime probe of the env var exists in the CLI); the description SHALL be honest about what agent-teams does and does not guarantee.

#### Scenario: Step A text bounds the Tier A claim

- **WHEN** the generated Step A tier description is inspected
- **THEN** it SHALL state that agent-teams enables `SendMessage` re-engagement by `agentId` in general
- **AND** SHALL NOT claim a completed worker is reliably revived within-session
- **AND** SHALL direct the LEAD to record `agentId` + `transcript` and re-engage agentId-first with a transcript warm-seed fallback

#### Scenario: claude-settings.ts comment aligned with observed behavior

- **WHEN** the header doc comment of `src/core/claude-settings.ts` is inspected
- **THEN** it SHALL NOT assert that enabling agent-teams guarantees a completed worker is re-addressable for warm re-review
- **AND** SHALL characterize agent-teams as enabling agentId-based re-engagement in general, with the completed-worker caveat above
