# codex-exec-runtime Specification

## Purpose
Define the Codex exec runtime core: building safe `codex exec` dispatches for leaf workers, inlining prompt templates client-side (working around codex-cli's rejection of custom prompt files), defining strict worker/evaluate-gate return contracts, and capturing thread identity plus rollout access for context occupancy, turn ids, and warm-seeding conversation reconstruction.
## Requirements
### Requirement: Codex exec invocation building
The system SHALL provide an invocation builder that assembles a `codex exec` dispatch for a leaf worker as structured data (program arguments plus a stdin-closed directive) and as a rendered shell command, so that every dispatch carries the safety invariants verified against codex-cli 0.144.1: stdin is always closed, `--json` event output is enabled, the final agent message is written to a caller-named file, and the requested sandbox mode, model, and reasoning effort are applied per dispatch.

#### Scenario: Build a fully-specified leaf dispatch
- **WHEN** a caller builds an invocation with a prompt, a sandbox mode (`read-only` or `workspace-write`), a model id, a reasoning effort, and a last-message output path
- **THEN** the resulting arguments SHALL include `exec`, `--json`, `-o` with the output path, `-s` with the sandbox mode, `-m` with the model id, and a `-c model_reasoning_effort` override with the effort value
- **AND** the invocation SHALL direct the caller to close stdin (the shell rendering ends with a null-device stdin redirect), because `codex exec` blocks forever awaiting stdin EOF otherwise

#### Scenario: Leaf reasoning effort is capped below ultra
- **WHEN** a caller requests reasoning effort `ultra` for a leaf dispatch
- **THEN** the builder SHALL clamp the effort to `xhigh` and record a warning on the invocation naming the clamp
- **AND** efforts up to and including `xhigh` and `max` SHALL pass through unchanged

#### Scenario: Flat-hierarchy guard is always appended
- **WHEN** any leaf dispatch is built
- **THEN** the assembled prompt SHALL end with the named flat-hierarchy guard clause forbidding `spawn_agent`, `followup_task`, `send_message`, `wait_agent`, and any other sub-agent delegation
- **AND** the guard text SHALL be a single named constant so generated prompts are trackable by name

#### Scenario: Optional model-provider override injection
- **WHEN** a caller supplies a model-provider override (name, base URL, and optionally wire API and env key)
- **THEN** the builder SHALL emit the corresponding `-c model_providers.<name>.*` overrides and select the provider via `-c model_provider`
- **AND** when no override is supplied the builder SHALL emit no provider configuration at all — no default provider is ever hardcoded

### Requirement: Client-side prompt template inlining
The system SHALL inline command template bodies into the dispatch prompt on the client side — reading the template source, stripping any YAML frontmatter, and substituting the invocation arguments — because codex-cli 0.144.1 rejects `$CODEX_HOME/prompts/*.md` custom prompts on both invocation surfaces and the `codex exec` failure mode is a silent hallucination. The inlining step SHALL be pluggable so a future native mechanism can replace it without changing dispatch call sites.

#### Scenario: Inline a frontmatter-bearing template with arguments
- **WHEN** a template source starting with a YAML frontmatter block and containing `$ARGUMENTS` placeholders is inlined with an argument string
- **THEN** the result SHALL contain the template body without the frontmatter and with every `$ARGUMENTS` occurrence replaced by the argument string

#### Scenario: Arguments without a placeholder
- **WHEN** a template body contains no `$ARGUMENTS` placeholder and a non-empty argument string is supplied
- **THEN** the result SHALL append the arguments to the body on a trailing `ARGUMENTS:` line so they are never silently dropped

#### Scenario: Pluggable inliner
- **WHEN** a caller supplies a custom inliner implementation to the invocation builder alongside a template
- **THEN** the builder SHALL use the supplied implementation instead of the default client-side one to produce the inlined prompt body

### Requirement: Structured worker return contracts
The system SHALL define the leaf-worker return contract (`status` of `DONE` or `HANDOFF`, with optional free-text `summary` and `handoffReason`) and the evaluate-gate contract (`satisfied` boolean plus a `gaps` string list, with optional `summary`) as strict JSON Schemas suitable for `codex exec --output-schema`, and SHALL provide parsers that turn a worker's last-message file into typed results.

#### Scenario: Contract schemas reject non-conforming shapes
- **WHEN** the leaf-return or evaluate-gate schema is applied
- **THEN** it SHALL require its status fields (`status`; `satisfied` and `gaps` respectively), constrain `status` to exactly `DONE` or `HANDOFF`, and reject unknown properties
- **AND** each contract SHALL retain an optional free-text `summary` field as the escape hatch for nuance that would otherwise break strict conformance

#### Scenario: Parse a conforming last message
- **WHEN** a last-message file contains JSON conforming to a contract
- **THEN** the matching parser SHALL return the typed result

#### Scenario: Parse a malformed last message
- **WHEN** a last-message file is empty, is not JSON, or does not conform to the contract
- **THEN** the parser SHALL fail with an actionable error naming what was expected rather than guessing a status

### Requirement: Thread identity capture and rollout access
The system SHALL capture a dispatched worker's `thread_id` from the `codex exec --json` event stream and SHALL locate and read the thread's rollout JSONL: reporting context occupancy from the last `token_count` event (which carries the model context window inline), exposing turn ids from `task_started`/`task_complete` payloads, and reconstructing the user/assistant conversation for warm seeding. Readers SHALL tolerate malformed or unknown lines by skipping them.

#### Scenario: Capture the thread id
- **WHEN** the captured `--json` output of a dispatch contains a `thread.started` event
- **THEN** the system SHALL report that event's `thread_id` as the worker's durable identity handle
- **AND** when no `thread.started` event is present it SHALL report the id as absent rather than inventing one

#### Scenario: Locate a rollout file by thread id
- **WHEN** a rollout is requested for a thread id under a Codex home (respecting the `CODEX_HOME` environment override, defaulting to `~/.codex`)
- **THEN** the system SHALL resolve the dated deterministic sessions path when the creation timestamp is known, fall back to scanning the sessions tree for the thread id, and report absence explicitly when no file matches

#### Scenario: Read occupancy from a rollout
- **WHEN** a rollout file contains at least one `token_count` event
- **THEN** the system SHALL report total tokens, the inline model context window, and their ratio from the LAST such event, with no external model-to-window lookup
- **AND** when a rollout has no `token_count` event yet (zero completed turns) the system SHALL report "no occupancy yet" as a normal zero-occupancy signal, not an error

#### Scenario: Reconstruct a conversation for warm seeding
- **WHEN** a rollout file is read for conversation content
- **THEN** the system SHALL return the ordered user and assistant turns while omitting developer-role scaffolding, and SHALL surface `task_complete`/`agent_message` payloads as per-turn final answers

### Requirement: Codex run-state worker identity
The system SHALL build a run-state worker record for a Codex dispatch that conforms to the existing pipeline run-state worker shape — `runtime: "codex"` with the thread id, model, sandbox, and effort — recording the rollout file path in the existing durable `transcript` pointer field so resume tooling treats it exactly like any other persisted-conversation pointer.

#### Scenario: Build a worker record from a completed dispatch
- **WHEN** a worker record is built from a captured thread id and the dispatch's model, sandbox, and effort, with a known rollout path
- **THEN** the record SHALL validate against the pipeline run-state worker schema with `runtime` set to `codex`, carry `threadId`, `model`, `sandbox`, and `effort`, and carry the rollout path as its `transcript` pointer

#### Scenario: Exec-mode records omit turn granularity
- **WHEN** a worker record is built from an exec-mode dispatch (whose bare turn events carry no turn id)
- **THEN** the record SHALL leave `turnId` unset rather than fabricating one from unrelated rollout events

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

### Requirement: Codex bridge consumes a validated OmniCross turn binding
The Codex runner and `rasen agent dispatch --runtime codex` bridge SHALL accept an optional validated OmniCross turn binding consisting of a dedicated route-token environment value and the allowlisted custom-provider configuration derived from a Route Lease. Fresh and resumed invocations SHALL select the reserved OmniCross Provider per invocation, set `wire_api` to `responses`, select the dedicated `env_key`, and disable response storage without writing or reading user Codex configuration or authentication files. A dispatch without the binding SHALL retain existing behavior.

#### Scenario: Fresh Codex turn uses an OmniCross lease
- **WHEN** a fresh Codex dispatch is given a valid OmniCross binding
- **THEN** the child SHALL receive the route token only through `OMNICROSS_CODEX_ROUTE_TOKEN`
- **AND** its argv SHALL contain the allowlisted per-invocation `model_provider` and `model_providers.omnicross` overrides

#### Scenario: Existing Codex thread receives a replacement lease
- **WHEN** an exact Codex thread resumes with a newly acquired binding for its frozen logical route
- **THEN** the resume invocation SHALL apply that binding while preserving the thread identity and creation-time sandbox semantics

#### Scenario: Codex dispatch is not routed
- **WHEN** no OmniCross binding is supplied
- **THEN** the runner SHALL emit no OmniCross provider override or route-token environment variable

### Requirement: Codex route binding cannot depend on OpenAI login state
An OmniCross-routed Codex dispatch SHALL use the descriptor's dedicated environment key and SHALL reject bindings that request `requires_openai_auth`, use `OPENAI_API_KEY` for the route token, place the token in argv, or attempt to mutate `config.toml` or `auth.json`. Runtime diagnostics SHALL redact the dedicated token even if Codex echoes it.

#### Scenario: Descriptor requests OpenAI authentication
- **WHEN** a purported OmniCross binding contains `requires_openai_auth` or uses `OPENAI_API_KEY` as its token environment
- **THEN** Rasen SHALL reject the binding before spawning Codex

#### Scenario: Codex stderr echoes the route token
- **WHEN** a failing Codex child prints its route token in captured stderr
- **THEN** the bridge receipt SHALL replace the token with a redaction marker

#### Scenario: User Codex files are present
- **WHEN** a routed Codex turn runs on a machine with existing `config.toml` and `auth.json`
- **THEN** Rasen SHALL leave their bytes and metadata unchanged
