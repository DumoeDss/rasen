## MODIFIED Requirements

### Requirement: Codex dispatch follows the resolved route

The orchestration playbook SHALL dispatch a Codex target according to the preflighted dispatch mode. A Codex-hosted `native` stage SHALL use the host's native collaboration tools and a role-isolated leaf worker. A Claude-hosted Codex `exec-bridge` stage SHALL use the shipped non-interactive `codex exec` contract. The playbook SHALL NOT substitute one mode for the other or re-derive a target runtime after pipeline execution inspection.

#### Scenario: Same-host Codex uses native collaboration

- **WHEN** a stage reports host Codex, target Codex, and dispatch mode `native`
- **THEN** the LEAD dispatches the leaf through the native Codex collaboration surface
- **AND** does not start a redundant `codex exec` process for that stage

#### Scenario: Claude-to-Codex keeps the verified exec bridge

- **WHEN** a stage reports host Claude, target Codex, dispatch mode `exec-bridge`, and bridge `codex-exec`
- **THEN** the playbook uses a `codex exec` invocation with stdin closed, `--json`, last-message capture, per-role sandbox/model/effort, the appended flat-hierarchy guard, and contract-schema-constrained returns
- **AND** template and skill bodies are inlined client-side rather than resolved from Codex prompt files

#### Scenario: Codex exec-bridge identity remains thread-based

- **WHEN** a Codex exec-bridge worker is recorded
- **THEN** its record carries `runtime`, role, dispatch mode, `threadId` captured from the JSON event stream, sandbox/model/effort metadata, and rollout path as the durable transcript pointer
- **AND** no turn id is fabricated for Codex exec mode

#### Scenario: Unsupported route never reaches dispatch

- **WHEN** execution preflight identifies an unsupported host × target pair
- **THEN** the playbook receives no executable stage for that pair
- **AND** does not silently substitute the host runtime for the explicit target

## ADDED Requirements

### Requirement: Claude exec-bridge dispatch follows the resolved route

The orchestration playbook SHALL dispatch a Claude target according to the preflighted route. A Codex-hosted stage reporting dispatch mode `exec-bridge` and bridge `claude-print` SHALL use the shipped `rasen agent dispatch --runtime claude` contract. Claude-native stages SHALL keep using the native Task/Agent lifecycle. Generic exec-bridge guidance SHALL distinguish Claude session IDs from Codex thread IDs.

#### Scenario: Codex-to-Claude uses the shipped bridge

- **WHEN** a stage reports host Codex, target Claude, dispatch mode `exec-bridge`, and bridge `claude-print`
- **THEN** the LEAD writes the fully inlined leaf prompt to a prompt file and invokes `rasen agent dispatch --runtime claude`
- **AND** passes the stage's result contract, model, effort, sandbox, and working directory without constructing a raw shell command

#### Scenario: Claude bridge completion records session identity

- **WHEN** the Claude bridge returns a successful structured receipt
- **THEN** the LEAD records runtime `claude`, dispatch mode `exec-bridge`, the returned `sessionId`, working directory, and any surfaced transcript/model/sandbox/effort metadata
- **AND** does not fabricate a native `agentId` or Codex `threadId`

#### Scenario: Claude bridge resumes explicitly

- **WHEN** the LEAD re-engages a completed Claude exec-bridge worker below its handoff threshold
- **THEN** it invokes the bridge with the worker's exact recorded `sessionId` and working directory
- **AND** does not use `SendMessage`, `--continue`, or a latest-session lookup

#### Scenario: Claude bridge failure follows worker-death accounting

- **WHEN** the bridge returns a timeout, CLI failure, protocol failure, or invalid contract receipt
- **THEN** the LEAD classifies and records the failure using that receipt before choosing retry, exact-session resume, or reconstruction
- **AND** never reports the stage clean from an unvalidated result

#### Scenario: Claude-native dispatch remains unchanged

- **WHEN** a stage reports host Claude, target Claude, and dispatch mode `native`
- **THEN** the LEAD continues to use the native Task/Agent, agentId, transcript, and SendMessage lifecycle
- **AND** does not start the external Claude bridge
