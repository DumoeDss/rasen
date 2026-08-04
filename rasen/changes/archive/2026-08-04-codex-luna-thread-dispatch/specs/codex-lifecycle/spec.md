## MODIFIED Requirements

### Requirement: Warm continuation via resume dispatch
The system SHALL support re-engaging an existing Codex worker thread through the machine-readable bridge by building a resume dispatch (`codex exec resume <threadId>`) with the same invocation builder used for fresh dispatch. Resume SHALL preserve every accepted fresh-dispatch safety invariant: prompt delivery followed by closed stdin, `--json` event output, bounded last-message capture, model/effort flags with the leaf effort rules, template inlining, structured-return schema composition, flat-hierarchy guard, process-tree timeout, and one-receipt diagnostics. Resume SHALL require one explicit thread id; there is no “most recent thread” form because it is ambiguous when multiple workers run in parallel. Sandbox mode remains fixed at thread creation and is not emitted as a resume-time flag because `codex exec resume` rejects `-s`/`--sandbox`.

#### Scenario: Build a resume dispatch
- **WHEN** a caller builds an invocation with a resume target thread id and a new message
- **THEN** the arguments SHALL name the resume subcommand with that thread id ahead of the dispatch flags
- **AND** the assembled prompt SHALL end with the flat-hierarchy guard exactly as a fresh dispatch does

#### Scenario: Fresh-dispatch invariants compose with resume, except sandbox
- **WHEN** a resume dispatch is built with an output schema, a sandbox value, a model, and supported leaf reasoning effort
- **THEN** the arguments SHALL carry the same `--output-schema`, `-o`, `-m`, and reasoning-effort configuration as a fresh dispatch
- **AND** the arguments SHALL omit `-s`/`--sandbox` and the receipt SHALL make the creation-time sandbox behavior observable

#### Scenario: Exact thread resumes through the CLI bridge
- **WHEN** a LEAD calls `rasen agent dispatch --runtime codex --resume <threadId>` with a valid continuation prompt and contract
- **THEN** Rasen resumes exactly `<threadId>` in the requested working directory and validates the continuation through the selected structured contract
- **AND** the receipt reports the same thread id rather than selecting a latest thread

#### Scenario: Resume event conflicts with requested identity
- **WHEN** a resumed process emits a thread identity different from the explicit resume target
- **THEN** the bridge returns `thread-id-mismatch` and does not report that continuation as successful

### Requirement: Single writer per thread
The system SHALL enforce that at most one live process tree writes a given Codex thread id at a time, including when competing resumes originate in separate Rasen CLI processes. Claiming an already-owned thread SHALL fail before releasing the continuation prompt and SHALL name the thread. A claim SHALL remain owned while its recorded worker process tree is alive even if the bridge parent dies; it becomes reclaimable only after that tree is proven dead. Releasing a completed claim SHALL be idempotent. Independent thread ids SHALL remain dispatchable in parallel.

#### Scenario: Double claim is rejected
- **WHEN** a thread id is claimed while an earlier claim on it is still held in the same process
- **THEN** the second claim SHALL fail with an actionable error naming the thread id

#### Scenario: Concurrent cross-process resume is rejected
- **WHEN** one Rasen CLI process has launched a continuation for a thread and a second process attempts to resume the same id
- **THEN** the second process SHALL return `thread-busy` before spawning a competing Codex turn

#### Scenario: Bridge parent dies while worker survives
- **WHEN** a bridge process dies after binding its Codex worker tree and that tree remains alive
- **THEN** a later resume of the same id SHALL remain `thread-busy`
- **AND** the claim SHALL not be recovered until the prior worker tree is proven dead

#### Scenario: Release then re-claim
- **WHEN** a worker tree closes and its claim is released, with release safe to invoke more than once
- **THEN** a subsequent claim on the same thread id SHALL succeed

#### Scenario: Independent threads remain concurrent
- **WHEN** two dispatches own different thread ids
- **THEN** both SHALL be allowed to run concurrently subject to their independent lifecycle bounds
