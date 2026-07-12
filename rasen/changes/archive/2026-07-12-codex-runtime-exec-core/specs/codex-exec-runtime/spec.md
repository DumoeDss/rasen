# codex-exec-runtime Specification (delta)

## ADDED Requirements

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
