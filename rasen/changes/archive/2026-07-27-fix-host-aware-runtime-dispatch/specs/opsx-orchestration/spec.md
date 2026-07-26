## ADDED Requirements

### Requirement: Codex dispatch follows the resolved route

The orchestration playbook SHALL dispatch a Codex target according to the preflighted dispatch mode. A Codex-hosted `native` stage SHALL use the host's native collaboration tools and a role-isolated leaf worker. A Claude-hosted `exec-bridge` stage SHALL use the shipped non-interactive `codex exec` contract. The playbook SHALL NOT substitute one mode for the other or re-derive a target runtime after pipeline execution inspection.

#### Scenario: Same-host Codex uses native collaboration

- **WHEN** a stage reports host Codex, target Codex, and dispatch mode `native`
- **THEN** the LEAD dispatches the leaf through the native Codex collaboration surface
- **AND** does not start a redundant `codex exec` process for that stage

#### Scenario: Claude-to-Codex keeps the verified exec bridge

- **WHEN** a stage reports host Claude, target Codex, and dispatch mode `exec-bridge`
- **THEN** the playbook uses a `codex exec` invocation with stdin closed, `--json`, last-message capture, per-role sandbox/model/effort, the appended flat-hierarchy guard, and contract-schema-constrained returns
- **AND** template and skill bodies are inlined client-side rather than resolved from Codex prompt files

#### Scenario: Exec-bridge identity remains thread-based

- **WHEN** an exec-bridge worker is recorded
- **THEN** its record carries `runtime`, role, dispatch mode, `threadId` captured from the JSON event stream, sandbox/model/effort metadata, and rollout path as the durable transcript pointer
- **AND** no turn id is fabricated for exec mode

#### Scenario: Unsupported route never reaches dispatch

- **WHEN** execution preflight identifies an unsupported host × target pair
- **THEN** the playbook receives no executable stage for that pair
- **AND** does not silently substitute the host runtime for the explicit target

### Requirement: Codex-native completion and synchronization are event-driven

For a Codex-native worker, the playbook SHALL treat the worker's final `DONE` or `HANDOFF` response as the completion channel automatically delivered to the parent mailbox. It SHALL reserve `send_message` for necessary intermediate coordination and SHALL NOT require a duplicate completion message. When the critical path depends on unfinished Codex-native workers, the LEAD SHALL use sparse event-driven synchronization: one long barrier-sized `wait_agent` call, woken by mailbox or user activity, rather than reflexively repeating short timeout waits. The LEAD SHALL wait again only when a meaningful wake has been consumed and required dependencies remain.

#### Scenario: Native final response completes the worker

- **WHEN** a Codex-native leaf returns its final structured `DONE` result
- **THEN** the LEAD consumes the automatically delivered completion
- **AND** the worker is not instructed to send an identical `DONE` through `send_message`

#### Scenario: Native handoff is delivered once

- **WHEN** a Codex-native leaf reaches a handoff trigger and returns `HANDOFF`
- **THEN** the LEAD accounts for that final result through the automatic completion channel
- **AND** no duplicate mailbox completion is required

#### Scenario: Critical-path wait is sparse

- **WHEN** the next action truly depends on an unfinished Codex-native worker
- **THEN** the LEAD issues one event-driven wait with a barrier-sized timeout
- **AND** does not poll worker status through repeated 30- or 60-second wait timeouts

#### Scenario: Independent work avoids unnecessary waiting

- **WHEN** the DAG has useful work that does not depend on the unfinished worker
- **THEN** the LEAD continues that work
- **AND** defers `wait_agent` until a real synchronization barrier

#### Scenario: Claude-native completion is unchanged

- **WHEN** a Claude-native stage is dispatched
- **THEN** the existing Task/agentId/transcript and proven `SendMessage` completion guidance remains in force
- **AND** the Codex-native automatic-final rule is not applied to it

## MODIFIED Requirements

### Requirement: Capability Tiers Are Auto-Detected

The playbook SHALL consume the preflighted host runtime and dispatch modes, observe the collaboration capabilities available on that host, and choose execution mechanics accordingly while keeping the pipeline definition identical across tiers. Host identity SHALL decide which native adapter applies; capability tier SHALL decide whether that adapter can use warm continuation, fresh leaf spawning, or the single-context fallback.

#### Scenario: Tier A on Claude agent-teams

- **WHEN** the host is Claude and agent-teams provides role-isolated spawning plus agentId-based message continuation
- **THEN** the LEAD SHALL use the Claude-native adapter and MAY resume a specific worker via `SendMessage`
- **AND** only the LEAD SHALL originate `SendMessage`

#### Scenario: Tier A on Codex native collaboration

- **WHEN** the host is Codex and native spawn, messaging/follow-up, completion delivery, and event-driven wait tools are available
- **THEN** the LEAD SHALL use the Codex-native adapter for same-host stages
- **AND** SHALL use the Codex-specific completion and wait contract rather than Claude `SendMessage` semantics

#### Scenario: Tier B — spawn without warm continuation

- **WHEN** the selected native host can spawn leaf workers but cannot warm-continue a prior worker
- **THEN** the LEAD SHALL spawn a fresh worker per stage or round
- **AND** SHALL reconstruct each worker's context from the change directory and run-state

#### Scenario: Tier C — degraded fallback

- **WHEN** no compatible native subagent capability is available
- **THEN** the LEAD SHALL execute the pipeline sequentially in a single context
- **AND** this tier SHALL be treated as the explicit fallback, not the primary path

## REMOVED Requirements

### Requirement: Codex workers dispatch through the verified exec bridge

**Reason**: The requirement incorrectly treats every Codex target as an external process. A Codex LEAD now has a verified same-host native route, while the exec bridge remains correct only for a supported cross-runtime route such as Claude→Codex.

**Migration**: Use `Codex dispatch follows the resolved route`. Existing exec-bridge invariants and lifecycle behavior are preserved for stages whose resolved dispatch mode is `exec-bridge`; same-host Codex stages migrate to the native adapter without changing pipeline definitions.
