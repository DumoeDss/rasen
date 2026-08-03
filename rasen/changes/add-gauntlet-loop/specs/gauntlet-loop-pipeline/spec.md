## ADDED Requirements

### Requirement: Gauntlet loop is an explicitly selected rasen-auto Pipeline

Rasen SHALL provide a built-in `gauntlet-loop` Pipeline through the existing `rasen-auto` entry, selectable with `rasen-auto gauntlet-loop <goal>` or `rasen-auto --pipeline gauntlet-loop <goal>`. Rasen SHALL add no separate command, SHALL NOT select `gauntlet-loop` through keyword/default classification, and SHALL keep `small-feature` as the ordinary unselected default. The classifier SHALL never suggest `gauntlet-loop`.

#### Scenario: Leading selector starts gauntlet loop
- **WHEN** a user invokes `rasen-auto gauntlet-loop build a playable maze game`
- **THEN** Rasen strips `gauntlet-loop` and starts the registered `gauntlet-loop` Pipeline with the remaining goal
- **AND** classification is not consulted

#### Scenario: Pipeline option starts gauntlet loop
- **WHEN** a user invokes `rasen-auto --pipeline gauntlet-loop build a playable maze game`
- **THEN** Rasen starts the same registered `gauntlet-loop` Pipeline and treats the selection as explicit

#### Scenario: Automatic selection never chooses gauntlet loop
- **WHEN** a user invokes `rasen-auto` without an explicit selector under manual, classify, or compose policy
- **THEN** `gauntlet-loop` is not returned by the classifier and not silently substituted

#### Scenario: No separate command is registered
- **WHEN** a user inspects the command tree and user-invokable skills
- **THEN** no `rasen gauntlet` command or directly invokable gauntlet skill is present

### Requirement: Gauntlet loop freezes a concrete reference quality bar before work

Before admitting a builder, Rasen SHALL freeze a canonical reference bar: a concrete, inspectable exemplar (and/or an inspectable comparison) resolvable through a pluggable `BarAdapter`. The frozen bar SHALL participate in launch identity and remain unchanged for the Run's lifetime. A bar with no inspectable reference SHALL be rejected before work begins; Rasen SHALL NOT replace a missing bar with subjective adjectives.

#### Scenario: Valid reference bar is recorded
- **WHEN** the auto driver can express the goal against a concrete inspectable reference
- **THEN** the canonical Run records the frozen bar and its digest before round one
- **AND** status can display the goal, reference, and effective wave/round budget

#### Scenario: Uninspectable bar blocks admission
- **WHEN** the goal has no concrete inspectable reference and no comparison the BarAdapter can resolve
- **THEN** Rasen refuses to admit a builder with a stable gauntlet input/bar error
- **AND** it does not substitute a subjective bar or start a spec workflow

#### Scenario: Relaunch with the same bar is idempotent
- **WHEN** the same Change, Pipeline, engine, and frozen bar are started again
- **THEN** Rasen reuses the existing Run without changing its bar or re-admitting completed work

#### Scenario: Relaunch with a changed bar conflicts
- **WHEN** an existing gauntlet-loop Run is started with a different goal, reference, or Pipeline
- **THEN** Rasen returns `launch_request_conflict` and leaves the persisted Run unchanged

### Requirement: Gauntlet loop runs a phased serial-then-parallel lifecycle

A gauntlet-loop Run SHALL execute in phases over the real artifact targets: an initial **serial foundation** loop over the whole artifact, an optional **lead-driven phase transition**, then **per-wave polish**. Each polish wave SHALL decompose the artifact at exactly **one level** (re-applied each wave, never nested sub-pieces), and SHALL stage work in two sub-phases: all piece-builders admitted **serially**, then all piece-critics and the meta-critic admitted **together as read-only (parallel)**. An optional fresh smoothing pass MAY run between waves. A gauntlet-loop Run SHALL NOT create runtime `proposal.md`, `design.md`, `specs/`, `tasks.md`, or `goal-plan.md`.

#### Scenario: Phase 0 improves the whole artifact serially
- **WHEN** a gauntlet-loop Run starts and no decomposition has been emitted
- **THEN** a single builder/critic loop runs over the whole artifact against the reference bar
- **AND** no piece decomposition is active

#### Scenario: Lead-driven phase transition begins per-wave polish
- **WHEN** the lead judges the foundation coherent enough to decompose
- **THEN** Rasen admits a one-level decomposition for the wave and proceeds to per-wave polish
- **AND** the lead's transition decision is sovereign over the meta-critic's advisory signal

#### Scenario: Each wave stages builds before parallel critics
- **WHEN** a wave's piece-builders and critics are pending
- **THEN** all piece-builders are admitted serially (one writer per reconcile cycle)
- **AND** piece-critics and the meta-critic are withheld until every piece in the wave is committed, then admitted together as read-only

#### Scenario: One-level decomposition never nests
- **WHEN** the lead emits a decomposition across waves
- **THEN** each wave's pieces are improved at one level only
- **AND** pieces are never recursively decomposed into sub-pieces

#### Scenario: No spec-driven artifacts are created
- **WHEN** a gauntlet-loop Run performs work across phases
- **THEN** its runtime Change contains no generated proposal, design, delta spec, task list, or goal-plan artifact

### Requirement: Wave orchestration fits the engine without relaxing invariants

The wave-orchestration SHALL be expressed as a new bounded-loop body kind (`gauntlet-wave`) dispatched like `review-cycle`/`goal-cycle`/`composite`, with piece-loops spawned as **non-nested children** so the engine's `NESTED_LOOP` and `COMPOSITE_RECURSION` guards are respected. Per-wave decomposition SHALL be modeled as **replayable committed Actions** (the ReviewCycle pattern), so the sealed RuntimePlan is never mutated. The single-writer workspace invariant SHALL be honored: piece-builders serialize, piece-critics and the meta-critic parallelize.

#### Scenario: Piece-loops are not nested inside a loop body
- **WHEN** a wave spawns piece builder/critic loops
- **THEN** the piece-loops are non-nested children and the plan validates without `NESTED_LOOP` or `COMPOSITE_RECURSION`

#### Scenario: Decomposition is replayable, not a plan mutation
- **WHEN** a wave's decomposition is emitted and later the Run resumes
- **THEN** the sealed RuntimePlan digest is unchanged
- **AND** the wave structure is reconstructed from committed decomposition Actions in the event log

#### Scenario: Serial writers and parallel readers are honored
- **WHEN** multiple piece-builders and piece-critics are candidates in one reconcile cycle
- **THEN** at most one piece-builder is admitted while critics wait
- **AND** critics are admitted together once writers have committed

### Requirement: Every judgment uses a fresh role-separated critic and the real reference

For every piece and every wave, Rasen SHALL assign a critic whose actor session differs from the current builder and from every prior gauntlet critic. The critic context SHALL contain the frozen goal, reference bar, real target locations, and raw evidence, and SHALL exclude the builder's reasoning, justification, and summary. The critic SHALL inspect the real artifacts (or their direct runtime/render/test/measurement evidence) and perform a **blind A/B comparison** against the reference where the BarAdapter supports it, returning at most the **single largest remaining gap**. A builder SHALL NOT authoritatively declare the bar met.

#### Scenario: Fresh critic judges each piece and wave
- **WHEN** a builder completes a piece or a wave's builds commit
- **THEN** a reviewer-bound actor with a session not used by the builder or any prior gauntlet critic receives the reference and real artifact/evidence locations
- **AND** no builder narrative is included in the critic input

#### Scenario: Builder actor is rejected as critic
- **WHEN** the work actor attempts to complete a judgment
- **THEN** Rasen rejects the completion with the actor-separation code

#### Scenario: Prior critic session is rejected on a later wave
- **WHEN** an actor session that judged an earlier gauntlet wave attempts to judge again
- **THEN** Rasen rejects the completion with a gauntlet critic-reused code

#### Scenario: Summary-only judgment is rejected
- **WHEN** a critic supplies conclusions without raw evidence tied to the reference and real artifacts
- **THEN** Rasen rejects the completion as insufficient gauntlet evidence

### Requirement: Convergence flows through a judge and only then enables delivery

A user MAY issue a convergence attestation at any phase. The attestation SHALL drive a **final convergence-judge Action** run by a fresh session (subject to the critic-reuse guard) that records an auditable satisfied result whose evidence is the attestation. This satisfied result is semantically **"user-converged via attestation," NOT "reference bar reached."** Ship SHALL become ready only after this convergence-judge satisfaction, and archive only after ship. In-flight write Actions SHALL settle within a convergence-settle timeout, after which the workspace is snapshotted at the last committed tree and uncommitted work abandoned. Rasen SHALL introduce no bypass terminal around the judge.

#### Scenario: Convergence attestation produces judge-mediated satisfaction
- **WHEN** the user issues a convergence attestation
- **THEN** a final convergence-judge Action (fresh session) records an auditable satisfied result
- **AND** the satisfied source is identifiable as user-converged-via-attestation, distinct from a bar-reached judgment

#### Scenario: In-flight work settles or is abandoned on convergence
- **WHEN** a write Action is in flight at convergence
- **THEN** it is allowed to settle within a convergence-settle timeout
- **AND** if unsettled at the timeout, the workspace is snapshotted at the last committed tree and uncommitted work is abandoned

#### Scenario: Satisfaction unlocks delivery through existing guards
- **WHEN** the convergence-judge has recorded satisfaction
- **THEN** ship becomes ready and, after successful ship, archive becomes ready
- **AND** delivery is admitted through the existing delivery guards with no bypass terminal

### Requirement: Backstop suspends rather than destroys work

A gauntlet-loop Run SHALL carry a compute/round backstop cap. On expiry the Run SHALL **suspend and prompt the user to converge**, preserving all committed work; it SHALL NOT discard committed work or auto-terminate as a destructive terminal.

#### Scenario: Backstop expiry suspends and prompts
- **WHEN** the backstop cap is reached without convergence
- **THEN** the Run suspends, all committed work is preserved, and the user is prompted to converge or resume
- **AND** no committed work is destroyed

### Requirement: Non-satisfied outcomes are terminal and non-converting

A gauntlet-loop Run that the user cancels, or that hits a genuine blocker, SHALL become a terminal/escalated record retaining its cause and evidence. Rasen SHALL NEVER convert, upgrade, or fall back from a gauntlet-loop Run to `small-feature`, `full-feature`, a goal Pipeline, or any other Pipeline. `--no-gate` SHALL remove ordinary confirmation pauses only and SHALL NOT bypass gauntlet input, evidence, fresh-critic, blind-A/B, terminal, or delivery guards.

#### Scenario: Cancelled run stays cancelled
- **WHEN** the user cancels an active gauntlet-loop Run and later resumes
- **THEN** the Run remains cancelled and admits no further build, critic, ship, or archive action

#### Scenario: Terminal outcome never converts
- **WHEN** a gauntlet-loop Run is cancelled, blocked, or backstop-suspended without convergence
- **THEN** Rasen preserves that outcome and does not initialize or switch to any spec-driven Pipeline

#### Scenario: No-gate cannot bypass gauntlet guards
- **WHEN** a gauntlet-loop Run was launched with `--no-gate` and is not converged
- **THEN** Rasen records the no-gate policy yet still refuses ship and archive

### Requirement: Gauntlet progress and evidence are resumable and observable

Gauntlet-loop status SHALL derive from the sealed RuntimePlan and Canonical Run Record and expose the frozen bar digest, current phase/wave/piece, effective budget, builder/critic identities, raw evidence, the latest largest gap, stall state, and outcome. Resume SHALL replay committed decomposition Actions across waves without re-doing completed phases. Any human-readable progress or evidence file SHALL be a read-only projection that cannot change the canonical next action, satisfaction, or terminal result.

#### Scenario: Status explains in-progress waves
- **WHEN** a gauntlet-loop Run is between waves or mid-wave
- **THEN** status reports the current phase, wave, committed pieces, actors, evidence, remaining budget, and the deterministic next action

#### Scenario: Resume replays wave structure from the event log
- **WHEN** a process stops after a wave's decomposition and later resumes
- **THEN** Rasen replays committed decomposition Actions, preserves actor/evidence history, and admits only the next uncompleted phase
- **AND** the sealed plan digest is unchanged

#### Scenario: Derived report cannot back-drive the run
- **WHEN** a progress projection or report is absent, stale, or hand-edited
- **THEN** status, satisfaction, and delivery guards continue to use the Canonical Run Record
- **AND** the projection cannot grant satisfaction or delivery

### Requirement: Gauntlet loop participates in registry, parity, and localization

The `gauntlet-loop` Pipeline and its internal skill SHALL be installed, inspectable, validated, and generated wherever the corresponding built-in Pipeline and workflow registries require explicit membership, and the internal skill SHALL be installed as part of the auto dependency closure without being user-invokable. Execution preflight SHALL require canonical reconciler support. Diagnostics SHALL be localized to English, Japanese, and Simplified Chinese. Existing `goal-loop` and `task-loop` Pipelines SHALL retain their current declared skills and behavior.

#### Scenario: Registry lists and shows gauntlet loop
- **WHEN** a user runs Pipeline list/show/validation against a current installation
- **THEN** `gauntlet-loop` resolves as a valid built-in with its phased iterate→ship→archive shape

#### Scenario: Generated auto skill includes gauntlet-loop support
- **WHEN** Rasen initializes or updates generated skills and workflow manifests
- **THEN** the generated `rasen-auto` content, dependency closure, parity hashes, and explicit built-in name lists include `gauntlet-loop` and its internal skill

#### Scenario: Existing loops are unchanged
- **WHEN** goal-loop and task-loop Pipelines are loaded after this change
- **THEN** each preserves its prior declared capability, plan, and runtime behavior

#### Scenario: Diagnostics are localized
- **WHEN** gauntlet validation or terminal diagnostics are rendered in English, Japanese, or Simplified Chinese
- **THEN** Rasen uses the locale catalog rather than an unlocalized internal fallback
