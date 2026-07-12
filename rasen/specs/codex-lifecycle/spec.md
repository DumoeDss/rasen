# codex-lifecycle Specification

## Purpose
Define lifecycle management for dispatched Codex exec workers: warm resume of an existing thread, mid-turn death detection, failure retry classification with a capped backoff schedule, single-writer-per-thread enforcement, and cross-session warm-seed reconstruction of a prior worker's context.

## Requirements
### Requirement: Warm continuation via resume dispatch
The system SHALL support re-engaging an existing Codex worker thread by building a resume dispatch (`codex exec resume <threadId>`) through the same invocation builder used for fresh dispatch, preserving every fresh-dispatch safety invariant that resume actually accepts: stdin closed, `--json` event output, last-message capture, model/effort flags with the leaf effort cap, template inlining, structured-return schema composition, and the appended flat-hierarchy guard. Resume SHALL require an explicit thread id — there is no "most recent thread" form, because it is ambiguous when multiple workers run in parallel. Sandbox mode is fixed at thread creation and is NOT a resume-time flag — live-verified (dev-machine smoke test): `codex exec resume` rejects `-s`/`--sandbox` outright ("unexpected argument '-s' found"), so a resume dispatch SHALL NOT include it.

#### Scenario: Build a resume dispatch
- **WHEN** a caller builds an invocation with a resume target thread id and a new message
- **THEN** the arguments SHALL name the resume subcommand with that thread id ahead of the dispatch flags
- **AND** the assembled prompt SHALL end with the flat-hierarchy guard exactly as a fresh dispatch does

#### Scenario: Fresh-dispatch invariants compose with resume, except sandbox
- **WHEN** a resume dispatch is built with an output-schema path, a sandbox mode, a model, and reasoning effort `ultra`
- **THEN** the arguments SHALL carry the same `--output-schema`, `-o`, and `-m` flags as a fresh dispatch and the effort SHALL be clamped to `xhigh` with a recorded warning
- **AND** the arguments SHALL NOT carry a `-s`/`--sandbox` flag, because `codex exec resume` does not accept one

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
The system SHALL enforce, within a dispatching process, that at most one writer holds a given thread id at a time: claiming an already-claimed thread id fails loudly naming the thread, and releasing a claim makes the thread claimable again. The cross-process form of this rule — one thread id has one writer globally — SHALL be stated as an operator invariant wherever the claim mechanism is documented.

#### Scenario: Double claim is rejected
- **WHEN** a thread id is claimed while an earlier claim on it is still held
- **THEN** the second claim SHALL fail with an actionable error naming the thread id

#### Scenario: Release then re-claim
- **WHEN** a claim is released (release being safe to invoke more than once)
- **THEN** a subsequent claim on the same thread id SHALL succeed

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
