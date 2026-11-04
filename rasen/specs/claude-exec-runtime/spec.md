# claude-exec-runtime Specification

## Purpose
Define the non-interactive, machine-readable Claude worker bridge used by non-Claude hosts, including safe invocation, flat-leaf isolation, structured completion, exact-session continuation, and bounded failure handling.
## Requirements
### Requirement: Claude workers are dispatchable through a machine-readable bridge

Rasen SHALL provide a non-interactive Claude worker bridge that can be invoked by a non-Claude host. The bridge SHALL accept a prompt file, a built-in worker result contract, the worker's model/effort/sandbox configuration, an optional exact Claude session ID, and an explicit working directory. It SHALL return one machine-readable receipt identifying success or a stable failure kind.

#### Scenario: Codex-hosted LEAD launches a Claude worker

- **WHEN** a Codex-hosted LEAD invokes the bridge with a valid prompt file and Claude is available
- **THEN** Rasen launches one Claude print-mode worker in the requested working directory
- **AND** returns a receipt identifying runtime `claude` and dispatch mode `exec-bridge`

#### Scenario: Claude is unavailable

- **WHEN** the bridge cannot resolve or execute the Claude CLI
- **THEN** it exits non-zero with a `runtime-unavailable` or `spawn-failed` receipt
- **AND** does not report a worker as completed

### Requirement: Bridge invocation preserves prompts safely across platforms

The bridge SHALL construct the Claude process from a command and argv array without shell interpolation. It SHALL read the worker prompt from the named file, deliver the complete prompt through child stdin, and close stdin after delivery. The same behavior SHALL apply on macOS, Linux, native Windows executables, and Windows `.cmd` shims, including prompts containing newlines, CJK text, quotes, spaces, and shell metacharacters.

#### Scenario: Multiline CJK prompt on Windows shim

- **WHEN** the selected Claude executable is a Windows `.cmd` shim and the prompt contains newlines, CJK text, quotes, and shell metacharacters
- **THEN** the fixture worker receives the original prompt bytes as one input
- **AND** no prompt fragment is interpreted as a shell command

#### Scenario: Prompt does not appear in argv

- **WHEN** the bridge launches a worker from a prompt file
- **THEN** the child argv contains the runtime flags and schema but not the prompt contents
- **AND** the prompt is delivered through stdin followed by EOF

### Requirement: Claude bridge workers remain flat leaves

Every fresh or resumed Claude bridge prompt SHALL include the flat-hierarchy guard and SHALL disable Claude worker delegation tools. A bridge worker SHALL perform its assigned stage itself and SHALL return through the selected structured contract rather than creating or waiting on subagents.

#### Scenario: Fresh dispatch includes leaf isolation

- **WHEN** Rasen builds a fresh Claude bridge invocation
- **THEN** the delivered prompt contains the named flat-hierarchy guard
- **AND** the invocation denies the Claude subagent/delegation tools

#### Scenario: Resume preserves leaf isolation

- **WHEN** Rasen resumes an existing Claude bridge session
- **THEN** the continuation prompt and tool configuration preserve the same no-delegation contract

### Requirement: Structured completion is validated fail-closed

The bridge SHALL request Claude JSON-Schema output using Rasen's shared leaf or evaluate contract. A successful receipt SHALL require a Claude result envelope with subtype `success`, `is_error: false`, a non-empty `session_id`, and `structured_output` conforming to the selected contract. Plain result prose, malformed JSON, a Claude error envelope, missing structured output, or contract-invalid output SHALL NOT be accepted as completion.

#### Scenario: Valid leaf completion

- **WHEN** Claude exits successfully with a valid result envelope and leaf `structured_output`
- **THEN** the receipt contains the captured session ID and parsed `DONE` or `HANDOFF` result
- **AND** callers do not need to parse the result prose

#### Scenario: Structured output is missing

- **WHEN** Claude exits zero but its result envelope has no `structured_output`
- **THEN** the bridge exits non-zero with `structured-output-missing`
- **AND** does not infer `DONE` from prose

#### Scenario: Contract is invalid

- **WHEN** Claude returns structured output that does not conform to the selected leaf or evaluate contract
- **THEN** the bridge exits non-zero with `contract-invalid`
- **AND** reports the validation issue without fabricating contract fields

#### Scenario: Claude reports an error result

- **WHEN** the parsed result has `is_error: true` or a non-success subtype
- **THEN** the bridge exits non-zero with `claude-error-result`
- **AND** preserves bounded diagnostic detail for the LEAD

### Requirement: Claude sessions continue by exact identity

A successful fresh bridge dispatch SHALL expose Claude's exact session ID. A continuation SHALL name that ID explicitly, reuse the recorded working directory, use the same structured-result protocol, and permit at most one active writer for the session. The bridge SHALL NOT select a session through `--continue`, a “latest” lookup, or a spawn label.

#### Scenario: Exact session resumes

- **WHEN** a LEAD continues a Claude bridge worker using its recorded session ID and working directory
- **THEN** the bridge invokes Claude resume for that exact ID
- **AND** validates the continuation through the same selected contract

#### Scenario: Concurrent writers are rejected

- **WHEN** one continuation already holds the writer claim for a Claude session ID
- **THEN** a second concurrent continuation for that ID is rejected before dispatch
- **AND** independent Claude session IDs remain dispatchable in parallel

#### Scenario: Bridge parent dies while its worker tree survives

- **WHEN** a bridge process dies after binding its Claude worker tree and that tree remains alive
- **THEN** a second continuation for the same exact session is rejected before dispatch
- **AND** the claim is not recovered until the prior worker tree is proven dead

#### Scenario: Resume working directory is wrong

- **WHEN** a continuation is attempted outside the worker's recorded working directory
- **THEN** the bridge fails with an actionable resume error
- **AND** does not retry the session in a different directory

### Requirement: Process failure is bounded and observable

The bridge SHALL bound execution time and captured output. It SHALL distinguish timeout, non-zero exit, invalid JSON, and spawn failure in its receipt, and SHALL exit non-zero for each. Diagnostic capture SHALL remain bounded so a failing child cannot exhaust the parent process or corrupt the single JSON receipt.

#### Scenario: Worker times out

- **WHEN** the Claude worker exceeds the configured execution timeout
- **THEN** Rasen terminates the worker process tree
- **AND** returns a non-zero `timeout` receipt

#### Scenario: Worker exits non-zero

- **WHEN** the Claude process exits non-zero and writes stderr
- **THEN** the bridge returns a `nonzero-exit` receipt with bounded diagnostic text
- **AND** does not parse the failed turn as successful completion

#### Scenario: Output is not JSON

- **WHEN** the Claude process exits zero but stdout is not one valid result envelope
- **THEN** the bridge returns an `invalid-json` receipt
- **AND** does not leak the malformed stream into the parent's JSON output

### Requirement: Claude bridge consumes a validated OmniCross turn binding
The Claude runner and `rasen agent dispatch --runtime claude` bridge SHALL accept an optional validated OmniCross turn binding for one agent attempt. Fresh and exact-session continuation invocations SHALL merge only the allowlisted OmniCross base URL, route-token authentication, optional non-secret sentinel, and frozen model variables into the child environment. A dispatch without the binding SHALL retain existing behavior, and no binding SHALL modify Claude settings or credential files.

#### Scenario: Fresh Claude turn uses an OmniCross lease
- **WHEN** a fresh Claude dispatch is given a valid OmniCross binding
- **THEN** the child environment SHALL contain the resident proxy base URL, this lease's route token, the frozen model, and only the permitted sentinel when required
- **AND** the route token SHALL not appear in argv

#### Scenario: Exact Claude session receives a replacement lease
- **WHEN** an exact Claude session resumes after the previous lease was released or lost
- **THEN** the continuation SHALL use a new binding for the same frozen upstream and model while retaining the exact session id and cwd

#### Scenario: Claude dispatch is not routed
- **WHEN** no OmniCross binding is supplied
- **THEN** the runner SHALL preserve its existing environment and invocation behavior

### Requirement: Claude route secrets remain child-scoped and redacted
An OmniCross-routed Claude dispatch SHALL reject launch descriptors containing unrecognized environment keys, upstream credentials, or a token in argv. The route token SHALL exist only in the in-memory lease binding and spawned child's environment, and shared diagnostics SHALL redact it if the child or process launcher echoes it. Rasen SHALL NOT read or modify Claude credentials or settings as part of routing.

#### Scenario: Descriptor includes an upstream API key
- **WHEN** a purported Claude binding contains a Provider API key or an environment key outside the allowlist
- **THEN** Rasen SHALL reject the binding before spawning Claude

#### Scenario: Claude failure echoes the route token
- **WHEN** Claude output or a spawn error contains the route token
- **THEN** the returned receipt and persisted diagnostics SHALL contain a redaction marker instead of the token

#### Scenario: User Claude files are present
- **WHEN** a routed Claude turn runs on a machine with existing settings and credential files
- **THEN** Rasen SHALL leave their bytes and metadata unchanged
