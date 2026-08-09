## ADDED Requirements

### Requirement: Codex workers are dispatchable through a machine-readable bridge

Rasen SHALL support `rasen agent dispatch --runtime codex` as a non-interactive Codex `exec-bridge`. The command SHALL accept a bounded prompt file, a built-in `leaf` or `evaluate` contract, a sandbox for fresh threads, optional model and reasoning-effort values, an explicit working directory, a bounded timeout, and an optional exact Codex thread id. Every invocation SHALL emit exactly one JSON receipt on stdout and SHALL exit non-zero when that receipt reports failure.

#### Scenario: Fresh Luna Max worker dispatches
- **WHEN** a LEAD dispatches a valid prompt with runtime `codex`, model `gpt-5.6-luna`, effort `max`, and a writable sandbox
- **THEN** Rasen launches one Codex exec worker in the requested working directory
- **AND** the success receipt identifies runtime `codex`, dispatch mode `exec-bridge`, bridge `codex-exec`, the selected model and effort, and the worker's exact thread id

#### Scenario: Fresh Terra worker dispatches through the same route
- **WHEN** a LEAD dispatches a valid prompt with model `gpt-5.6-terra` and effort `high`
- **THEN** Rasen forwards both values unchanged through the same Codex exec-bridge used for Luna
- **AND** the success receipt reports model `gpt-5.6-terra` and effort `high`

#### Scenario: Arbitrary non-empty Codex model dispatches without discovery
- **WHEN** a LEAD dispatches a valid prompt with a non-empty model id not known to Rasen, such as `provider/future-codex-model`
- **THEN** Rasen forwards the model id unchanged without consulting a built-in catalog or allow-list
- **AND** Codex remains responsible for reporting whether that model is available

#### Scenario: Codex is unavailable
- **WHEN** the bridge cannot resolve or execute the Codex CLI
- **THEN** it returns one non-zero `runtime-unavailable` or `spawn-failed` receipt
- **AND** it does not report a completed worker or fabricate a thread id

#### Scenario: Invalid dispatch input never launches
- **WHEN** the runtime, contract, sandbox, model, effort, timeout, prompt file, working directory, or resume thread id is invalid
- **THEN** the bridge returns one `invalid-input` receipt before spawning Codex

### Requirement: Bridge prompt transport is closed and cross-platform

The Codex bridge SHALL construct the child process from a command and argv array without caller-controlled shell interpolation. It SHALL read the complete prompt from the named file, append the named flat-hierarchy guard through the existing invocation builder, deliver the resulting bounded UTF-8 prompt through child stdin, and close stdin immediately after the payload. The same behavior SHALL apply on macOS, Linux, native Windows executables, and Windows `.cmd`/`.bat` shims.

#### Scenario: Worker observes EOF after its prompt
- **WHEN** the bridge launches a Codex worker with a valid prompt
- **THEN** the worker receives the complete assembled prompt followed by EOF
- **AND** the bridge can finish after the child completes rather than waiting on inherited or open stdin

#### Scenario: Multiline CJK prompt on a Windows shim
- **WHEN** the selected Codex executable is a Windows `.cmd` or `.bat` shim and the prompt contains newlines, CJK text, quotes, spaces, and shell metacharacters
- **THEN** the worker receives the original prompt content plus the flat-hierarchy guard as one stdin payload
- **AND** no prompt fragment is truncated, re-parsed as an argument, or executed as a shell command

#### Scenario: Paths with spaces retain native form
- **WHEN** the prompt file, working directory, schema file, or last-message path contains spaces on Windows, macOS, or Linux
- **THEN** the bridge passes each path as one argv value using the platform's native path handling

### Requirement: Codex bridge completion is structured and fail-closed

The bridge SHALL request the selected shared JSON Schema and SHALL accept success only when Codex exits zero, the durable thread identity is available, and the caller-named last-message file contains JSON conforming to that contract. A success receipt SHALL carry the typed result, exact thread id, canonical working directory, and the selected sandbox/model/effort metadata when present. Free-form prose and partial event output SHALL NOT be accepted as completion.

#### Scenario: Valid leaf completion
- **WHEN** a fresh worker emits its thread id and writes a conforming `DONE` or `HANDOFF` leaf result
- **THEN** the bridge returns `ok: true` with that exact thread id and typed leaf result
- **AND** callers do not need to parse the worker's prose or JSONL stream

#### Scenario: Valid evaluate completion
- **WHEN** a worker dispatched with contract `evaluate` writes a conforming `{ satisfied, gaps }` result
- **THEN** the bridge returns that typed evaluate result without coercing it into a leaf status

#### Scenario: Fresh thread identity is missing
- **WHEN** a fresh Codex process exits zero without emitting a non-empty `thread.started.thread_id`
- **THEN** the bridge returns a non-zero `thread-id-missing` receipt
- **AND** it does not invent an id from a filename, label, or prior thread

#### Scenario: Last message is absent or contract-invalid
- **WHEN** Codex exits zero but the last-message file is absent, empty, malformed JSON, or does not conform to the selected contract
- **THEN** the bridge returns a stable last-message or contract failure receipt
- **AND** it does not infer completion from stdout events or stderr prose

### Requirement: Codex bridge failures are bounded and diagnosable

The bridge SHALL bound execution time, stdin payload size, captured stdout and stderr, and last-message size. On timeout or a crossed output bound it SHALL terminate the complete worker process tree, wait for close, and return one non-zero receipt. Failure diagnostics SHALL retain useful exit, signal, event, and error detail while applying shared secret redaction and UTF-8 byte limits; child stdout and stderr SHALL never corrupt the single receipt stream.

#### Scenario: Worker timeout reaps the process tree
- **WHEN** a Codex worker exceeds the configured timeout
- **THEN** Rasen terminates the worker process tree on the current platform and returns a `timeout` receipt
- **AND** the receipt includes the captured thread id when it was observed before timeout

#### Scenario: Output bound is exceeded
- **WHEN** Codex produces more event or diagnostic output than the configured capture limit
- **THEN** Rasen terminates the process tree and returns an `output-limit` receipt with bounded diagnostics

#### Scenario: Non-zero exit preserves safe diagnostics
- **WHEN** Codex exits non-zero with stdout or stderr containing both actionable error text and credential-shaped values
- **THEN** the receipt reports `nonzero-exit`, retains bounded actionable text, and redacts credential values

#### Scenario: Windows child remains windowless
- **WHEN** the bridge runs or terminates a Codex worker on Windows
- **THEN** the non-interactive process and any shim host are launched with no visible console window
