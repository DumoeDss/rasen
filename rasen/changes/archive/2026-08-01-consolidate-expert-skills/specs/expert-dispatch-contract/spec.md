## MODIFIED Requirements

### Requirement: Dispatched vs standalone mode contract in the shared expert PREAMBLE

The shared expert PREAMBLE SHALL carry a **Dispatched vs standalone mode** section governing every generic expert skill that embeds it: `review`, `cso`, `qa`, `benchmark`, and `design-review`. A skill is in dispatched report-only mode when its invocation instructs it to do one unit of work, not spawn subagents, and states that a LEAD owns orchestration; otherwise it is in standalone mode. `rasen-qa` SHALL additionally recognize an explicit report-only/non-UI request as a no-edit mode even outside a LEAD dispatch.

In dispatched or explicitly requested report-only mode, the skill SHALL apply no AUTO-FIX, make no code edits, issue no fix-oriented user questions, make no git commit, spawn no subagents, and SHALL return classified findings tagged with canonical severity. In dispatched mode it SHALL write the canonical report in the change's work directory with the existing sticky-legacy fallback. ASK-class and fix-class items SHALL remain unresolved findings for the LEAD. Standalone default mode SHALL retain the richer behavior of each surviving expert.

#### Scenario: Dispatched-mode contract present in generated preamble

- **WHEN** any surviving generic expert skill is regenerated and its `SKILL.md` inspected
- **THEN** it SHALL define dispatched report-only mode versus standalone mode
- **AND** SHALL identify the LEAD dispatch signature
- **AND** SHALL state that dispatched mode performs no AUTO-FIX, user question, git commit, or self-spawned subagent
- **AND** SHALL state that dispatched mode returns classified findings and writes the canonical report file

#### Scenario: QA can be explicitly report-only without a second skill

- **WHEN** `rasen-qa` is invoked with a report-only/non-UI instruction
- **THEN** it SHALL follow the no-edit report path even outside a LEAD dispatch
- **AND** SHALL NOT require or redirect to `rasen-qa-only`

### Requirement: Mutating expert skills gate fix/commit/clean-tree behavior by mode

The `qa`, `design-review`, and `review` skills SHALL suppress mutating behavior in dispatched mode. `qa` SHALL also suppress mutation in explicit report-only/non-UI mode. In those modes, `qa` and `design-review` SHALL NOT run a fix loop, commit, or enforce a clean-working-tree gate; `review` SHALL NOT auto-apply Fix-First edits or issue batched/Greptile questions. Shared adversarial and test-coverage blocks SHALL not spawn or generate/commit tests in dispatched mode. Standalone default mode SHALL retain these richer behaviors.

#### Scenario: qa fix/commit/clean-tree gated in generated skill

- **WHEN** the generated `rasen-qa` skill is inspected
- **THEN** its clean-tree gate, fix loop, and per-fix commit SHALL be scoped to default standalone mode
- **AND** SHALL state that dispatched and explicit report-only/non-UI modes report findings only and do not fix, commit, or require a clean tree

#### Scenario: design-review fix/commit/clean-tree gated in generated skill

- **WHEN** the generated `design-review` `SKILL.md` is inspected
- **THEN** its clean-tree gate, fix loop, and per-fix commit SHALL be scoped to standalone mode
- **AND** SHALL state that in dispatched mode design-review reports findings only

#### Scenario: review Fix-First and questions gated in generated skill

- **WHEN** the generated `review` `SKILL.md` is inspected
- **THEN** Fix-First AUTO-FIX and batched/Greptile question flows SHALL be scoped to standalone mode
- **AND** SHALL state that dispatched review returns findings only, routing fixes and questions to the LEAD

#### Scenario: adversarial and coverage steps gated in generated review skill

- **WHEN** the generated `review` `SKILL.md` is inspected
- **THEN** adversarial subagent dispatch SHALL not run in dispatched mode
- **AND** test-coverage generation and commit SHALL be replaced by report-only coverage findings in dispatched mode

### Requirement: Canonical report-file convention reconciled with orchestration Step B

In dispatched mode each surviving generic expert SHALL write findings to the canonical report file in the change's work directory with the change-directory sticky-legacy fallback: `review-report.md`, `cso-report.md`, `qa-report.md`, `benchmark-report.md`, or `design-review-report.md`. Both UI QA and non-UI/report-only QA SHALL use `qa-report.md`. Dispatched experts SHALL NOT also write standalone report paths. Standalone modes SHALL retain native paths. Orchestration Step B SHALL state that dispatched experts run report-only, write the canonical report themselves, and that the dispatching worker verifies its presence before returning.

#### Scenario: dispatched expert writes only the canonical report

- **WHEN** the generated `cso`, `qa`, `benchmark`, or `design-review` skill is inspected
- **THEN** it SHALL state that dispatched mode writes its canonical report in the work directory with the change-directory fallback
- **AND** SHALL scope standalone `.rasen/*-reports/` and project report paths to standalone mode
- **AND** QA SHALL name one `qa-report.md` contract for every QA mode

#### Scenario: Step B no longer claims experts save nothing

- **WHEN** the generated orchestration playbook Step B is inspected
- **THEN** it SHALL state that dispatched experts write their canonical report and the worker verifies its presence
- **AND** SHALL refer to `qa` and its modes rather than a `qa-only` expert
