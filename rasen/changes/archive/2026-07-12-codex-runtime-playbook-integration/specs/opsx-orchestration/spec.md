# opsx-orchestration Specification (delta)

## ADDED Requirements

### Requirement: Codex workers dispatch through the verified exec bridge
The orchestration playbook SHALL direct the LEAD to dispatch Codex workers as non-interactive `codex exec` processes using the shipped dispatch contract — never through an app-server thread, a Codex editor plugin, or any slash-command path. The documented dispatch SHALL close stdin, request JSON event output, capture the final message to a file, set sandbox, model, and reasoning effort per role (with worker effort never `ultra`), end every worker prompt with the flat-hierarchy no-delegation guard, inline any skill or template body into the prompt client-side, and constrain worker returns with the structured-return contract schemas parsed from the last-message file.

#### Scenario: Playbook dispatch guidance names the real mechanism
- **WHEN** the generated orchestration playbook's Codex dispatch guidance is inspected
- **THEN** it SHALL describe a `codex exec` invocation with stdin closed, `--json`, last-message capture, per-role sandbox/model/effort, the appended flat-hierarchy guard, and contract-schema-constrained returns
- **AND** it SHALL NOT direct the LEAD to app-server threads, a Codex plugin, or a `/codex:rescue` command path

#### Scenario: Template bodies are inlined, never prompt-file-resolved
- **WHEN** the playbook explains how a Codex worker receives a skill or template body
- **THEN** it SHALL require inlining the body into the dispatch prompt and SHALL warn that relying on Codex-side prompt files fails silently

#### Scenario: Recorded identity matches exec-mode reality
- **WHEN** the playbook describes recording a Codex worker in run-state
- **THEN** it SHALL name `runtime`, `role`, `threadId` (captured from the JSON event stream), sandbox/model/effort metadata, and the rollout file path as the durable `transcript` pointer
- **AND** it SHALL state that exec-mode dispatch yields no turn id, rather than promising one

### Requirement: Codex worker lifecycle follows the shipped signals
The orchestration playbook SHALL describe Codex worker continuation, revival, failure handling, occupancy, and parallelism in terms of the shipped, live-verified lifecycle semantics: resume by explicit thread id with sandbox fixed at thread creation (resume accepts no sandbox flag — changing sandbox requires a fresh thread); death detected from the rollout event log as an unterminated final turn, with an interrupted-worker revival notice on re-engagement; rate-limit failures retried with capped exponential backoff while model-not-available failures are surfaced as fatal and unrecognized failures escalate rather than being guessed; occupancy probed via `rasen agent context --transcript <rolloutPath>` under the same thresholds as Claude workers (a zero-turn rollout reading 0% is normal); and at most one concurrent writer per thread id.

#### Scenario: Resume guidance reflects creation-time sandbox
- **WHEN** the playbook describes re-engaging an existing Codex worker
- **THEN** it SHALL show resume by explicit thread id with the standard capture flags and stdin closed
- **AND** it SHALL state that the thread's sandbox is fixed at creation and cannot be overridden on resume

#### Scenario: Death and revival guidance
- **WHEN** the playbook describes detecting and reviving a dead Codex worker
- **THEN** it SHALL define death as the rollout's last turn-opening event lacking a completion or abort event
- **AND** it SHALL direct the LEAD to include the interrupted-worker revival notice (the last action may not have completed; re-verify state) in the revival message

#### Scenario: Failure classes drive distinct handling
- **WHEN** the playbook describes a failed Codex turn
- **THEN** it SHALL distinguish retryable rate-limit failures (retried with backoff on the order of 20 seconds, doubling, capped) from fatal model-availability failures (not retried) and unrecognized failures (escalated per the worker-death taxonomy)

#### Scenario: Occupancy and parallel discipline
- **WHEN** the playbook describes probing a Codex worker's context or running Codex workers in parallel
- **THEN** it SHALL probe with `rasen agent context --transcript <rolloutPath>` applying the existing threshold family unchanged
- **AND** it SHALL permit any number of independent single-thread workers while forbidding two concurrent writers on one thread id

#### Scenario: Session relay stays a LEAD-side mechanism
- **WHEN** the playbook's session-relay guidance is inspected
- **THEN** it SHALL note that a LEAD session relay does not disturb Codex workers — the successor session resumes their recorded thread ids — and SHALL NOT require any Codex-side relay mechanism

### Requirement: Codex project context passes by prompt reference
The orchestration playbook SHALL direct the LEAD to pass per-change context to Codex workers by naming the change-directory artifact paths in the dispatch prompt — a verified mechanism, workers genuinely read referenced files — and SHALL reserve repo-root AGENTS.md for repo-global conventions that apply to every worker, not per-change context. The playbook SHALL NOT rely on nested AGENTS.md auto-discovery (or worker working-directory placement) to inject change context.

#### Scenario: Change context by prompt reference
- **WHEN** the playbook shows a Codex dispatch prompt for a change
- **THEN** it SHALL name the change directory's artifact files (proposal/design/tasks) as paths the worker must read
- **AND** it SHALL present file reference as verified worker behavior rather than aspiration

#### Scenario: AGENTS.md scope guidance
- **WHEN** the playbook mentions AGENTS.md for Codex workers
- **THEN** it SHALL scope AGENTS.md to repo-global conventions and SHALL NOT direct the LEAD to relocate workers into change directories to trigger nested discovery
