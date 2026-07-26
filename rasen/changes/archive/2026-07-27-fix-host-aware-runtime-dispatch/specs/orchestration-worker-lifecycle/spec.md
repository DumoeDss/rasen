## ADDED Requirements

### Requirement: Worker lifecycle is selected from the recorded dispatch mode

The orchestration playbook and resume accounting SHALL distinguish `native` workers from `exec-bridge` workers. New worker records SHALL carry the canonical dispatch mode when known and SHALL record only handles actually returned by that dispatch mechanism. Archived records without a dispatch mode SHALL remain readable and SHALL use conservative handle-shape inference rather than fabricated identity.

#### Scenario: Codex-native record does not fabricate an exec thread

- **WHEN** a Codex-native worker is spawned
- **THEN** its worker record carries runtime `codex`, dispatch mode `native`, role, and the native handle or transcript pointer actually returned by the host
- **AND** it does not carry a fabricated `threadId`

#### Scenario: Codex exec record remains resumable by thread

- **WHEN** a Codex worker is dispatched through `exec-bridge`
- **THEN** its worker record carries runtime `codex`, dispatch mode `exec-bridge`, the captured `threadId`, and rollout path as transcript
- **AND** continuation uses the existing explicit-thread resume ladder

#### Scenario: Archived Codex thread record infers exec bridge

- **WHEN** an archived Codex worker record has a `threadId` but no dispatch mode
- **THEN** resume treats it as the legacy exec-bridge shape
- **AND** does not require an on-disk migration

#### Scenario: Ambiguous legacy record degrades conservatively

- **WHEN** an archived worker record lacks enough information to identify a native or bridge resume handle
- **THEN** resume keeps the record parseable
- **AND** uses the existing artifact/transcript reconstruction fallback with an observability warning rather than inventing a route

## MODIFIED Requirements

### Requirement: Durable worker handles captured in run-state on dispatch

The orchestration playbook's Step B dispatch instructions (`src/core/templates/workflows/_orchestration.ts`) SHALL instruct the LEAD to capture the worker identity returned by the selected dispatch mechanism and write it into the stage's `worker` record in run-state (Step F). For Claude-native workers, it SHALL capture `agentId` and transcript from the Agent/Task spawn result and SHALL NOT record a fabricated spawn `name` in their place. For Codex-native workers, it SHALL record `runtime: codex`, `dispatchMode: native`, role, and only native handles actually returned by the spawn. For Codex exec-bridge workers, it SHALL record `runtime: codex`, `dispatchMode: exec-bridge`, role, `threadId`, and transcript/rollout from the exec event stream and SHALL NOT fabricate a turn id. The `Worker` schema fields, including dispatch mode, SHALL remain optional and the object SHALL remain passthrough so archived `auto-run.json` files continue to parse unchanged.

#### Scenario: Claude-native dispatch captures agentId and transcript

- **WHEN** the generated Claude-native Step B dispatch instructions are inspected
- **THEN** they SHALL instruct the LEAD to read `agentId` and transcript path from the Agent tool's spawn result
- **AND** to write both into the stage worker record
- **AND** SHALL NOT instruct recording a fabricated `name` in place of those handles

#### Scenario: Codex-native dispatch records only native identity

- **WHEN** the generated Codex-native Step B dispatch instructions are inspected
- **THEN** they SHALL record the native spawn handle surfaced by the host with runtime and dispatch mode
- **AND** SHALL NOT describe that handle as an exec `threadId`

#### Scenario: Codex exec dispatch captures thread and rollout

- **WHEN** the generated exec-bridge Step B dispatch instructions are inspected
- **THEN** they SHALL record the JSON event stream's `threadId` and rollout path with runtime and dispatch mode
- **AND** SHALL state that exec mode yields no turn id

#### Scenario: Worker schema stays backward compatible

- **WHEN** `RunStateWorkerSchema` is inspected after this change
- **THEN** every handle and dispatch-mode field remains optional
- **AND** the schema remains passthrough so archived run-state with extra or missing keys still parses
