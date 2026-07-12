## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Durable worker handles captured in run-state on dispatch

The orchestration playbook's Step B dispatch instructions (`src/core/templates/workflows/_orchestration.ts`) SHALL instruct the LEAD to capture the worker's `agentId` AND `transcript` from the Agent/Task tool's spawn RESULT and write them into the stage's `worker` record in run-state (Step F). The playbook SHALL NOT instruct recording a fabricated `name` (or any other non-durable label) in place of `agentId`/`transcript`. For Codex workers the analogue applies — record `runtime: codex`, `role`, `threadId`, and `turnId`/`transcript` from the spawn result. The `Worker` schema fields SHALL remain optional and the object SHALL remain `.passthrough()` so that archived `auto-run.json` from before this change still parses unchanged.

#### Scenario: Step B captures agentId and transcript from the spawn result

- **WHEN** the generated Step B dispatch instructions are inspected
- **THEN** they SHALL instruct the LEAD to read the `agentId` and the transcript path from the Agent tool's spawn result
- **AND** to write both into the stage `worker` record in run-state
- **AND** SHALL NOT instruct recording a fabricated `name` in place of those handles

#### Scenario: Worker schema fields stay optional and passthrough (backward compatible)

- **WHEN** `RunStateWorkerSchema` is inspected after this change
- **THEN** every handle field (`agentId`, `transcript`, `threadId`, `turnId`, …) SHALL remain optional
- **AND** the schema SHALL remain `.passthrough()` so archived run-state with extra or missing keys still parses

### Requirement: Run-state worker-handle validation surfaced on resume

`rasen pipeline resume` SHALL surface a non-fatal warning for each stage whose `worker` record lacks ANY durable handle (`agentId`, `transcript`, or `threadId`) — for example a name-only record (`{ name: "implementer" }`) or a role-only/bare-string record — so the worker is not silently dropped from the warm-seed set by `collectStageWorkers`. The warning SHALL name the offending stage id and SHALL enumerate the non-durable keys the record carries (e.g. `name`) so schema drift is detected rather than silently accepted. The warning SHALL appear in the `--json` output under a dedicated field (`workerHandleWarnings`) AND in the human-readable output. Surfacing the warning SHALL NOT remove the worker from any other resume surface and SHALL NOT cause resume to fail or exit non-zero. Unknown worker keys SHALL remain permitted (the `.passthrough()` schema is preserved); this detection is advisory only.

#### Scenario: name-only worker record is warned, not silently dropped

- **WHEN** a stage `worker` record carries only non-durable keys (e.g. `{ name: "implementer" }`) and no `agentId`/`transcript`/`threadId`
- **THEN** `rasen pipeline resume --json` SHALL include a `workerHandleWarnings` entry naming that stage
- **AND** the human-readable output SHALL print a warning naming that stage
- **AND** resume SHALL still exit 0

#### Scenario: structured worker with a durable handle warns nothing

- **WHEN** every stage `worker` record carries at least one of `agentId`/`transcript`/`threadId`
- **THEN** `rasen pipeline resume --json` SHALL emit no `workerHandleWarnings`
- **AND** the human-readable output SHALL print no handle warning

#### Scenario: warning names the non-durable keys (drift detection)

- **WHEN** a stage `worker` record is `{ name: "implementer", role: "implementer" }`
- **THEN** the warning SHALL enumerate the non-durable key(s) present (e.g. `name`)
- **AND** SHALL NOT reject the record (parsing succeeds, passthrough preserved)

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
