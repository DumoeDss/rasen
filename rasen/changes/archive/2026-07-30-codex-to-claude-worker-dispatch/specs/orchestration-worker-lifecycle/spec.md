## MODIFIED Requirements

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
