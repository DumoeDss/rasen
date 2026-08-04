# codex-lifecycle Specification

## Purpose
Define lifecycle management for dispatched Codex exec workers: warm resume of an existing thread, mid-turn death detection, failure retry classification with a capped backoff schedule, single-writer-per-thread enforcement, and cross-session warm-seed reconstruction of a prior worker's context.
## Requirements
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

### Requirement: Mid-turn death detection
The system SHALL report whether a worker thread died mid-turn by inspecting its rollout event log: the thread is dead-in-flight when the last turn-opening event has no subsequent turn-completion or turn-failure event. A thread whose rollout contains no turn-opening event SHALL be reported as not dead (idle), not as an error.

#### Scenario: Killed mid-turn
- **WHEN** a rollout's final turn-opening event is followed by no completion or failure event (the captured shape of a hard-killed worker)
- **THEN** the system SHALL report the thread dead-in-flight

#### Scenario: Cleanly finished thread
- **WHEN** every turn-opening event in the rollout is followed by a matching completion or failure event
- **THEN** the system SHALL report the thread not dead

#### Scenario: Revival notice for resumed dead workers
- **WHEN** a caller composes a resume message for a thread detected dead-in-flight
- **THEN** the system SHALL provide a single named revival-notice constant stating that the previous turn was interrupted, its last action may not have completed, and the worker must re-verify actual file and command state before trusting its prior claims

### Requirement: Failure retry classification and backoff schedule
The system SHALL classify a turn failure as retryable (rate-limiting, e.g. 429), fatal (the request cannot succeed without a configuration change, e.g. model 404), or unknown — never silently collapsing unproven failures into either proven class — and every verdict SHALL name the evidence it matched. The system SHALL provide a deterministic capped exponential backoff schedule for retryable failures; executing delays and retries remains the caller's responsibility.

#### Scenario: Rate-limit failure is retryable
- **WHEN** a turn failure's error message indicates rate limiting (429 / too many requests)
- **THEN** the classification SHALL be retryable and SHALL quote the matched evidence

#### Scenario: Model-not-available failure is fatal
- **WHEN** a turn failure's error message indicates the model is not available (404)
- **THEN** the classification SHALL be fatal and SHALL quote the matched evidence

#### Scenario: Unrecognized failure stays unknown
- **WHEN** a turn failure matches neither proven class
- **THEN** the classification SHALL be unknown, leaving the retry decision to the caller

#### Scenario: Backoff schedule
- **WHEN** successive retry attempts are numbered from one
- **THEN** the schedule SHALL start at the observed rate-limit recovery scale (20 seconds), double per attempt, and never exceed its cap

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

### Requirement: Cross-session warm seed
The system SHALL reconstruct a prior worker's seedable context across session boundaries: locating the thread's rollout file by id even after archival (falling back to the archived-sessions directory when the active sessions tree has no match), and distilling the conversation so that agent commentary is dropped in favor of final answers and the terminal answer — which the rollout duplicates across two event kinds — appears once. Distillation SHALL drop a record only when it is positively identified as commentary (`phase === 'commentary'`); records lacking phase metadata OR carrying an unrecognized phase value SHALL be kept rather than dropped, so shape drift degrades to verbosity, never to loss. Deduplication SHALL apply only across the two event kinds that duplicate one terminal answer, not to independent repeats within one kind.

#### Scenario: Locate an archived rollout
- **WHEN** a rollout is requested for a thread id whose file has moved to the archived-sessions directory
- **THEN** the system SHALL find it there after the active sessions tree yields no match, and SHALL still report absence explicitly when neither location has it

#### Scenario: Distill final answers without duplicates
- **WHEN** a conversation is distilled for warm seeding and the terminal answer appears both as a final-answer agent message and as the task-completion record
- **THEN** the distilled output SHALL keep the user/assistant turns, drop commentary-phase agent messages, and contain that terminal answer exactly once

#### Scenario: Unphased and unrecognized-phase records survive distillation
- **WHEN** a final-answer record carries no phase metadata, or carries a phase value other than `commentary` or `final_answer`
- **THEN** distillation SHALL keep it

#### Scenario: Same-source repeats across different turns are not deduplicated against each other
- **WHEN** two final-answer records from the SAME event kind (both `agent_message`, or both `task_complete`) carry identical text from different turns
- **THEN** distillation SHALL keep both — deduplication applies only across the `agent_message`/`task_complete` pair, not within one kind
